import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { registerSessionRoutes } from "./sessionRoutes.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const annotation = {
  path: "src/retry.ts", staged: false, comment: "Keep the retry limit.",
  lines: [{ kind: "add", newLineNumber: 8, text: "const retries = 0;" }],
};

let app: FastifyInstance;
let service: PiSessionService;
let runtime: ReturnType<typeof fakeRuntime>;
let hub: CapturingSessionEventHub;

beforeEach(async () => {
  vi.stubEnv("PI_OFFLINE", "1");
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  runtime = fakeRuntime("annotation-session");
  hub = new CapturingSessionEventHub();
  service = new PiSessionService(hub, {
    agentDir: "/tmp/pi-web-test-agent", modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(runtime.runtime),
    sessionManager: sessionGateway([sessionRecord("annotation-session")]), heartbeatIntervalMs: 60_000,
  });
  registerSessionRoutes(app, service, hub);
});

afterEach(async () => {
  await service.dispose();
  await app.close();
  vi.unstubAllEnvs();
});

function send(payload: object) {
  return app.inject({ method: "POST", url: "/sessions/annotation-session/prompt", payload: { cwd: "/workspace", ...payload } });
}

describe("diff annotations through the prompt route and runtime", () => {
  it("carries the request identity with formatted annotations", async () => {
    const response = await send({ text: "Fix", requestId: "annotation-send-1", diffAnnotations: [annotation] });
    expect(response.statusCode).toBe(200);
    expect(runtime.calls.prompt[0]?.options).toEqual({ requestId: "annotation-send-1" });
    expect(runtime.calls.prompt[0]?.text).toContain("Keep the retry limit.");
  });

  it.each([null, 7, "", " ", "x".repeat(257)])("rejects an invalid request identity before opening the runtime: %j", async (requestId) => {
    expect((await send({ text: "Fix", requestId })).statusCode).toBe(400);
    expect(runtime.calls.prompt).toEqual([]);
    expect(runtime.calls.bindExtensions).toEqual([]);
  });

  it("delivers formatted annotations to the selected session and transcript", async () => {
    const response = await send({ text: "Fix this.", diffAnnotations: [annotation] });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true });
    expect(runtime.calls.prompt).toHaveLength(1);
    const delivered = runtime.calls.prompt[0]?.text;
    expect(delivered).toContain("Fix this.");
    expect(delivered).toContain('"src/retry.ts"');
    expect(delivered).toContain("new line 8");
    expect(delivered).toContain("Keep the retry limit.");
    expect(hub.sessionEvents).toContainEqual({
      sessionId: "annotation-session", event: { type: "message.append", message: { role: "user", content: delivered } },
    });
  });

  it("accepts an annotation-only prompt", async () => {
    expect((await send({ diffAnnotations: [annotation] })).statusCode).toBe(200);
    expect(runtime.calls.prompt[0]?.text).toContain("Keep the retry limit.");
  });

  it("validates all annotations before opening the runtime or publishing a user message", async () => {
    const response = await send({ text: "Fix", diffAnnotations: [annotation, { ...annotation, path: "../secret" }] });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toContain("diffAnnotations");
    expect(runtime.calls.prompt).toEqual([]);
    expect(runtime.calls.bindExtensions).toEqual([]);
    expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toEqual([]);
  });

  it("retains annotation content and streaming intent while queued", async () => {
    runtime.session.isStreaming = true;
    const response = await send({ text: "Fix", streamingBehavior: "steer", diffAnnotations: [annotation] });
    expect(response.statusCode).toBe(200);
    expect(runtime.calls.prompt[0]?.options).toEqual({ streamingBehavior: "steer" });
    expect(runtime.calls.prompt[0]?.text).toContain("Keep the retry limit.");
    expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toEqual([]);
  });

  it("preserves the formatted notes behind queued compaction", async () => {
    runtime.session.isStreaming = true;
    await service.runCommand(sessionRef("annotation-session"), "/compact", "followUp");
    expect((await send({ text: "Fix", diffAnnotations: [annotation] })).statusCode).toBe(200);
    expect(runtime.calls.prompt).toEqual([]);
    runtime.session.isStreaming = false;
    runtime.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(runtime.calls.prompt).toHaveLength(1); });
    expect(runtime.calls.prompt[0]?.text).toContain("Keep the retry limit.");
  });

  it("keeps distinct annotation comments when the prompt text matches", async () => {
    runtime.session.isStreaming = true;
    await service.runCommand(sessionRef("annotation-session"), "/compact", "followUp");
    await send({ text: "Fix", diffAnnotations: [annotation] });
    await send({ text: "Fix", diffAnnotations: [{ ...annotation, comment: "Use a named constant." }] });
    runtime.session.isStreaming = false;
    runtime.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(runtime.calls.prompt).toHaveLength(2); });
    expect(runtime.calls.prompt[0]?.text).toContain("Keep the retry limit.");
    expect(runtime.calls.prompt[1]?.text).toContain("Use a named constant.");
  });

  it("does not deliver annotations to a missing session", async () => {
    const response = await app.inject({ method: "POST", url: "/sessions/missing-session/prompt", payload: { cwd: "/workspace", text: "Fix", diffAnnotations: [annotation] } });
    expect(response.statusCode).toBe(404);
    expect(runtime.calls.prompt).toEqual([]);
  });

  it("keeps existing plain prompts unchanged", async () => {
    expect((await send({ text: "  Plain\n", diffAnnotations: [] })).statusCode).toBe(200);
    expect(runtime.calls.prompt[0]?.text).toBe("  Plain\n");
  });
});
