import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, type FauxResponseFactory } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { MODEL_CHAIN_SWITCH_KIND } from "../../shared/apiTypes.js";
import { DurableAgentSession } from "./durableAgentSession.js";
import { ModelCooldownRegistry } from "./modelCooldownRegistry.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(errors: string[], beforeResponse?: () => Promise<void>, entries = ["faux/a", "faux/b"]) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-main-chains-"));
  let now = 1_000_000;
  const runtime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider({ models: [{ id: "a" }, { id: "b" }], tokensPerSecond: 100000 });
  runtime.registerNativeProvider(provider.provider); await runtime.refresh({ allowNetwork: false });
  const calls: { model: string; messages: string }[] = [];
  const respond: FauxResponseFactory = async (request, _options, _state, model) => {
    await beforeResponse?.();
    calls.push({ model: model.id, messages: JSON.stringify(request.messages) });
    const error = model.id === "a" ? errors.shift() : undefined;
    return error === undefined ? fauxAssistantMessage("CHAIN-SUCCESS") : fauxAssistantMessage("", { stopReason: "error", errorMessage: error });
  };
  provider.setResponses(Array.from({ length: 20 }, () => respond));
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime: runtime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
  services.settingsManager.applyOverrides({ defaultProvider: "faux", defaultModel: "a", retry: { enabled: false }, compaction: { enabled: false } });
  let manager = SessionManager.create(directory, join(directory, "sessions"));
  const cooldowns = new ModelCooldownRegistry(join(directory, "cooldowns.json"), error => { throw error; });
  const open = () => DurableAgentSession.open({ services, sessionManager: manager, now: () => now, modelChains: () => ({ worker: entries }), modelCooldowns: cooldowns });
  let session = await open();
  cleanups.push(async () => { await session.close(); await rm(directory, { recursive: true, force: true }); });
  return { session: () => session, calls, cooldowns,
    restart: async (at: number) => {
      const file = manager.getSessionFile(); if (file === undefined) throw new Error("Missing session file");
      await session.close(); now = at; manager = SessionManager.open(file); session = await open();
      session.journal.harness.resume();
    },
  };
}
const notices = (session: DurableAgentSession) => session.messages.filter(message => message.role === "custom" && message.customType === MODEL_CHAIN_SWITCH_KIND);
it("switches a main turn after quota failure, with one notice and the user's input once", async () => {
  const run = await fixture(["insufficient_quota token=sk-private"]);
  await run.session().setModelChain("worker");
  await run.session().prompt("Original task");
  expect(run.calls.map(call => call.model)).toEqual(["a", "b"]);
  expect(notices(run.session())).toHaveLength(1);
  expect(JSON.stringify(notices(run.session()))).not.toContain("sk-private");
  expect(run.session().messages.filter(message => message.role === "user" && message.content === "Original task")).toHaveLength(1);
  expect(run.session().model?.id).toBe("b");
  expect(run.session().modelChain).toBe("worker");
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
  release(); await first;
  expect(run.calls).toHaveLength(1);
  expect(JSON.stringify(run.session().messages)).not.toContain("Must not appear");
});
it("advances a missing catalog model and stops on fatal errors", async () => {
  const missing = await fixture([], undefined, ["faux/missing", "faux/b"]);
  await missing.session().setModelChain("worker");
  await missing.session().prompt("Original task");
  expect(missing.calls.map(call => call.model)).toEqual(["b"]);
  expect(notices(missing.session())).toHaveLength(1);
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
