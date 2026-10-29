import { readRecapHistory } from "./durableSessionRecap.js";
import { buildRecapPrompt } from "./sessionRecapGenerator.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { SessionChainTurns } from "./durableModelChains.js";
import { InboxDoc } from "@earendil-works/pi-durable";
import { CHILD_MODEL_CONTINUE } from "../../shared/childModelDiagnostic.js";
import { MODEL_CHAIN_SWITCH_KIND } from "../../shared/apiTypes.js";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { WorkflowLaunch } from "./durableWorkflowRuns.js";
import { ChildParentDelivery } from "./durableChildParentInput.js";
import { createDurableChildHost } from "./durableChildHost.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";
import { DurableAgentSession } from "./durableAgentSession.js";
import { ModelCooldownRegistry } from "./modelCooldownRegistry.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(errors: (string | undefined)[], beforeResponse?: () => Promise<void>, entries = ["faux/a", "faux/b"], options: { children?: boolean; crossProvider?: boolean; keepRecentTokens?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-main-chains-"));
  let now = 1_000_000;
  const runtime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider({ models: [{ id: "a" }, { id: "b" }], tokensPerSecond: 100000 });
  runtime.registerNativeProvider(provider.provider); await runtime.refresh({ allowNetwork: false });
  const calls: { model: string; provider: string; messages: string; at: number }[] = [];
  const respond: FauxResponseFactory = async (request, _options, _state, model) => {
    await beforeResponse?.();
    calls.push({ model: model.id, provider: model.provider, messages: JSON.stringify(request.messages), at: now });
    const error = model.id === "a" ? errors.shift() : undefined;
    return error === undefined ? fauxAssistantMessage("CHAIN-SUCCESS") : fauxAssistantMessage("", { stopReason: "error", errorMessage: error });
  };
  provider.setResponses(Array.from({ length: 20 }, () => respond));
  if (options.crossProvider === true) {
    const fallback = fauxProvider({ provider: "other", models: [{ id: "b" }], tokensPerSecond: 100000 });
    fallback.setResponses(Array.from({ length: 20 }, () => respond));
    runtime.registerNativeProvider(fallback.provider); await runtime.refresh({ allowNetwork: false });
  }
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime: runtime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
  services.settingsManager.applyOverrides({ defaultProvider: "faux", defaultModel: "a", retry: { enabled: false }, compaction: { enabled: false, ...(options.keepRecentTokens === undefined ? {} : { keepRecentTokens: options.keepRecentTokens }) }, followUpMode: "all" });
  let manager = SessionManager.create(directory, join(directory, "sessions"));
  const cooldowns = new ModelCooldownRegistry(join(directory, "cooldowns.json"), error => { throw error; });
  const open = (handle?: DurableSessionHandle) => DurableAgentSession.open({ ...(handle === undefined ? {} : { handle }), services, sessionManager: manager, now: () => now, modelChains: () => ({ worker: entries }), modelCooldowns: cooldowns, ...(options.children === true ? { childAgents: createDurableChildHost({ homeAgentsDir: join(directory, "home-agents"), builtinAgentsDirs: [] }) } : {}) });
  let session = await open();
  cleanups.push(async () => { await session.close(); await rm(directory, { recursive: true, force: true }); });
  return { session: () => session, calls, cooldowns,
    fork: async () => {
      const parent = session;
      const leaf = (await parent.getDurableTree()).activeLeafId;
      if (leaf === null) throw new Error("Missing fixture leaf");
      manager = SessionManager.create(directory, join(directory, "sessions"));
      const fork = await parent.nativeHistory.fork(leaf, "at", manager.getSessionId(), context);
      session = await open(fork.handle);
      await parent.close();
    },
    restart: async (at: number) => {
      const file = manager.getSessionFile(); if (file === undefined) throw new Error("Missing session file");
      await session.close(); now = at; manager = SessionManager.open(file); session = await open();
      session.journal.harness.resume();
    },
  };
}
const notices = (session: DurableAgentSession) => session.messages.filter(message => message.role === "custom" && message.customType === MODEL_CHAIN_SWITCH_KIND);
it.each(["original", "constructor"])("switches a main turn after quota failure, with one notice and the user's input once, requestId=%s", async requestId => {
  const run = await fixture(["insufficient_quota token=sk-private"]);
  await run.session().setModelChain("worker");
  await run.session().prompt("Original task", { requestId });
  expect(run.calls.map(call => call.model)).toEqual(["a", "b"]);
  expect(notices(run.session())).toHaveLength(1);
  expect(JSON.stringify(notices(run.session()))).not.toContain("sk-private");
  expect(JSON.stringify(run.calls)).not.toContain("sk-private");
  expect(run.session().messages.filter(message => message.role === "user" && message.content === "Original task")).toHaveLength(1);
  expect(run.session().model?.id).toBe("b");
  expect(run.session().modelChain).toBe("worker");
  const session = run.session();
  const recapHistory = await readRecapHistory(session.journal.handle, async () => {
    await session.journal.project();
    return session.sessionManager.getBranch();
  });
  if (recapHistory === undefined) throw new Error("The completed turn must have a stable recap leaf");
  const switchEntry = session.sessionManager.getBranch().find(entry => entry.type === "custom_message" && entry.customType === MODEL_CHAIN_SWITCH_KIND);
  if (switchEntry?.type !== "custom_message") throw new Error("The switch notice must stay display-only");
  const recapPrompt = buildRecapPrompt(recapHistory.messages)?.prompt;
  expect(recapPrompt).toContain("Original task");
  expect(recapPrompt).toContain("CHAIN-SUCCESS");
  expect(recapPrompt).not.toContain(switchEntry.content);
  await run.restart(1_000_001);
  expect(run.session().modelChain).toBe("worker");
  expect(run.session().model?.id).toBe("b");
  expect(notices(run.session())).toHaveLength(1);
});
it("waits 60 seconds on rate limit across restart, retries once on A, then switches", async () => {
  const run = await fixture(["rate limit", "rate limit"]);
  await run.session().setModelChain("worker");
  const prompt = run.session().prompt("Original task").catch(() => undefined);
  await vi.waitFor(() => { expect(run.session().chainWait?.until).toBe(1_060_000); });
  expect(run.session().chainWait).not.toHaveProperty("owner");
  await run.restart(1_059_999); await prompt;
  expect(run.calls.map(call => call.model)).toEqual(["a"]);
  expect(run.session().chainWait?.until).toBe(1_060_000);
  await run.restart(1_060_000);
  await vi.waitFor(() => { expect(run.calls.map(call => call.model)).toEqual(["a", "a", "b"]); });
  await vi.waitFor(() => { expect(notices(run.session())).toHaveLength(1); expect(run.session().chainWait).toBeUndefined(); });
});
it("Stop cancels a persisted chain wait", async () => {
  const run = await fixture(["rate limit"]);
  await run.session().setModelChain("worker");
  const prompt = run.session().prompt("Original task").catch(() => undefined);
  await vi.waitFor(() => { expect(run.session().chainWait).toBeDefined(); });
  await run.session().abort(); await prompt;
  await run.restart(1_060_000);
  expect(run.calls).toHaveLength(1);
  expect(run.session().chainWait).toBeUndefined();
});
it("leaves an ordinary session's failed turn unchanged", async () => {
  const run = await fixture(["insufficient_quota"]);
  await run.session().prompt("Original task");
  expect(run.calls.map(call => call.model)).toEqual(["a"]);
  expect(notices(run.session())).toHaveLength(0);
  expect(run.session().modelChain).toBeUndefined();
  expect(await run.cooldowns.snapshot()).toEqual({});
});

it("gives a steer the active turn's fallback owner instead of switching twice", async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let waiting = true;
  const run = await fixture(["insufficient_quota"], async () => { if (waiting) await held; });
  await run.session().setModelChain("worker");
  const first = run.session().prompt("Original task");
  await vi.waitFor(() => { expect(run.session().isStreaming).toBe(true); });
  let admitted = false;
  const steer = run.session().prompt("User correction", { streamingBehavior: "steer", preflightResult: () => { admitted = true; } });
  try { await vi.waitFor(() => { expect(admitted).toBe(true); }); }
  finally { waiting = false; release(); }
  await Promise.all([first, steer]);
  expect(notices(run.session())).toHaveLength(1);
  expect(run.calls.map(call => call.model)).toEqual(["a", "b"]);
});
it("rejects a second idle-only input while busy without admitting it later", async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const run = await fixture([], () => held);
  await run.session().setModelChain("worker");
  const first = run.session().prompt("Original task");
  await vi.waitFor(() => { expect(run.session().isStreaming).toBe(true); });
  await expect(run.session().prompt("Must not appear")).rejects.toThrow();
  await vi.waitFor(() => { expect(run.session().pendingMessageCount).toBe(0); });
  release(); await first;
  expect(run.calls).toHaveLength(1);
  expect(JSON.stringify(run.session().messages)).not.toContain("Must not appear");
});
it("skips a missing first catalog entry and stops on fatal errors", async () => {
  const missing = await fixture([], undefined, ["faux/missing", "faux/b"]);
  await missing.session().setModelChain("worker");
  await missing.session().prompt("Original task");
  expect(missing.calls.map(call => call.model)).toEqual(["b"]);
  expect(notices(missing.session())).toHaveLength(0);
  const fatal = await fixture(["Context window limit"]);
  await fatal.session().setModelChain("worker");
  await fatal.session().prompt("Original task");
  expect(fatal.calls.map(call => call.model)).toEqual(["a"]);
  expect(notices(fatal.session())).toHaveLength(0);
});

it("exposes the pinned switch target during an exhausted-chain wait", async () => {
  const run = await fixture(["insufficient_quota"]);
  await run.cooldowns.mark("faux/b", 2_000_000, "quota");
  await run.session().setModelChain("worker");
  const prompt = run.session().prompt("Original task").catch(() => undefined);
  await vi.waitFor(() => { expect(run.session().chainWait).toMatchObject({ from: "faux/a", to: "faux/b", until: 1_030_000 }); });
  await run.session().abort(); await prompt;
});

it("continues a turn started by an extension message, not only a composer prompt", async () => {
  const run = await fixture(["insufficient_quota"]);
  await run.session().setModelChain("worker");
  await run.session().sendCustomMessage({ customType: "test.background", content: "Background task", display: true }, { triggerTurn: true });
  await vi.waitFor(() => { expect(run.calls.map(call => call.model)).toEqual(["a", "b"]); expect(notices(run.session())).toHaveLength(1); });
  expect(run.session().messages.filter(message => message.role === "custom" && message.customType === "test.background")).toHaveLength(1);
});


it.each(["quota", "no_model"])("recovers coalesced workflow launches and child reports once with followUpMode all, failure=%s", async failure => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let waiting = true;
  const run = await fixture([undefined, "insufficient_quota"], async () => { if (waiting) { entered(); await held; } }, failure === "quota" ? undefined : ["faux/missing", "faux/also-missing"], { children: true });
  const session = run.session();
  const warmup = session.prompt("Warm-up").catch(() => undefined);
  try {
    await Promise.race([started, warmup.then(() => { throw new Error("Warm-up ended before provider admission"); })]);
    await session.setModelChain("worker");
    const harness = session.journal.harness;
    const options = { conversationId: session.journal.conversation.id, ownership: { kind: "conversation" as const }, background: true };
    const workflow = await harness.commit(tx => tx.createTask(WorkflowLaunch, { runId: "coalesced", prompt: "Workflow launch" }, options), context);
    const child = await harness.commit(tx => tx.createTask(ChildParentDelivery, { requestId: "child-report:coalesced", text: "Child report" }, options), context);
    await Promise.all([harness.waitForTask(workflow, context), harness.waitForTask(child, context)]);
    await vi.waitFor(async () => { expect((await harness.snapshot(InboxDoc, session.journal.conversation.id, context))?.items.filter(item => item.mode !== "write")).toHaveLength(2); });
  } finally { waiting = false; release(); }
  await warmup;
  if (failure === "no_model") {
    await vi.waitFor(() => { expect(session.chainWait?.until).toBe(1_030_000); });
    const turns = await session.journal.harness.snapshot(SessionChainTurns, session.journal.conversation.id, context);
    expect(new Set(Object.values(turns?.retryOwners ?? {}).map(claim => claim.owner)).size).toBe(1);
    expect(notices(session)).toHaveLength(1);
    expect(session.messages.filter(message => message.role === "user" && message.content === CHILD_MODEL_CONTINUE)).toHaveLength(1);
    await session.abort();
    return;
  }
  await vi.waitFor(() => { expect(session.isStreaming).toBe(false); expect(run.calls).toHaveLength(3); });
  expect(run.calls.map(call => call.model)).toEqual(["a", "a", "b"]);
  expect(notices(session)).toHaveLength(1);
  expect(session.messages.filter(message => message.role === "user" && message.content === CHILD_MODEL_CONTINUE)).toHaveLength(1);
});

it.each([false, true])("holds a child report behind a persisted wait, with Stop=%s", async stop => {
  const run = await fixture(["rate limit", "rate limit"], undefined, undefined, { children: true });
  await run.session().setModelChain("worker");
  const original = run.session().prompt("Original task").catch(() => undefined);
  await vi.waitFor(() => { expect(run.session().chainWait?.until).toBe(1_060_000); });
  const harness = run.session().journal.harness;
  const parent = run.session().journal.conversation.id;
  const report = await harness.commit(tx => tx.createTask(ChildParentDelivery, { requestId: "child-report:waiting", text: "Child report" }, { conversationId: parent, ownership: { kind: "conversation" }, background: true }), context);
  const background = harness.waitForTask(report, context).catch(() => undefined);
  await vi.waitFor(() => { expect(run.session().getFollowUpMessages()).toContain("Child report"); });
  expect(run.calls.map(call => call.model)).toEqual(["a"]);
  expect(run.session().chainWait?.until).toBe(1_060_000);
  expect(run.session().isStreaming).toBe(true);
  if (stop) {
    expect(run.session().clearQueue().followUp).toContain("Child report");
    await background;
    expect(run.session().chainWait?.until).toBe(1_060_000);
    expect(run.session().isStreaming).toBe(true);
    await run.session().abort();
    await original;
    await run.restart(1_060_000);
    expect(run.calls.map(call => call.model)).toEqual(["a"]);
    expect(run.session().chainWait).toBeUndefined();
    expect(run.session().getFollowUpMessages()).toEqual([]);
  } else {
    await run.restart(1_059_999);
    await Promise.all([original, background]);
    expect(run.session().chainWait?.until).toBe(1_060_000);
    expect(run.calls.map(call => call.model)).toEqual(["a"]);
    await run.restart(1_060_000);
    await vi.waitFor(() => { expect(run.calls.map(call => call.model)).toEqual(["a", "a", "b", "b"]); });
    expect(run.calls.at(-1)?.messages).toContain("Child report");
    expect(notices(run.session())).toHaveLength(1);
  }
});

it.each([false, true])("persists the first all-cooling exhaustion wait before admitting the original prompt, with Stop=%s", async stop => {
  const run = await fixture([]);
  await run.cooldowns.mark("faux/a", 9_000_000, "quota");
  await run.cooldowns.mark("faux/b", 8_000_000, "quota");
  await run.session().setModelChain("worker");
  const prompt = run.session().prompt("Original all-cooling task").catch(() => undefined);
  await vi.waitFor(() => { expect(run.session().chainWait).toMatchObject({ to: "faux/b", until: 1_030_000 }); });
  expect(run.calls).toHaveLength(0);
  if (stop) {
    expect(run.session().clearQueue().followUp).toContain("Original all-cooling task");
    await run.session().abort(); await prompt;
    await run.restart(1_030_000);
    expect(run.calls).toHaveLength(0);
    expect(run.session().chainWait).toBeUndefined();
    return;
  }
  await run.restart(1_029_999); await prompt;
  expect(run.calls).toHaveLength(0);
  expect(run.session().chainWait?.until).toBe(1_030_000);
  await run.restart(1_030_000);
  await vi.waitFor(() => { expect(run.calls.map(call => call.model)).toEqual(["b"]); });
  expect(run.calls[0]?.messages).toContain("Original all-cooling task");
  expect(run.session().messages.filter(message => message.role === "user" && message.content === "Original all-cooling task")).toHaveLength(1);
});


it("consumes the first exhaustion budget before the first probe and lets Stop cancel the next wait", async () => {
  const run = await fixture(["rate limit"]);
  await run.cooldowns.mark("faux/a", 8_000_000, "quota");
  await run.cooldowns.mark("faux/b", 9_000_000, "quota");
  await run.session().setModelChain("worker");
  const prompt = run.session().prompt("Original budget task").catch(() => undefined);
  await vi.waitFor(() => { expect(run.session().chainWait?.until).toBe(1_030_000); });
  expect(run.calls).toHaveLength(0);
  await run.restart(1_030_000); await prompt;
  await vi.waitFor(() => { expect(run.session().chainWait?.until).toBe(1_150_000); });
  expect(run.calls.map(call => [call.model, call.at])).toEqual([["a", 1_030_000]]);
  await run.session().abort();
  await run.restart(1_150_000);
  expect(run.calls).toHaveLength(1);
  expect(run.session().chainWait).toBeUndefined();
});

it("skips both cooling and missing entries when selecting the first chain model", async () => {
  const run = await fixture([], undefined, ["faux/missing", "faux/a", "faux/b"]);
  await run.cooldowns.mark("faux/a", 2_000_000, "quota");
  await run.session().setModelChain("worker");
  expect(run.session().model?.id).toBe("b");
  await run.session().prompt("Available model task");
  expect(run.calls.map(call => call.model)).toEqual(["b"]);
});

it.each([false, true])("declines main-session compaction that would send legacy provider diagnostics across a fallback, with fork=%s", async fork => {
  const run = await fixture(["insufficient_quota"], undefined, ["faux/a", "other/b"], { crossProvider: true, keepRecentTokens: 1 });
  await run.session().setModelChain("worker");
  await run.session().prompt("Original task");
  if (fork) {
    await run.fork();
  }
  for (const content of ["Continue where you stopped; the last request failed with: HTTP 429 api_key=private-fixture-secret", "Later safe context"]) {
    await run.session().journal.appendMessage({ role: "user", content, timestamp: 1_000_000 });
  }
  await expect(run.session().compact()).rejects.toThrow("Compaction declined");
  expect(run.calls.map(call => call.provider)).toEqual(["faux", "other"]);
  expect(JSON.stringify(run.calls.filter(call => call.provider === "other"))).not.toContain("private-fixture-secret");
});

it.each(["no chain", "single-model chain", "safe fallback"])("compacts a main session normally with %s", async kind => {
  const fallback = kind === "safe fallback";
  const run = await fixture(fallback ? ["insufficient_quota"] : [], undefined, fallback ? ["faux/a", "other/b"] : ["faux/a"], { crossProvider: fallback, keepRecentTokens: 1 });
  if (kind !== "no chain") await run.session().setModelChain("worker");
  await run.session().prompt("First task");
  await run.session().prompt("Second task");
  const before = run.calls.length;
  await run.session().compact();
  expect(run.calls).toHaveLength(before + 1);
});

it("holds multiple child reports as one restorable batch without blocking later outbox admissions", async () => {
  const run = await fixture(["rate limit"], undefined, undefined, { children: true });
  await run.session().setModelChain("worker");
  const original = run.session().prompt("Original task").catch(() => undefined);
  await vi.waitFor(() => { expect(run.session().chainWait?.until).toBe(1_060_000); });
  const harness = run.session().journal.harness;
  const parent = run.session().journal.conversation.id;
  const first = await harness.commit(tx => tx.createTask(ChildParentDelivery, { requestId: "child-report:first", text: "First child report" }, { conversationId: parent, ownership: { kind: "conversation" }, background: true }), context);
  // Use the same durable delivery chain as submitChildParentInput does.
  const second = await harness.commit(tx => tx.createTask(ChildParentDelivery, { requestId: "child-report:second", text: "Second child report", previous: { task: first, requestId: "child-report:first" } }, { conversationId: parent, ownership: { kind: "conversation" }, background: true }), context);
  await Promise.all([harness.waitForTask(first, context), harness.waitForTask(second, context)]);
  await vi.waitFor(() => { expect(run.session().getFollowUpMessages()).toEqual(["First child report\n\nSecond child report"]); });
  expect(run.session().clearQueue().followUp).toEqual(["First child report\n\nSecond child report"]);
  await run.session().abort(); await original;
  await run.restart(1_060_000);
  expect(run.calls.map(call => call.model)).toEqual(["a"]);
  expect(run.session().getFollowUpMessages()).toEqual([]);
});


it("keeps ordinary extension steers attached to the active recovery owner", async () => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let waiting = true;
  const run = await fixture(["insufficient_quota"], async () => { if (waiting) { entered(); await held; } });
  await run.session().setModelChain("worker");
  const original = run.session().prompt("Original task");
  let steer: Promise<void> | undefined;
  try {
    await started;
    steer = run.session().sendCustomMessage({ customType: "test.background-steer", content: "Background correction", display: true }, { triggerTurn: true, deliverAs: "steer" });
    await vi.waitFor(() => { expect(run.session().getSteeringMessages()).toContain("Background correction"); });
    await steer;
  } finally { waiting = false; release(); }
  await Promise.all([original, steer]);
  expect(run.calls.map(call => call.model)).toEqual(["a", "b"]);
  expect(notices(run.session())).toHaveLength(1);
});

it("does not append a report arriving during recovery to a pre-wait native batch, and restores FIFO on Stop", async () => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let waiting = true;
  const run = await fixture(["rate limit"], async () => { if (waiting) { entered(); await held; } }, undefined, { children: true });
  const session = run.session();
  await session.setModelChain("worker");
  const original = session.prompt("Original task").catch(() => undefined);
  const harness = session.journal.harness;
  const parent = session.journal.conversation.id;
  const options = { conversationId: parent, ownership: { kind: "conversation" as const }, background: true };
  let first;
  try {
    await started;
    first = await harness.commit(tx => tx.createTask(ChildParentDelivery, { requestId: "child-report:before", text: "Before wait" }, options), context);
    await harness.waitForTask(first, context);
    await vi.waitFor(async () => { expect((await harness.snapshot(InboxDoc, parent, context))?.items[0]).toMatchObject({ content: "Before wait" }); });
  } finally { waiting = false; release(); }
  await vi.waitFor(() => { expect(session.chainWait?.until).toBe(1_060_000); });
  const second = await harness.commit(tx => tx.createTask(ChildParentDelivery, { requestId: "child-report:during", text: "During wait", previous: { task: first, requestId: "child-report:before" } }, options), context);
  await harness.waitForTask(second, context);
  await vi.waitFor(() => { expect(session.getFollowUpMessages()).toEqual(["Before wait", "During wait"]); });
  expect((await harness.snapshot(InboxDoc, parent, context))?.items[0]).toMatchObject({ content: "Before wait" });
  expect(session.clearQueue().followUp).toEqual(["Before wait", "During wait"]);
  await session.abort(); await original;
  await run.restart(1_060_000);
  expect(run.calls.map(call => call.model)).toEqual(["a"]);
});

it("stays streaming while its recovery owner plans a switch before a native run or wait exists", async () => {
  const run = await fixture(["insufficient_quota"]);
  await run.session().setModelChain("worker");
  let entered!: () => void;
  let release!: () => void;
  let ended!: () => void;
  const marking = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const nativeEnded = new Promise<void>(resolve => { ended = resolve; });
  const off = run.session().subscribe(event => { if (typeof event === "object" && event !== null && "type" in event && event.type === "agent_end") ended(); });
  const mark = run.cooldowns.mark.bind(run.cooldowns);
  const spy = vi.spyOn(run.cooldowns, "mark").mockImplementation(async (...args) => { entered(); await held; await mark(...args); });
  const prompt = run.session().prompt("Original task").catch(() => undefined);
  try {
    await Promise.all([marking, nativeEnded]);
    await vi.waitFor(() => { expect(run.session().isStreaming).toBe(true); });
    expect(run.session().chainWait).toBeUndefined();
  } finally { release(); off(); spy.mockRestore(); }
  await prompt;
  expect(run.calls.map(call => call.model)).toEqual(["a", "b"]);
});
