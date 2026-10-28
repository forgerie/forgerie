import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, LiveDoc } from "@earendil-works/pi-durable";
import { afterEach, expect, it, vi } from "vitest";
import type { ModelChains } from "../../shared/modelChains.js";
import { durableChildExtensions, durableChildRunMetadata, listChildren, stopChild } from "./durableChildAgents.js";
import { ChildAgentCatalog } from "./durableChildProfiles.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { ModelCooldownRegistry } from "./modelCooldownRegistry.js";
import { DurableChildRunRecords } from "./durableChildRunRecords.js";
import { ChildRunStore } from "./childRunStore.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(errors: Record<string, string[]>, chains: ModelChains = { worker: ["faux/a", "faux/b"] }, profile = "worker", keepRecentTokens = 8192) {
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
  const requests: { model: string; json: string }[] = [];
  let spawnArgs: { name: string; model?: string } = { name: "worker" };
  provider.setResponses(Array.from({ length: 100 }, () => (request, _options, _state, model) => {
    const last = request.messages.at(-1);
    const content = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
    if (model.id !== "parent") {
      calls.push({ model: model.id, at: now, content });
      requests.push({ model: model.id, json: JSON.stringify(request.messages) });
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
      familyOptions: { models, registry, now: clock, settings: { retry: { enabled: false }, compaction: { keepRecentTokens } }, onReport: (error) => { warnings.push(error); } } });
    recorder = await DurableChildRunRecords.open(journal.harness, journal.conversation.id, { id: "parent", cwd: root }, store, context, (error) => { warnings.push(error); }, clock);
    journal.harness.resume();
  }
  await open();
  cleanups.push(async () => { await recorder.close(); await journal.close(); await rm(root, { recursive: true, force: true }); });
  return {
    calls, reports, requests, warnings, chains, cooldownFile: () => readFile(cooldownPath, "utf8"), cooldowns: () => cooldowns,
    children: () => listChildren(journal.harness, journal.conversation.id, context),
    history: async () => { await recorder.flush(); return store.list(); },
    appendLegacyRetry: async (error: string) => {
      const child = Object.values(await durableChildRunMetadata(journal.harness, journal.conversation.id, context))[0];
      const conversation = child === undefined ? undefined : await journal.harness.conversation(child.conversationId, context);
      if (conversation === undefined) throw new Error("Missing child conversation");
      for (const content of [`Continue where you stopped; the last request failed with: ${error}`, "Later safe context"]) {
        await (await conversation.submit({ type: "write", entry: { kind: "test.legacy-retry", model: [{ role: "user", content, timestamp: now }] } }, context)).wait(context);
      }
    },
    compact: async () => {
      const child = Object.values(await durableChildRunMetadata(journal.harness, journal.conversation.id, context))[0];
      const conversation = child === undefined ? undefined : await journal.harness.conversation(child.conversationId, context);
      if (conversation === undefined) throw new Error("Missing child conversation");
      return journal.harness.waitForTask(await conversation.compact(undefined, context), context);
    },
    spawn: async (args?: { name: string; model?: string }) => {
      spawnArgs = args ?? { name: "worker" };
      await (await journal.conversation.submit({ type: "input", content: "SPAWN" }, context)).wait(context);
      return journal.conversation.context(context);
    },
    restart: async (at: number, failCooldownWrite = false) => { await recorder.close(); await journal.close(); now = at; cooldowns = new ModelCooldownRegistry(cooldownPath, (error) => { warnings.push(error); }); if (failCooldownWrite) vi.spyOn(cooldowns, "mark").mockRejectedValueOnce(new Error("Configured cooldown write failure")); await open(); },
    stop: async () => { const child = (await listChildren(journal.harness, journal.conversation.id, context))[0]; if (child !== undefined) await stopChild(journal.harness, journal.conversation, child.conversationId, context); },
    idle: async () => { await vi.waitFor(async () => { expect((await journal.harness.snapshot(LiveDoc, journal.conversation.id, context))?.run).toBeUndefined(); }); },
  };
}

it("finishes on B after A runs out of quota and records the fallback in the report, children and run history", async () => {
  const run = await fixture({ a: ["insufficient_quota"] });
  await run.spawn();
  await vi.waitFor(() => { expect(run.reports[0]).toContain("CHAIN-SUCCESS"); });
  expect(run.calls.map((call) => call.model)).toEqual(["a", "b"]);
  expect(run.calls[1]?.content).toBe("Continue where you stopped; the previous model was unavailable.");
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
  const run = await fixture({ b: ["billing limit exhausted", "billing limit exhausted", "billing limit exhausted: final error"] });
  await run.cooldowns().mark("faux/a", 9_000_000, "quota A"); await run.cooldowns().mark("faux/b", 8_000_000, "quota B");
  await run.spawn(); let at = 1_000_000;
  for (const [index, delay] of [30_000, 120_000, 300_000].entries()) {
    at += delay;
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: index + 1, until: at }); });
    expect(run.calls).toHaveLength(index);
    await run.restart(at);
  }
  await vi.waitFor(() => { expect(run.reports[0]).toContain("billing limit exhausted: final error"); });
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
  const run = await fixture({ a: ["quota exceeded"], b: ["billing limit exhausted", "billing limit exhausted", "billing limit exhausted", "billing limit exhausted: final error"] });
  await run.spawn(); let at = 1_000_000;
  for (const [index, delay] of [30_000, 120_000, 300_000].entries()) {
    at += delay;
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: index + 1, until: at }); });
    await run.restart(at);
  }
  await vi.waitFor(() => { expect(run.reports[0]).toContain("billing limit exhausted: final error"); });
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

it.each([false, true])("does not shorten a stored cooldown while planning exhaustion (mark fails: %s)", async (failCooldownWrite) => {
  const run = await fixture({ a: ["HTTP 429", "HTTP 429. Retry-After: 1"] });
  await run.spawn(); await vi.waitFor(async () => { expect((await run.children())[0]?.retry?.until).toBe(1_060_000); });
  await run.cooldowns().mark("faux/a", 9_000_000, "Stored A cooldown");
  await run.cooldowns().mark("faux/b", 2_000_000, "Stored B cooldown");
  await run.restart(1_060_000, failCooldownWrite);
  await vi.waitFor(async () => {
    const child = (await run.children())[0];
    expect(child?.fallback).toMatchObject({ from: "faux/a", to: "faux/b" });
    expect(child?.retry?.until).toBe(1_090_000);
  });
  expect((await run.cooldowns().snapshot())["faux/a"]?.until).toBe(9_000_000);
  expect(run.warnings).toHaveLength(failCooldownWrite ? 1 : 0);
});

it("keeps credential errors out of fallback requests, shared cooldowns, children, history and reports", async () => {
  const secret = "sk-review-fixture-SECRET";
  const run = await fixture({ a: [`Incorrect API key provided: ${secret}`] });
  await run.spawn(); await vi.waitFor(() => { expect(run.reports).toHaveLength(1); });
  expect(run.calls[1]?.content).toBe("Continue where you stopped; the previous model was unavailable.");
  expect(JSON.stringify(run.requests.filter((request) => request.model === "b"))).not.toContain(secret);
  expect(await run.cooldownFile()).not.toContain(secret);
  expect(JSON.stringify(await run.cooldowns().snapshot())).not.toContain(secret);
  expect(JSON.stringify(await run.children())).not.toContain(secret);
  expect(JSON.stringify(await run.history())).not.toContain(secret);
  expect(JSON.stringify(run.reports)).not.toContain(secret);
  await run.idle(); await run.restart(1_000_000); await run.spawn({ name: "another" });
  await vi.waitFor(() => { expect(run.reports).toHaveLength(2); });
  expect(JSON.stringify([await run.children(), await run.history(), run.requests, run.reports])).not.toContain(secret);
});

it("sanitizes the legacy same-model retry and final failure report without changing its schedule", async () => {
  const secret = "private-fixture-secret";
  const error = `HTTP 429. api_key=${secret}`;
  const run = await fixture({ a: [error, error, error, error] }, { worker: ["faux/a"] });
  await run.spawn(); let at = 1_000_000;
  for (const [index, delay] of [30_000, 120_000, 300_000].entries()) {
    at += delay;
    await vi.waitFor(async () => { expect((await run.children())[0]?.retry).toMatchObject({ attempt: index + 1, until: at }); });
    expect(JSON.stringify(await run.children())).not.toContain(secret);
    await run.restart(at);
  }
  await vi.waitFor(() => { expect(run.reports).toHaveLength(1); });
  expect(JSON.stringify([run.requests, run.reports, await run.history(), await run.cooldowns().snapshot()])).not.toContain(secret);
  expect(await run.cooldownFile()).not.toContain(secret);
});

it("classifies before bounded diagnostics truncate a decisive provider code", async () => {
  const run = await fixture({ a: [`${"ordinary provider detail ".repeat(30)}insufficient_quota sk-review-fixture-SECRET`] });
  await run.spawn(); await vi.waitFor(() => { expect(run.reports[0]).toContain("CHAIN-SUCCESS"); });
  expect(run.calls.map((call) => call.model)).toEqual(["a", "b"]);
  expect((await run.children())[0]?.fallback?.reason.length).toBeLessThanOrEqual(300);
  expect(JSON.stringify([run.reports, await run.history(), await run.children()])).not.toContain("sk-review-fixture-SECRET");
});

it.each([false, true])("keeps provider diagnostics out of native compaction requests (sensitive: %s)", async (sensitive) => {
  const secret = "sk-review-fixture-SECRET";
  const run = await fixture({ a: [sensitive ? `Incorrect API key provided: ${secret}` : "insufficient_quota"] }, undefined, undefined, 1);
  await run.spawn(); await vi.waitFor(() => { expect(run.reports).toHaveLength(1); });
  await run.idle();
  const task = await run.compact();
  expect(task.state.outcome.status).toBe("completed");
  expect(run.calls.map((call) => call.model)).toEqual(["a", "b", "b"]);
  expect(JSON.stringify(run.requests)).not.toContain(secret);
  expect(run.warnings).toEqual([]);
});

it("declines native compaction of an old raw retry prompt instead of exposing its secret", async () => {
  const run = await fixture({}, undefined, undefined, 1);
  await run.spawn(); await vi.waitFor(() => { expect(run.reports).toHaveLength(1); }); await run.idle();
  await run.appendLegacyRetry("HTTP 429 api_key=private-fixture-secret");
  const task = await run.compact();
  expect(task.state.outcome.status).toBe("completed"); expect(run.calls).toHaveLength(1);
  expect(JSON.stringify(run.requests)).not.toContain("private-fixture-secret");
});

it.each(["Invalid API key: private-fixture-secret", "Incorrect API key provided: private-fixture-secret"])("keeps labelled credential text out of every reporter output: %s", async (error) => {
  const run = await fixture({ a: [error] });
  await run.spawn(); await vi.waitFor(() => { expect(run.reports).toHaveLength(1); });
  const outputs = JSON.stringify([await run.children(), await run.history(), run.reports, await run.cooldowns().snapshot(), await run.cooldownFile(), run.requests]);
  expect(outputs).not.toContain("private-fixture-secret"); expect(outputs).toContain("invalid credentials");
});
