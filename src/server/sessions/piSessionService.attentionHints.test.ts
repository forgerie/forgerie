import { closeDecisionAnnotations, decisionAnnotations } from "../decisions/optionalDecisionAnnotations.js";
import { DurableSessionRuntime } from "./durableSessionRuntime.js";
import type { DurableAgentSession } from "./durableAgentSession.js";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub, emptyArchiveStore } from "./piSessionService.testSupport.js";
import { createDecisionClient, type DecisionAnswers } from "../decisions/decisionClient.js";
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
  const sources: { session: DurableAgentSession; callbacks: ((event: unknown) => void)[] }[] = [];
  const create = () => new PiSessionService(hub, { agentDir: directory, modelRuntime: models, sessionManager: gateway, archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000, createAgentRuntime: async (createRuntime, options) => {
    if (!(options.sessionManager instanceof SessionManager)) throw new Error("Concrete SDK manager required");
    return DurableSessionRuntime.open(async input => {
      const result = await createRuntime({ ...input, ...(options.initialModel === undefined ? {} : { initialModel: options.initialModel }), scopedModels: options.scopedModels, delegationToolsEnabled: options.delegationToolsEnabled });
      const source: typeof sources[number] = { session: result.session, callbacks: [] };
      const subscribe = result.session.subscribe.bind(result.session);
      result.session.subscribe = callback => { source.callbacks.push(callback); return subscribe(callback); };
      sources.push(source);
      return result;
    }, { cwd: options.cwd, agentDir: options.agentDir, sessionManager: options.sessionManager, nativeForks: true });
  }, ...(decisionHints === undefined ? {} : { decisionHints }), now: () => new Date("2026-10-14T12:00:00Z") });
  let service = create();
  const started = await service.start(directory, { initialModelSpec: "faux/faux-1" });
  const ref = { id: started.id, cwd: directory };
  // Avoid an unrelated title-generation call consuming the configured reply.
  await service.runCommand(ref, "/name Attention test");
  return { ref, provider, sources, service: () => service, hub: () => hub,
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

const oldTurnAnswer: DecisionAnswers = { model: "OLD-TURN", answers: {
  kind: { type: "choice", choice: "review", confidence: 1, probabilities: {} },
  asks_user: { type: "noul", noul: 1 }, stopped_early: { type: "noul", noul: 0 },
  urgency: { type: "score", score: 2, confidence: 1, probabilities: {} },
} };
it.each(["closed family", "sealed store", "master switched off", "attention switched off"] as const)("a retired turn cannot overwrite a reopened runtime's declared reply (%s)", async mode => {
  const live = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
  const answers: ((value: DecisionAnswers) => void)[] = [];
  const f = await fixture({ client: { ask: () => new Promise(resolve => { answers.push(resolve); }) }, readSettings: () => live, status: () => ({ keyPresent: false }) });
  try {
    await f.turn();
    expect((await f.service().status(f.ref)).response).toEqual({ kind: "none" });
    expect(answers).toHaveLength(1);
    const old = f.sources[0]; if (old === undefined) throw new Error("Missing original runtime");
    const owner = old.session.journal.harness; const scope = String(old.session.journal.conversation.id);
    const store = decisionAnnotations(owner);
    if (mode === "sealed store") closeDecisionAnnotations(owner);
    if (mode === "master switched off") live.enabled = false;
    if (mode === "attention switched off") live.attention = false;
    await f.service().stop(f.ref);
    expect(store.values(scope)).toEqual([]);
    await f.service().status(f.ref);
    expect(f.sources).toHaveLength(2);
    f.hub().sessionEvents.length = 0;
    f.provider.setResponses([fauxAssistantMessage([{ type: "text", text: "Please reply to the new turn." }, fauxToolCall("end_turn", { awaiting: "reply" })], { stopReason: "toolUse" })]);
    await f.service().prompt(f.ref, "New turn");
    await vi.waitFor(() => { expect(f.hub().sessionEvents.some(({ event }) => event.type === "pi.event" && event.eventType === "agent_settled")).toBe(true); });
    expect((await f.service().status(f.ref)).response).toEqual({ kind: "needs-response", reason: "reply" });
    live.enabled = true; live.attention = true;
    await new Promise<void>(resolve => { setImmediate(resolve); });
    const beforeSession = f.hub().sessionEvents.length; const beforeGlobal = f.hub().globalEvents.length;
    answers[0]?.(oldTurnAnswer);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    // Simulate callbacks already queued before unsubscribe: labels, gate refresh
    // and child polling must not re-publish from the old object either.
    for (const callback of old.callbacks) for (const type of ["workflow_runs_changed", "durable_children_changed", "message_end"]) callback({ type });
    expect(f.hub().sessionEvents.slice(beforeSession)).toEqual([]);
    expect(f.hub().globalEvents.slice(beforeGlobal).filter(event => event.type === "status.update")).toEqual([]);
    expect(await f.service().status(f.ref)).toMatchObject({ response: { kind: "needs-response", reason: "reply" } });
    expect((await f.service().status(f.ref)).attentionHint).toBeUndefined();
    expect(store.values(scope)).toEqual([]);
  } finally { await f.dispose(); }
}, 30_000);

it("a sealed store discards an attention result without publishing even if its runtime is still active", async () => {
  let answer: ((value: DecisionAnswers) => void) | undefined;
  const live = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
  const f = await fixture({ client: { ask: () => new Promise(resolve => { answer = resolve; }) }, readSettings: () => live, status: () => ({ keyPresent: false }) });
  try {
    await f.turn(); const source = f.sources[0]; if (source === undefined) throw new Error("Missing runtime");
    closeDecisionAnnotations(source.session.journal.harness);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    const before = f.hub().globalEvents.length;
    answer?.(oldTurnAnswer);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(f.hub().globalEvents.slice(before).filter(event => event.type === "status.update")).toEqual([]);
    expect((await f.service().status(f.ref)).attentionHint).toBeUndefined();
    expect((await f.service().status(f.ref)).response).toEqual({ kind: "none" });
  } finally { await f.dispose(); }
});
it("service disposal retires outstanding attention publication", async () => {
  let answer: ((value: DecisionAnswers) => void) | undefined;
  const live = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
  const f = await fixture({ client: { ask: () => new Promise(resolve => { answer = resolve; }) }, readSettings: () => live, status: () => ({ keyPresent: false }) });
  try {
    await f.turn(); await f.service().dispose(); const before = f.hub().globalEvents.length;
    answer?.(oldTurnAnswer); await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(f.hub().globalEvents.slice(before)).toEqual([]);
  } finally { await f.dispose(); }
});

it("native runtime close retires attention even before the service removes its active handle", async () => {
  let answer: ((value: DecisionAnswers) => void) | undefined;
  const live = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
  const f = await fixture({ client: { ask: () => new Promise(resolve => { answer = resolve; }) }, readSettings: () => live, status: () => ({ keyPresent: false }) });
  try {
    await f.turn(); const source = f.sources[0]; if (source === undefined) throw new Error("Missing runtime");
    await source.session.close(); const before = f.hub().globalEvents.length;
    answer?.(oldTurnAnswer); await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(f.hub().globalEvents.slice(before)).toEqual([]);
    expect(source.session.isClosed).toBe(true);
  } finally { await f.dispose(); }
});
