import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, LiveDoc } from "@earendil-works/pi-durable";
import { afterEach, expect, it, vi } from "vitest";
import type { ModelChains } from "../../shared/modelChains.js";
import { durableChildExtensions, listChildren, stopChild } from "./durableChildAgents.js";
import { ChildAgentCatalog } from "./durableChildProfiles.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { ModelCooldownRegistry } from "./modelCooldownRegistry.js";
import { DurableChildRunRecords } from "./durableChildRunRecords.js";
import { ChildRunStore } from "./childRunStore.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(errors: Record<string, string[]>, chains: ModelChains = { worker: ["faux/a", "faux/b"] }, profile = "worker") {
  const root = await mkdtemp(join(tmpdir(), "forgerie-model-chains-"));
  let now = 1_000_000;
  const clock = () => now;
  const warnings: unknown[] = [];
  const cooldownPath = join(root, "model-cooldowns.json");
  let cooldowns = new ModelCooldownRegistry(cooldownPath, (error) => { warnings.push(error); });
  await mkdir(join(root, "agents"));
  await writeFile(join(root, "agents", "reader.md"), `---\nname: reader\ntools: read\nmodel: ${profile}\n---\nComplete the task.`);
  const manager = SessionManager.create(root, join(root, "sessions"));
  const models = createModels();
  const provider = fauxProvider({ models: [{ id: "parent" }, { id: "a", reasoning: true }, { id: "b", reasoning: true }, { id: "c" }], tokensPerSecond: 100000 });
  models.setProvider(provider.provider);
  const calls: { model: string; at: number; content: string }[] = [];
  const reports: string[] = [];
  let spawnArgs: { name: string; model?: string } = { name: "worker" };
  provider.setResponses(Array.from({ length: 100 }, () => (request, _options, _state, model) => {
    const last = request.messages.at(-1);
    const content = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
    if (model.id !== "parent") {
      calls.push({ model: model.id, at: now, content });
      const error = errors[model.id]?.shift();
      return error === undefined ? fauxAssistantMessage("CHAIN-SUCCESS") : fauxAssistantMessage("", { stopReason: "error", errorMessage: error });
    }
    if (content === "SPAWN") return fauxAssistantMessage([fauxToolCall("child_agent", { action: "spawn", agent: "reader", message: "Original task", ...spawnArgs })], { stopReason: "toolUse" });
    if (last?.role === "user" && content.includes("[subagent")) reports.push(content);
    return fauxAssistantMessage("PARENT-DONE");
  }));
  const store = new ChildRunStore(join(root, "runs.json"), clock);
  let recorder: DurableChildRunRecords;
  let journal: DurableSessionJournal;
  async function open() {
    const registry = createRegistry();
    const extensions = durableChildExtensions({ catalog: new ChildAgentCatalog([join(root, "agents")]), modelChains: () => chains, modelCooldowns: cooldowns, now: clock,
      commit: (change, ctx) => journal.harness.commit(change, ctx), flushRunRecords: () => recorder.flush() });
    for (const extension of [...extensions.parent, ...extensions.childOnly]) registry.install(extension);
    journal = await DurableSessionJournal.open({ manager, models, registry,
      agent: { cwd: root, model: { provider: "faux", modelId: "parent" }, extensions: extensions.parent },
      familyOptions: { models, registry, now: clock, settings: { retry: { enabled: false } }, onReport: (error) => { warnings.push(error); } } });
    recorder = await DurableChildRunRecords.open(journal.harness, journal.conversation.id, { id: "parent", cwd: root }, store, context, (error) => { warnings.push(error); }, clock);
    journal.harness.resume();
  }
  await open();
  cleanups.push(async () => { await recorder.close(); await journal.close(); await rm(root, { recursive: true, force: true }); });
  return {
    calls, reports, warnings, chains, cooldowns: () => cooldowns,
    children: () => listChildren(journal.harness, journal.conversation.id, context),
    history: async () => { await recorder.flush(); return store.list(); },
    spawn: async (args?: { name: string; model?: string }) => {
      spawnArgs = args ?? { name: "worker" };
      await (await journal.conversation.submit({ type: "input", content: "SPAWN" }, context)).wait(context);
      return journal.conversation.context(context);
    },
    restart: async (at: number) => { await recorder.close(); await journal.close(); now = at; cooldowns = new ModelCooldownRegistry(cooldownPath, (error) => { warnings.push(error); }); await open(); },
    stop: async () => { const child = (await listChildren(journal.harness, journal.conversation.id, context))[0]; if (child !== undefined) await stopChild(journal.harness, journal.conversation, child.conversationId, context); },
    idle: async () => { await vi.waitFor(async () => { expect((await journal.harness.snapshot(LiveDoc, journal.conversation.id, context))?.run).toBeUndefined(); }); },
  };
}

it("finishes on B after A runs out of quota and records the fallback in the report, children and run history", async () => {
  const run = await fixture({ a: ["insufficient_quota"] });
  await run.spawn();
  await vi.waitFor(() => { expect(run.reports[0]).toContain("CHAIN-SUCCESS"); });
  expect(run.calls.map((call) => call.model)).toEqual(["a", "b"]);
  expect(run.calls[1]?.content).toContain("Continue where you stopped; the last request failed with: insufficient_quota");
  expect(run.reports[0]).toContain("ran on faux/b after faux/a: insufficient_quota");
  expect((await run.children())[0]?.fallback).toEqual({ from: "faux/a", to: "faux/b", reason: "insufficient_quota" });
  expect((await run.history()).find((record) => record.model?.modelId === "b")?.fallbacks).toEqual([{ from: "faux/a", to: "faux/b", reason: "insufficient_quota" }]);
  expect((await run.cooldowns().snapshot())["faux/a"]).toEqual({ until: 4_600_000, reason: "insufficient_quota" });
  await run.idle(); await run.restart(1_000_000);
  expect(run.calls).toHaveLength(2); expect(run.reports).toHaveLength(1); expect(run.warnings).toEqual([]);
});

it("waits once for 60 seconds after rate limit, preserves the deadline through restart, then switches after a second failure", async () => {
  const run = await fixture({ a: ["HTTP 429 rate limited", "HTTP 429 rate limited"] });
  await run.spawn();
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toEqual({ attempt: 1, max: 3, error: "HTTP 429 rate limited", until: 1_060_000 }); });
  await run.restart(1_059_999); expect(run.calls).toHaveLength(1);
  await run.restart(1_060_000);
  await vi.waitFor(() => { expect(run.reports[0]).toContain("CHAIN-SUCCESS"); });
  expect(run.calls.map((call) => [call.model, call.at])).toEqual([["a", 1_000_000], ["a", 1_060_000], ["b", 1_060_000]]);
  expect(run.reports[0]).toContain("ran on faux/b after faux/a: HTTP 429");
  expect(run.warnings).toEqual([]);
});

it("keeps the 30 second / 2 minute / 5 minute transient schedule for a chain of one", async () => {
  const run = await fixture({ a: ["overloaded", "overloaded", "overloaded", "overloaded: final error"] }, { worker: ["faux/a"] });
  await run.spawn(); let at = 1_000_000;
  for (const [index, delay] of [30_000, 120_000, 300_000].entries()) {
    at += delay;
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: index + 1, until: at }); });
    await run.restart(at);
  }
  await vi.waitFor(() => { expect(run.reports[0]).toContain("overloaded: final error"); });
  expect(run.calls.map((call) => call.at)).toEqual([1_000_000, 1_030_000, 1_150_000, 1_450_000]);
  expect(run.warnings).toEqual([]);
});

it("uses the old retry budget on the earliest cooling model, then reports its real error", async () => {
  const run = await fixture({ b: ["billing exhausted", "billing exhausted", "billing exhausted: final error"] });
  await run.cooldowns().mark("faux/a", 9_000_000, "quota A"); await run.cooldowns().mark("faux/b", 8_000_000, "quota B");
  await run.spawn(); let at = 1_000_000;
  for (const [index, delay] of [30_000, 120_000, 300_000].entries()) {
    at += delay;
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: index + 1, until: at }); });
    expect(run.calls).toHaveLength(index);
    await run.restart(at);
  }
  await vi.waitFor(() => { expect(run.reports[0]).toContain("billing exhausted: final error"); });
  expect(run.calls.map((call) => call.model)).toEqual(["b", "b", "b"]);
  expect(run.calls[0]?.content).toContain("Original task");
  expect(run.warnings).toEqual([]);
});

it("refuses unknown chain references with known names instead of silently inheriting the session model", async () => {
  const run = await fixture({}, { worker: ["faux/a"] }, "missing");
  const result = await run.spawn();
  expect(JSON.stringify(result)).toContain('Unknown model chain \\"missing\\". Known chains: worker.');
  expect(await run.children()).toEqual([]); expect(run.calls).toEqual([]);
});

it("skips a cooling model for a new spawn, including after the daemon registry reopens", async () => {
  const run = await fixture({ a: ["quota exceeded"] });
  await run.spawn(); await vi.waitFor(() => { expect(run.reports).toHaveLength(1); }); await run.idle();
  await run.restart(1_000_000); await run.spawn({ name: "next" });
  await vi.waitFor(() => { expect(run.reports).toHaveLength(2); });
  expect(run.calls.map((call) => call.model)).toEqual(["a", "b", "b"]);
  expect(run.reports[1]).toContain("ran on faux/b after faux/a: quota exceeded");
});

it("rereads edited chain entries before a switch", async () => {
  const run = await fixture({ a: ["429", "429"] });
  await run.spawn(); await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toBeDefined(); });
  run.chains["worker"] = ["faux/a", "faux/c"];
  await run.restart(1_060_000);
  await vi.waitFor(() => { expect(run.reports).toHaveLength(1); });
  expect(run.calls.map((call) => call.model)).toEqual(["a", "a", "c"]);
  expect(run.warnings).toEqual([]);
});

it("exhausts all failed models with the old finite budget and reports the last real failure", async () => {
  const run = await fixture({ a: ["quota exceeded"], b: ["billing exhausted", "billing exhausted", "billing exhausted", "billing exhausted: final error"] });
  await run.spawn(); let at = 1_000_000;
  for (const [index, delay] of [30_000, 120_000, 300_000].entries()) {
    at += delay;
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: index + 1, until: at }); });
    await run.restart(at);
  }
  await vi.waitFor(() => { expect(run.reports[0]).toContain("billing exhausted: final error"); });
  expect(run.calls.map((call) => call.model)).toEqual(["a", "b", "b", "b", "b"]);
  expect(run.reports).toHaveLength(1); expect(run.warnings).toEqual([]);
});

it("moves forward instead of returning to a recovered primary model", async () => {
  const run = await fixture({ a: ["quota exceeded. Retry-After: 1"], b: ["overloaded", "overloaded"] }, { worker: ["faux/a", "faux/b", "faux/c"] });
  await run.spawn();
  await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: 1, until: 1_060_000 }); });
  await run.restart(1_060_000);
  await vi.waitFor(() => { expect(run.reports[0]).toContain("CHAIN-SUCCESS"); });
  expect(run.calls.map((call) => call.model)).toEqual(["a", "b", "b", "c"]);
  expect((await run.children())[0]?.fallback).toMatchObject({ from: "faux/b", to: "faux/c" });
  expect(run.warnings).toEqual([]);
});

it("cancels a chain's pending one-minute wait when the user stops the child", async () => {
  const run = await fixture({ a: ["overloaded"] });
  await run.spawn(); await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toBeDefined(); });
  await run.stop(); await run.restart(1_060_000);
  expect(run.calls.map((call) => call.model)).toEqual(["a"]);
  expect((await run.children())[0]?.retry).toBeUndefined(); expect(run.reports).toEqual([]);
});

it("keeps an admitted switch and its deadline across restart without adding the fallback twice", async () => {
  const run = await fixture({ a: ["quota exceeded"] });
  await run.cooldowns().mark("faux/b", 1_100_000, "Earlier rate limit");
  await run.spawn();
  await vi.waitFor(async () => {
    const child = (await run.children())[0];
    expect(child?.retry).toMatchObject({ attempt: 1, until: 1_030_000 });
    expect(child?.fallback).toMatchObject({ from: "faux/a", to: "faux/b" });
  });
  await run.restart(1_020_000); expect(run.calls).toHaveLength(1);
  expect((await run.children())[0]?.retry?.until).toBe(1_030_000);
  await run.restart(1_030_000);
  await vi.waitFor(() => { expect(run.reports).toHaveLength(1); });
  const resumed = (await run.history()).find((record) => record.model?.modelId === "b");
  expect(resumed?.fallbacks).toEqual([{ from: "faux/a", to: "faux/b", reason: "quota exceeded" }]);
  expect(run.calls.map((call) => call.model)).toEqual(["a", "b"]); expect(run.warnings).toEqual([]);
});

it("switches when Durable itself cannot find the configured model", async () => {
  const run = await fixture({}, { worker: ["faux/gone", "faux/b"] });
  await run.spawn(); await vi.waitFor(() => { expect(run.reports[0]).toContain("CHAIN-SUCCESS"); });
  expect(run.calls.map((call) => call.model)).toEqual(["b"]);
  expect(run.reports[0]).toContain("ran on faux/b after faux/gone: Model faux/gone is not available");
  expect(run.warnings).toEqual([]);
});

it("reports a context-window error without trying a different model", async () => {
  const run = await fixture({ a: ["maximum context length exceeded"] });
  await run.spawn(); await vi.waitFor(() => { expect(run.reports[0]).toContain("maximum context length exceeded"); });
  expect(run.calls.map((call) => call.model)).toEqual(["a"]); expect(run.warnings).toEqual([]);
});
