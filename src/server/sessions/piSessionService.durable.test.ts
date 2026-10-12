import { request as httpRequest } from "node:http";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { registerSessionRoutes } from "./sessionRoutes.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { calculateCost } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it, vi } from "vitest";
import type { SessionUiEvent } from "../types.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { durableSessionPaths } from "./durableSessionJournal.js";

class CompletionSessionEventHub extends CapturingSessionEventHub {
  readonly completed: Promise<void>;
  private complete: (() => void) | undefined;
  private fail: ((error: Error) => void) | undefined;
  private sawAnswer = false;

  constructor() {
    super();
    this.completed = new Promise<void>((resolve, reject) => { this.complete = resolve; this.fail = reject; });
  }
  rejectPending(error: Error): void { this.fail?.(error); }
  override publish(sessionId: string, event: SessionUiEvent): void {
    super.publish(sessionId, event);
    if (event.type === "session.error") this.fail?.(new Error(event.message));
    if (event.type === "message.end" && event.message !== undefined && JSON.stringify(event.message).includes("durable service answer")) this.sawAnswer = true;
    if (event.type === "status.update" && this.sawAnswer && !event.status.isStreaming) this.complete?.();
  }
}

describe("Forgerie default Durable runtime", () => {
  it("retries an idle-sent prompt while its native run still streams with one run and echo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-streaming-retry-"));
    const agentDir = join(directory, "agent");
    const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
    const provider = fauxProvider();
    models.registerNativeProvider(provider.provider);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    provider.setResponses([async () => { entered = true; await held; return fauxAssistantMessage("durable service answer"); }]);
    const hub = new CapturingSessionEventHub();
    const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: directory }, sessionDirEnvKeys: [] });
    const service = new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000 });
    try {
      const session = await service.start(directory);
      const ref = { id: session.id, cwd: directory };
      await service.runCommand(ref, "/name Streaming retry test");
      expect((await service.status(ref)).isStreaming).toBe(false);
      await service.prompt(ref, "complete the streaming integration request", undefined, undefined, { requestId: "streaming-http-receipt" });
      await vi.waitFor(() => { expect(entered).toBe(true); });
      expect((await service.status(ref)).isStreaming).toBe(true);
      await service.prompt(ref, "complete the streaming integration request", undefined, undefined, { requestId: "streaming-http-receipt" });
      expect(hub.sessionEvents.filter(({ event }) => event.type === "agent.start")).toHaveLength(1);
      expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);
      release();
      await vi.waitFor(async () => { expect((await service.status(ref)).isStreaming).toBe(false); });
      expect(provider.state.callCount).toBe(1);
      expect(hub.sessionEvents.filter(({ event }) => event.type === "agent.start")).toHaveLength(1);
      expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);
      expect((await service.messages(ref)).messages.filter((message) => typeof message === "object" && message !== null && "role" in message && message.role === "user")).toHaveLength(1);
    } finally { release(); await service.dispose(); await rm(directory, { recursive: true, force: true }); }
  }, 20_000);

  it("retries a dropped idle HTTP receipt with one run, user entry, and native journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-service-"));
    const agentDir = join(directory, "agent");
    const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
    const provider = fauxProvider({ models: [{ id: "faux-1", cost: { input: 1000, output: 2000, cacheRead: 500, cacheWrite: 1500 } }] });
    models.registerNativeProvider({ ...provider.provider, streamSimple: (model, transcript, options) => {
      const stream = provider.provider.streamSimple(model, transcript, options);
      const result = stream.result.bind(stream);
      stream.result = async () => { const message = await result(); calculateCost(model, message.usage); return message; };
      return stream;
    } });
    // Title generation shares this provider with the parent. Both paths use configured responses.
    provider.setResponses([fauxAssistantMessage("durable service answer"), fauxAssistantMessage("durable service answer"), fauxAssistantMessage("durable service answer")]);
    const hub = new CompletionSessionEventHub();
    const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: directory }, sessionDirEnvKeys: [] });
    const app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);
    const service = new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000 });
    try {
      const session = await service.start(directory);
      const ref = { id: session.id, cwd: directory };
      registerSessionRoutes(app, service, hub);
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      const body = { cwd: directory, text: "complete the integration request", requestId: "dropped-http-receipt" };
      // Drop the HTTP socket after the server accepts the prompt, before reading its receipt.
      await new Promise<void>((resolve, reject) => {
        const request = httpRequest(`${origin}/sessions/${session.id}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" } });
        request.on("response", (response) => { response.destroy(); request.destroy(); resolve(); });
        request.on("error", reject);
        request.end(JSON.stringify(body));
      });
      const timeout = setTimeout(() => { hub.rejectPending(new Error(`Native integration did not settle: ${JSON.stringify({ calls: provider.state.callCount, events: hub.sessionEvents.slice(-12) })}`)); }, 2_000);
      try { await hub.completed; } finally { clearTimeout(timeout); }
      const runs = hub.sessionEvents.filter(({ event }) => event.type === "agent.start").length;
      const appends = hub.sessionEvents.filter(({ event }) => event.type === "message.append").length;
      expect(appends).toBe(1);
      const retry = await fetch(`${origin}/sessions/${session.id}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual({ accepted: true });
      expect(hub.sessionEvents.filter(({ event }) => event.type === "agent.start")).toHaveLength(runs);
      expect(runs).toBe(1);
      expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(appends);
      expect((await service.messages(ref)).messages.filter((message) => typeof message === "object" && message !== null && "role" in message && message.role === "user")).toHaveLength(1);
      expect((await service.status(ref)).isStreaming).toBe(false);
      await service.stop(ref);
      const afterReopen = await fetch(`${origin}/sessions/${session.id}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      expect(afterReopen.status).toBe(200);
      expect(hub.sessionEvents.filter(({ event }) => event.type === "agent.start")).toHaveLength(1);
      expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);
      expect((await service.messages(ref)).messages.filter((message) => typeof message === "object" && message !== null && "role" in message && message.role === "user")).toHaveLength(1);
      expect(provider.state.callCount).toBeGreaterThanOrEqual(1);
      const status = await service.status(ref);
      expect(status.isStreaming).toBe(false);
      expect(status.cost).toBeGreaterThan(0);
      expect(status.tokens.total).toBeGreaterThan(0);
      const command = await service.runCommand(ref, "/session");
      expect(command.type).toBe("done");
      if (command.type !== "done") throw new Error("Session statistics command must complete");
      expect(command.message).toContain(`Tokens: ↑${String(status.tokens.input)} ↓${String(status.tokens.output)} total ${String(status.tokens.total)}`);
      expect(command.message).toContain(`Cost: $${status.cost.toFixed(4)}`);
      const listed = await gateway.list(directory);
      const stored = listed.find((entry) => entry.id === session.id);
      if (stored === undefined) throw new Error("Native session must remain discoverable");
      expect(await readFile(stored.path, "utf8")).toContain("forgerieDurableSessionId");
      expect((await readFile(durableSessionPaths(stored.path).database)).subarray(0, 16).toString()).toBe("SQLite format 3\u0000");
    } finally {
      await app.close();
      await service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
