import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createDecisionClient } from "../decisions/decisionClient.js";
import { readDecisionHintsSettings } from "../decisions/decisionHintsSettings.js";
import { assertDecisionHintOffEquivalence } from "../decisions/decisionHintsOffEquivalence.testSupport.js";
import type { DecisionHints } from "../decisions/decisionHints.js";

async function fixture(decisionHints?: DecisionHints, replyText = "Please approve the result.") {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-attention-"));
  const models = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json"), allowModelNetwork: false });
  const provider = fauxProvider(); models.registerNativeProvider(provider.provider);
  provider.setResponses([fauxAssistantMessage([{ type: "text", text: replyText }, fauxToolCall("end_turn", { awaiting: "nothing" })], { stopReason: "toolUse" })]);
  const gateway = createPiSessionManagerGateway({ agentDir: directory, env: { HOME: directory }, sessionDirEnvKeys: [] });
  let hub = new CapturingSessionEventHub();
  const create = () => new PiSessionService(hub, { agentDir: directory, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000, ...(decisionHints === undefined ? {} : { decisionHints }), now: () => new Date("2026-10-14T12:00:00Z") });
  let service = create();
  const started = await service.start(directory, { initialModelSpec: "faux/faux-1" });
  const ref = { id: started.id, cwd: directory };
  // Avoid an unrelated title-generation call consuming the configured reply.
  await service.runCommand(ref, "/name Attention test");
  return { ref, provider, service: () => service, hub: () => hub,
    turn: async () => {
      await service.prompt(ref, "Finish this work");
      await vi.waitFor(() => { expect(hub.sessionEvents.some(({ event }) => event.type === "pi.event" && event.eventType === "agent_settled")).toBe(true); });
    },
    restart: async () => { await service.dispose(); hub = new CapturingSessionEventHub(); service = create(); },
    dispose: async () => { await service.dispose(); await rm(directory, { recursive: true, force: true }); },
  };
}

it("turn end and status publication are equivalent with hints off, unconfigured, unreachable or hanging", async () => {
  await assertDecisionHintOffEquivalence(async ({ client, settings }) => {
    const f = await fixture(client === undefined ? undefined : { client, readSettings: () => settings, status: () => ({ keyPresent: false }) });
    try {
      await f.turn();
      return { observe: async () => {
        const status = await f.service().status(f.ref);
        return { response: status.response, streaming: status.isStreaming, hint: status.attentionHint,
          statusChanges: [...new Set(f.hub().sessionEvents.flatMap(({ event }) => event.type === "status.update" ? [JSON.stringify({ streaming: event.status.isStreaming, response: event.status.response, hint: event.status.attentionHint })] : []))],
          modelCalls: f.provider.state.callCount,
        };
      }, dispose: f.dispose };
    } catch (error) { await f.dispose(); throw error; }
  }, { timeoutMs: 1000 });
}, 30_000);

it("asks a real HTTP gateway after settlement, keeps the hint only for the live runtime, and clears it on new input", async () => {
  let requestBody = "";
  const server = createServer((request, response) => {
    request.setEncoding("utf8"); request.on("data", (chunk: string) => { requestBody += chunk; });
    request.on("end", () => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ model: "gateway-answering-model", answers: {
        kind: { type: "choice", choice: "decision", confidence: 0.9, probabilities: { decision: 0.9, review: 0.02, blocked: 0.02, failed: 0.02, done: 0.02, fyi: 0.02 } },
        asks_user: { type: "noul", noul: 0.9 }, stopped_early: { type: "noul", noul: 0.1 },
        urgency: { type: "score", score: 2, confidence: 0.9, probabilities: { "0": 0.05, "1": 0.05, "2": 0.9 } },
      } }));
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("Missing server port");
  const settings = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: `http://127.0.0.1:${String(address.port)}` };
  const f = await fixture({ client: createDecisionClient({ readConfig: () => settings }), readSettings: () => settings, status: () => ({ keyPresent: false }) }, "Please approve. API_KEY=local-api-key Authorization: Bearer local-bearer");
  try {
    await f.turn();
    await vi.waitFor(async () => { expect((await f.service().status(f.ref)).attentionHint).toMatchObject({ likelyNeedsYou: true, model: "gateway-answering-model", kind: "decision", urgency: "high" }); });
    expect(JSON.parse(requestBody)).toMatchObject({ state: { reply: "Please approve. API_KEY=[redacted] Authorization: Bearer [redacted]", awaiting: "nothing" } });
    expect((await f.service().status(f.ref)).response).toEqual({ kind: "none" });
    expect(JSON.stringify(await f.service().messages(f.ref))).toContain("local-api-key");
    expect(requestBody).not.toContain("local-api-key");
    expect(requestBody).not.toContain("local-bearer");
    expect(f.hub().globalEvents.some((event) => event.type === "status.update" && event.status.attentionHint?.model === "gateway-answering-model")).toBe(true);
    await f.restart();
    expect((await f.service().status(f.ref)).attentionHint).toBeUndefined();
    settings.attention = false;
    await f.service().prompt(f.ref, "Continue");
    expect((await f.service().status(f.ref)).attentionHint).toBeUndefined();
    await f.restart(); settings.attention = true;
    expect((await f.service().status(f.ref)).attentionHint).toBeUndefined();
  } finally { await f.dispose(); await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); }); }
}, 30_000);
