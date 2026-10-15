import { decisionAnnotations } from "../decisions/optionalDecisionAnnotations.js";
import { RISK_LABEL_ENTRY_KIND } from "../../shared/riskLabels.js";
import type { RiskLabelOptions } from "../decisions/riskLabels.js";
import { readDecisionHintsSettings } from "../decisions/decisionHintsSettings.js";
import type { DecisionAnswers } from "../decisions/decisionClient.js";
import { assertDecisionHintOffEquivalence } from "../decisions/decisionHintsOffEquivalence.testSupport.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { AssistantEntry, ToolTask, createRegistry, defineExtension, defineTool, UsageDoc, type ConversationId, type TaskId } from "@earendil-works/pi-durable";
import { Check } from "typebox/value";
import { GatedActionEntrySchema } from "../../shared/gatedActions.js";
import { Type } from "typebox";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAutonomyPolicy } from "../../shared/autonomyPolicy.js";
import { durableChildExtensions, listChildren } from "./durableChildAgents.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { decisions, decisionExtension } from "./durableDecisions.js";
import { gatedActions, gatedActionsExtension, decideGatedAction, waitingGatedActions, GATED_ACTIONS_DOC_KIND, gatedActionsChanged } from "./durableGatedActions.js";

const roots: string[] = []; const journals: DurableSessionJournal[] = [];
afterEach(async () => { for (const journal of journals) await journal.close(); for (const root of roots) await rm(root, {recursive: true, force: true}); journals.length = 0; roots.length = 0; });
async function fixture(riskLabels?: RiskLabelOptions) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-gates-")); roots.push(root);
  const manager = SessionManager.create(root, join(root, "sessions"));
  const state = {runs: 0, hold: false, delay: false, fail: false, childHold: false, childEntered: false, paid: false, gated: true};
  const models = createModels(); const provider = fauxProvider({tokensPerSecond: 100000}); models.setProvider(provider.provider);
  provider.setResponses(Array.from({length: 100}, () => request => {
    const last = request.messages.at(-1);
    if (last?.role === "user" && last.content === "Work" && state.childHold) return fauxAssistantMessage([fauxToolCall("hold", {})], {stopReason: "toolUse"});
    return fauxAssistantMessage("Received result");
  }));
  const registry = createRegistry();
  const tool = defineTool({name: "mcp_ebay_seller_update", description: "Update", parameters: Type.Object({value: Type.String()}), replay: "unsafe", execute: async (args, _api, ctx) => {
    state.runs++; await writeFile(join(root, "effect"), args.value);
    while (state.hold) await sleep(5, undefined, {signal: ctx.abortSignal});
    if (state.delay) await sleep(60000, undefined, {signal: ctx.abortSignal});
    if (state.fail) throw new Error("Configured failure");
    return {content: [{type: "text" as const, text: "EXACT RESULT " + args.value}], ...(state.paid ? {usage: {input: 1, output: 2, totalTokens: 3, cacheRead: 0, cacheWrite: 0, cost: {input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3}}} : {})};
  }});
  const hold = defineTool({name: "hold", description: "Continue independent work", parameters: Type.Object({}), execute: async (_args, _api, ctx) => {
    state.childEntered = true;
    while (state.childHold) await sleep(10, undefined, {signal: ctx.abortSignal});
    return {content: [{type: "text" as const, text: "Independent work completed"}]};
  }});
  const children = durableChildExtensions({extraTools: [tool, hold]}); const tools = defineExtension({name: "test.tools", tools: [tool]}); const decision = decisionExtension();
  for (const extension of [...children.parent, ...children.childOnly, tools, decision]) registry.install(extension);
  const options = {manager, models, registry, env: ({cwd}: {cwd?: string}) => new NodeExecutionEnv({cwd: cwd ?? root}), agent: {cwd: root, model: {provider: "faux", modelId: "faux-1"}, extensions: [...children.parent, tools, decision]}};
  let journal = await DurableSessionJournal.open(options); journals.push(journal);
  const gate = gatedActionsExtension({...(riskLabels === undefined ? {} : {riskLabels}), parent: journal.conversation.id, harness: () => journal.harness, policy: {read: () => Promise.resolve({...structuredClone(defaultAutonomyPolicy), gated: {...defaultAutonomyPolicy.gated, messages: state.gated}})}, reads: {git: () => Promise.resolve(""), issueLabels: () => Promise.resolve([])}});
  registry.install(gate); await journal.conversation.configure({extensions: {add: [gate]}}, context);
  const reopen = async () => { await journal.close(); journal = await DurableSessionJournal.open(options); journals.push(journal); return journal; };
  return {root, state, get journal() {return journal;}, reopen};
}
async function call(journal: DurableSessionJournal, name = "mcp_ebay_seller_update", args: Record<string, string> = {value: "original"}, target = journal.conversation.id) {
  return journal.conversation.commit(async tx => {
    const entry = await tx.appendEntry(AssistantEntry, target, {model: [fauxAssistantMessage([fauxToolCall(name, args, {id: "call"})], {stopReason: "toolUse"})]});
    return tx.createTask(ToolTask, {assistant: entry.id, callId: "call"}, {conversationId: target, ownership: {kind: "conversation"}});
  }, context);
}
async function blocked(f: Awaited<ReturnType<typeof fixture>>, target?: ConversationId) {
  const task = await call(f.journal, undefined, undefined, target); f.journal.harness.resume();
  await f.journal.harness.waitForTask(task, context);
  const records = await gatedActions(f.journal.harness, f.journal.conversation.id, context);
  expect(records).toHaveLength(1); expect(records[0]).toMatchObject({state: {kind: "waiting"}, args: {value: "original"}});
  expect(f.state.runs).toBe(0); return records[0]?.id ?? "missing";
}
it("blocks the parent, admits approval atomically, runs once, and places one result", async () => {
  const f = await fixture(); const id = await blocked(f);
  expect(await waitingGatedActions(f.journal.harness, f.journal.conversation.id, context)).toBe(1);
  const transcript = JSON.stringify((await f.journal.conversation.context(context)).entries);
  expect(transcript).toContain("Blocked until the user approves"); expect(transcript).toContain("forgerie.gated-action");
  const approved = await decideGatedAction(f.journal.harness, f.journal.conversation, id, "approved", context);
  expect(approved.state.kind).toBe("approved");
  await expect(decideGatedAction(f.journal.harness, f.journal.conversation, id, "approved", context)).rejects.toThrow("not waiting");
  await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe("ran"); });
  await vi.waitFor(async () => { expect(JSON.stringify((await f.journal.conversation.context(context)).entries)).toContain("EXACT RESULT original"); });
  expect(f.state.runs).toBe(1); expect(await readFile(join(f.root, "effect"), "utf8")).toBe("original");
  expect(await decisions(f.journal.harness, f.journal.conversation.id, context)).toMatchObject([{kind: "gated", by: "user", choice: "approved"}]);
  expect(await waitingGatedActions(f.journal.harness, f.journal.conversation.id, context)).toBe(0);
  await f.reopen(); f.journal.harness.resume(); await sleep(50); expect(f.state.runs).toBe(1);
  const inputs = (await f.journal.conversation.context(context)).entries.flatMap(e => e.model ?? []).filter(m => m.role === "user" && JSON.stringify(m.content).includes(`Gate ${id} ran`));
  expect(inputs).toHaveLength(1);
});
it("selects the hook for child tool calls even though child tools replace the owner's loadout", async () => {
  const f = await fixture(); const spawn = await call(f.journal, "child_agent", {action: "spawn", name: "helper", message: "Work", isolation: "shared"});
  f.journal.harness.resume(); await f.journal.harness.waitForTask(spawn, context);
  const child = (await listChildren(f.journal.harness, f.journal.conversation.id, context))[0]; expect(child).toBeDefined();
  if (child === undefined) throw new Error("Missing child");
  const target = await f.journal.harness.commit(async tx => (await tx.scanConversations({}, 100)).items.find(item => Number(item.id) === child.conversationId)?.id, context);
  if (target === undefined) throw new Error("Missing child conversation");
  await blocked(f, target);
  expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.conversationId).toBe(target);
  expect((await (await f.journal.harness.conversation(target, context))?.context(context))?.entries.some(e => JSON.stringify(e).includes("Blocked until"))).toBe(true);
});
it("refuses without running and tells the parent when the child is gone", async () => {
  const f = await fixture(); const id = await blocked(f);
  expect((await decideGatedAction(f.journal.harness, f.journal.conversation, id, "refused", context)).state.kind).toBe("refused");
  await vi.waitFor(async () => { expect(JSON.stringify((await f.journal.conversation.context(context)).entries)).toContain(`The user refused gate ${id}:`); });
  expect(f.state.runs).toBe(0);
  expect(await decisions(f.journal.harness, f.journal.conversation.id, context)).toMatchObject([{choice: "refused"}]);
  await expect(decideGatedAction(f.journal.harness, f.journal.conversation, id, "refused", context)).rejects.toThrow("not waiting");
  await expect(decideGatedAction(f.journal.harness, f.journal.conversation, "foreign", "approved", context)).rejects.toThrow("not found");
});
it("replays a crash after gate admission without a second gate", async () => {
  const f = await fixture(); let closing: Promise<void> | undefined;
  const unsubscribe = f.journal.harness.subscribeCommits(publication => {
    if (publication.changes.some(c => c.type === "document" && c.record.kind === GATED_ACTIONS_DOC_KIND)) queueMicrotask(() => { closing ??= f.journal.close(); });
  });
  await call(f.journal); f.journal.harness.resume();
  await vi.waitFor(() => { expect(closing).toBeDefined(); }); await closing; unsubscribe();
  await f.reopen(); f.journal.harness.resume();
  await vi.waitFor(async () => { const tasks = await f.journal.harness.commit(async tx => (await tx.scanTasks({kind: "pi.tool"}, 20)).items, context); expect(tasks.every(t => t.state.status === "terminal")).toBe(true); });
  expect(await gatedActions(f.journal.harness, f.journal.conversation.id, context)).toHaveLength(1);
  expect((await f.journal.conversation.context(context)).entries.filter(e => e.kind === "forgerie.gated-action")).toHaveLength(1);
  expect(f.state.runs).toBe(0);
});
it.each(["approval", "intent", "effect"])("recovers a crash at %s without repeating an effect", async stage => {
  const f = await fixture(); const id = await blocked(f); f.state.delay = stage === "effect";
  let closing: Promise<void> | undefined; let runTask: TaskId | undefined;
  const unsubscribe = f.journal.harness.subscribeCommits(publication => {
    for (const change of publication.changes) {
      if (change.type !== "task" || change.value.kind !== "forgerie.gated-action-run") continue;
      runTask = change.value.id;
      const checkpoint = change.value.state.status === "running" ? change.value.state.checkpoint : undefined;
      const phase = checkpoint !== null && typeof checkpoint === "object" && "phase" in checkpoint ? checkpoint["phase"] : undefined;
      if ((stage === "approval" && change.value.state.status === "running" && phase === "ready") || (stage === "intent" && change.value.state.status === "running" && phase === "unknown")) queueMicrotask(() => { closing ??= f.journal.close(); });
    }
  });
  await decideGatedAction(f.journal.harness, f.journal.conversation, id, "approved", context);
  if (stage === "effect") { await vi.waitFor(() => { expect(f.state.runs).toBe(1); }); closing = f.journal.close(); }
  await vi.waitFor(() => { expect(closing).toBeDefined(); }); await closing; unsubscribe(); f.state.delay = false;
  const before = f.state.runs; await f.reopen(); f.journal.harness.resume();
  if (runTask !== undefined) await f.journal.harness.waitForTask(runTask, context);
  const record = (await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0];
  if (stage === "approval") { expect(record?.state.kind).toBe("ran"); expect(f.state.runs).toBe(1); }
  else {
    expect(record?.state.kind).toBe("failed"); if (record?.state.kind === "failed") expect(record.state.error).toContain("Unknown outcome"); expect(f.state.runs).toBe(before);
    await vi.waitFor(async () => { expect(JSON.stringify((await f.journal.conversation.context(context)).entries)).toContain("Unknown outcome:"); });
  }
});
it("stores a failed tool result and delivers its error", async () => {
  const f = await fixture(); f.state.fail = true; const id = await blocked(f);
  await decideGatedAction(f.journal.harness, f.journal.conversation, id, "approved", context);
  await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state).toMatchObject({kind: "failed", error: "Configured failure"}); });
});
it("places the approved result in a still-live child's transcript, not the parent's", async () => {
  const f = await fixture(); f.state.childHold = true;
  const spawn = await call(f.journal, "child_agent", {action: "spawn", name: "helper", message: "Work", isolation: "shared"});
  f.journal.harness.resume(); await f.journal.harness.waitForTask(spawn, context);
  const child = (await listChildren(f.journal.harness, f.journal.conversation.id, context))[0];
  if (child === undefined) throw new Error("Missing child");
  await vi.waitFor(async () => { expect((await listChildren(f.journal.harness, f.journal.conversation.id, context))[0]?.busy).toBe(true); });
  await vi.waitFor(() => { expect(f.state.childEntered).toBe(true); });
  const target = await f.journal.harness.commit(async tx => (await tx.scanConversations({}, 100)).items.find(item => Number(item.id) === child.conversationId)?.id, context);
  if (target === undefined) throw new Error("Missing child conversation");
  const id = await blocked(f, target);
  await decideGatedAction(f.journal.harness, f.journal.conversation, id, "approved", context);
  await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe("ran"); });
  f.state.childHold = false;
  await vi.waitFor(async () => { expect(JSON.stringify((await (await f.journal.harness.conversation(target, context))?.context(context))?.entries)).toContain(`Gate ${id} ran:`); });
  expect(JSON.stringify((await f.journal.conversation.context(context)).entries)).not.toContain(`Gate ${id} ran:`);
  expect(f.state.runs).toBe(1);
});
it("reads the injectable policy and does not gate a disabled category", async () => {
  const f = await fixture(); f.state.gated = false;
  const task = await call(f.journal); f.journal.harness.resume(); await f.journal.harness.waitForTask(task, context);
  expect(await gatedActions(f.journal.harness, f.journal.conversation.id, context)).toEqual([]); expect(f.state.runs).toBe(1);
});
it("returns independent gates newest first for separate calls", async () => {
  const f = await fixture(); await blocked(f); await sleep(2);
  const task = await call(f.journal, undefined, {value: "newer"}); f.journal.harness.resume(); await f.journal.harness.waitForTask(task, context);
  expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context)).map(g => g.args["value"])).toEqual(["newer", "original"]);
});
it("runs child-native bash in the saved child cwd, then routes the idle child's result to the parent", async () => {
  const f = await fixture(); const cwd = join(f.root, "child-repo"); await mkdir(cwd);
  const git = (...args: string[]) => promisify(execFile)("git", ["-C", cwd, ...args]);
  await git("init", "-b", "main"); await writeFile(join(cwd, "base"), "original"); await git("add", "base");
  await git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Base");
  await writeFile(join(cwd, "base"), "dirty");
  const spawn = await call(f.journal, "child_agent", {action: "spawn", name: "native", message: "Finish", isolation: "shared"});
  f.journal.harness.resume(); await f.journal.harness.waitForTask(spawn, context);
  const target = await f.journal.harness.commit(async tx => (await tx.scanConversations({}, 100)).items.find(item => item.id !== f.journal.conversation.id)?.id, context);
  if (target === undefined) throw new Error("Missing child");
  const child = await f.journal.harness.conversation(target, context); if (child === undefined) throw new Error("Missing child");
  await child.waitForIdle(context); await child.configure({cwd}, context);
  const args = {command: "git reset --hard; pwd > native-cwd.txt"};
  const task = await call(f.journal, "bash", args, target); await f.journal.harness.waitForTask(task, context);
  const gate = (await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]; if (gate === undefined) throw new Error("Missing gate");
  expect(gate.args).toEqual(args); expect(await readFile(join(cwd, "base"), "utf8")).toBe("dirty");
  await decideGatedAction(f.journal.harness, f.journal.conversation, gate.id, "approved", context);
  await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe("ran"); });
  expect((await readFile(join(cwd, "native-cwd.txt"), "utf8")).trim()).toBe(cwd); expect(await readFile(join(cwd, "base"), "utf8")).toBe("original");
  await vi.waitFor(async () => { expect(JSON.stringify((await f.journal.conversation.context(context)).entries)).toContain(`Gate ${gate.id} ran:`); });
});
it("records approved tool spend on the originating conversation once", async () => {
  const f = await fixture(); f.state.paid = true; const id = await blocked(f);
  await decideGatedAction(f.journal.harness, f.journal.conversation, id, "approved", context);
  await vi.waitFor(async () => { expect((await f.journal.harness.snapshot(UsageDoc, f.journal.conversation.id, context))?.tools["mcp_ebay_seller_update"]?.totalTokens).toBe(3); });
  await f.reopen(); f.journal.harness.resume(); await sleep(30);
  expect((await f.journal.harness.snapshot(UsageDoc, f.journal.conversation.id, context))?.tools["mcp_ebay_seller_update"]?.totalTokens).toBe(3);
});

it("redacts obvious secrets only in the card preview, preserving exact saved arguments", async () => {
  const f = await fixture();
  const value = `https://user:URL_SECRET@example.invalid/path --password="PASSWORD SECRET" --token=TOKEN_SECRET Authorization: Bearer HEADER_SECRET`;
  const task = await call(f.journal, "mcp_ebay_seller_update", {value}); f.journal.harness.resume(); await f.journal.harness.waitForTask(task, context);
  const gate = (await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0];
  expect(gate?.args).toEqual({value});
  const entry = (await f.journal.conversation.context(context)).entries.find(item => item.kind === "forgerie.gated-action");
  if (!Check(GatedActionEntrySchema, entry?.data)) throw new Error("Missing gated preview");
  expect(entry.data.command).toContain("[redacted]"); expect(entry.data.command).toContain("example.invalid/path");
  for (const secret of ["URL_SECRET", "PASSWORD SECRET", "TOKEN_SECRET", "HEADER_SECRET"]) expect(entry.data.command).not.toContain(secret);
  if (gate === undefined) throw new Error("Missing gate");
  await decideGatedAction(f.journal.harness, f.journal.conversation, gate.id, "approved", context);
  await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe("ran"); });
  expect(await readFile(join(f.root, "effect"), "utf8")).toBe(value);
});

const labelSettings = { ...readDecisionHintsSettings({}), enabled: true, baseUrl: "http://gateway.invalid" };
const labelAnswers: DecisionAnswers = { model: "risk-model", answers: {
  deletes_data: {type: "noul", noul: 0.9}, outside_worktree: {type: "noul", noul: 0.8}, acts_as_user: {type: "noul", noul: 1},
  risk: {type: "score", score: 2, probabilities: {"0": 0, "1": 0, "2": 1}, confidence: 1},
} };
it.each(["approved", "refused"] as const)("a late label cannot change %s, its decision, execution or response count", async choice => {
  let answer: ((value: DecisionAnswers) => void) | undefined;
  const errors: unknown[] = []; let asks = 0;
  const f = await fixture({hints: {client: {ask: () => { asks++; return new Promise(resolve => {answer = resolve;}); }}, readSettings: () => labelSettings}, onError: error => {errors.push(error);} });
  const id = await blocked(f);
  const changed: boolean[] = []; const labels: boolean[] = [];
  const offLabels = decisionAnnotations(f.journal.harness).subscribe((scope, key) => { if (scope === String(f.journal.conversation.id) && key.startsWith("gate:")) labels.push(true); });
  const unsubscribe = f.journal.harness.subscribeCommits(publication => {
    if (!publication.changes.some(change => change.type === "entry" && change.value.kind === RISK_LABEL_ENTRY_KIND)) return;
    changed.push(gatedActionsChanged(publication, f.journal.conversation.id));
  });
  try {
    await decideGatedAction(f.journal.harness, f.journal.conversation, id, choice, context);
    await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe(choice === "approved" ? "ran" : "refused"); });
    const before = (await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0];
    const beforeDecisions = await decisions(f.journal.harness, f.journal.conversation.id, context);
    expect(answer).toBeDefined(); answer?.(labelAnswers);
    await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.riskLabel?.model).toBe("risk-model"); });
    const after = (await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0];
    const {riskLabel, ...unchanged} = after ?? {};
    expect(unchanged).toStrictEqual(before); expect(riskLabel?.risk).toBe("danger");
    expect(await decisions(f.journal.harness, f.journal.conversation.id, context)).toStrictEqual(beforeDecisions);
    expect(await waitingGatedActions(f.journal.harness, f.journal.conversation.id, context)).toBe(0);
    expect(f.state.runs).toBe(choice === "approved" ? 1 : 0); expect(asks).toBe(1);
    expect(changed).toEqual([]); expect(labels).toEqual([true]); expect(errors).toEqual([]);
    await f.reopen();
    expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.riskLabel).toBeUndefined();
  } finally {unsubscribe(); offLabels();}
});

it.each(["approved", "refused"] as const)("gate %s has off-equivalence, including an unreachable and hanging gateway", async choice => {
  await assertDecisionHintOffEquivalence(async ({client, settings}) => {
    const f = await fixture(client === undefined ? undefined : {hints: {client, readSettings: () => settings}, onError: error => {throw error;} });
    const phases: string[] = [];
    const unsubscribe = f.journal.harness.subscribeCommits(publication => {
      for (const change of publication.changes) {
        if (change.type !== "task" || change.value.kind !== "forgerie.gated-action-run") continue;
        phases.push(JSON.stringify(change.value.state));
      }
    });
    const id = await blocked(f);
    const waiting = await waitingGatedActions(f.journal.harness, f.journal.conversation.id, context);
    const admitted = await decideGatedAction(f.journal.harness, f.journal.conversation, id, choice, context);
    await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe(choice === "approved" ? "ran" : "refused"); });
    return {dispose: unsubscribe, observe: async () => ({waiting, admitted: admitted.state.kind, runs: f.state.runs, phases,
      state: (await gatedActions(f.journal.harness, f.journal.conversation.id, context)).map(gate => ({tool: gate.tool, args: gate.args, category: gate.category, state: gate.state.kind, label: gate.riskLabel})),
      decisions: (await decisions(f.journal.harness, f.journal.conversation.id, context)).map(decision => ({kind: decision.kind, by: decision.by, choice: decision.choice})),
      waitingAfter: await waitingGatedActions(f.journal.harness, f.journal.conversation.id, context),
    })};
  }, {timeoutMs: 3000});
});

it.each(["approved", "refused"] as const)("an early label is information only when the user chooses %s", async choice => {
  const f = await fixture({hints: {client: {ask: () => Promise.resolve(labelAnswers)}, readSettings: () => labelSettings}, onError: error => {throw error;} });
  const id = await blocked(f);
  await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.riskLabel?.risk).toBe("danger"); });
  expect(await waitingGatedActions(f.journal.harness, f.journal.conversation.id, context)).toBe(1);
  expect(await decisions(f.journal.harness, f.journal.conversation.id, context)).toEqual([]); expect(f.state.runs).toBe(0);
  await decideGatedAction(f.journal.harness, f.journal.conversation, id, choice, context);
  await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe(choice === "approved" ? "ran" : "refused"); });
  expect(f.state.runs).toBe(choice === "approved" ? 1 : 0);
});

it("a label between execution intent and result cannot change the approved run or repeat its effect", async () => {
  let answer: ((value: DecisionAnswers) => void) | undefined;
  const f = await fixture({hints: {client: {ask: () => new Promise(resolve => {answer = resolve;})}, readSettings: () => labelSettings}, onError: error => {throw error;} });
  f.state.hold = true;
  const id = await blocked(f);
  let intent = false;
  const unsubscribe = f.journal.harness.subscribeCommits(publication => {
    for (const change of publication.changes) {
      if (change.type === "task" && change.value.kind === "forgerie.gated-action-run" && change.value.state.status === "running"
        && JSON.stringify(change.value.state.checkpoint) === '{"phase":"unknown"}') intent = true;
    }
  });
  try {
    await decideGatedAction(f.journal.harness, f.journal.conversation, id, "approved", context);
    await vi.waitFor(() => {expect(f.state.runs).toBe(1);}); expect(intent).toBe(true);
    answer?.(labelAnswers);
    await vi.waitFor(async () => {expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]).toMatchObject({state: {kind: "approved"}, riskLabel: {risk: "danger"}});});
    expect(await decisions(f.journal.harness, f.journal.conversation.id, context)).toMatchObject([{kind: "gated", by: "user", choice: "approved"}]);
    f.state.hold = false;
    await vi.waitFor(async () => {expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe("ran");});
    expect(f.state.runs).toBe(1); expect(await readFile(join(f.root, "effect"), "utf8")).toBe("original");
  } finally {f.state.hold = false; unsubscribe();}
});

it("redacts gate hint arguments without changing the saved call or its approved execution", async () => {
  const requests: unknown[] = [];
  const f = await fixture({hints: {client: {ask: request => {requests.push(request); return Promise.resolve(labelAnswers);}}, readSettings: () => labelSettings}, onError: error => {throw error;} });
  const value = "Send --token=must-stay-local";
  const task = await call(f.journal, "mcp_ebay_seller_update", {value});
  f.journal.harness.resume(); await f.journal.harness.waitForTask(task, context);
  const gate = (await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0];
  if (gate === undefined) throw new Error("Missing gate");
  expect(gate).toMatchObject({args: {value}, state: {kind: "waiting"}}); expect(f.state.runs).toBe(0);
  await vi.waitFor(() => {expect(requests).toHaveLength(1);});
  expect(requests[0]).toMatchObject({state: {arguments: JSON.stringify({value: "Send --token=[redacted]"})}});
  expect(JSON.stringify(requests)).not.toContain("must-stay-local");
  await decideGatedAction(f.journal.harness, f.journal.conversation, gate.id, "approved", context);
  await vi.waitFor(async () => {expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe("ran");});
  expect(await readFile(join(f.root, "effect"), "utf8")).toBe(value);
  expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.args).toEqual({value});
  expect(f.state.runs).toBe(1);
});

it.each(["approved", "refused"] as const)("a rejected gate-label write cannot poison later gate %s or admission", async choice => {
  let answer: ((value: DecisionAnswers) => void) | undefined;
  const errors: unknown[] = [];
  const f = await fixture({ hints: { client: { ask: () => new Promise(resolve => { answer = resolve; }) }, readSettings: () => labelSettings }, onError: error => { errors.push(error); } });
  const id = await blocked(f);
  vi.spyOn(decisionAnnotations(f.journal.harness), "write").mockRejectedValueOnce(new Error("gate label write rejected"));
  answer?.(labelAnswers);
  await vi.waitFor(() => { expect(errors).toHaveLength(1); });
  expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.riskLabel).toBeUndefined();
  await decideGatedAction(f.journal.harness, f.journal.conversation, id, choice, context);
  await vi.waitFor(async () => { expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.state.kind).toBe(choice === "approved" ? "ran" : "refused"); });
  const next = await call(f.journal, undefined, { value: "later admission" });
  f.journal.harness.resume(); await f.journal.harness.waitForTask(next, context);
  expect(await waitingGatedActions(f.journal.harness, f.journal.conversation.id, context)).toBe(1);
  expect(f.state.runs).toBe(choice === "approved" ? 1 : 0);
  expect((await f.journal.conversation.context(context)).entries.some(entry => entry.kind === RISK_LABEL_ENTRY_KIND)).toBe(false);
});

it.each(["enabled", "risk_labels"] as const)("gate overlays hide existing labels when the live %s switch is off", async key => {
  const live = {...labelSettings};
  const f = await fixture({hints: {client: {ask: () => Promise.resolve(labelAnswers)}, readSettings: () => live}, onError: error => {throw error;} });
  await blocked(f);
  await vi.waitFor(async () => {expect((await gatedActions(f.journal.harness, f.journal.conversation.id, context))[0]?.riskLabel?.model).toBe("risk-model");});
  live[key] = false;
  const gates = await gatedActions(f.journal.harness, f.journal.conversation.id, context);
  expect(gates[0]?.riskLabel).toBeUndefined(); expect(gates[0]?.state.kind).toBe("waiting"); expect(f.state.runs).toBe(0);
  expect(await waitingGatedActions(f.journal.harness, f.journal.conversation.id, context)).toBe(1);
});
