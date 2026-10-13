import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, defineExtension, defineTool, InboxDoc, type SubmissionRecord } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { childMessages, durableChildExtensions, durableChildRunMetadata, stopChild } from "./durableChildAgents.js";
import { decisions, decisionExtension, logDecision, overturnDecision } from "./durableDecisions.js";

async function fixture(answerQuestions = true) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-placement-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const models = createModels(); const provider = fauxProvider({tokensPerSecond: 100000}); models.setProvider(provider.provider);
  const hold = defineExtension({name: "placement-hold", tools: [defineTool({
    name: "hold", description: "Hold this turn until it is stopped", parameters: Type.Object({}), replay: "safe",
    execute: async (_args, _api, ctx) => { await sleep(60_000, undefined, {signal: ctx.abortSignal}); return {content: []}; },
  })]});
  provider.setResponses(Array.from({length: 100}, () => (request) => {
    const last = [...request.messages].reverse().find((message) => message.role !== "system");
    const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
    if (text === "Start") return fauxAssistantMessage([
      fauxToolCall("child_agent", {action: "spawn", name: "helper", message: "Ask", isolation: "shared"}), fauxToolCall("hold", {}),
    ], {stopReason: "toolUse"});
    if (text === "Ask") return fauxAssistantMessage([fauxToolCall("ask_human", {question: "Which token?"})], {stopReason: "toolUse"});
    const qid = /^\[child helper asks ([^\]]+)\]/.exec(text)?.[1];
    if (qid !== undefined && !answerQuestions) return fauxAssistantMessage("Ignoring this delivered question");
    if (qid !== undefined) return fauxAssistantMessage([fauxToolCall("child_agent", {action: "answer", name: "helper", questionId: qid, answer: "TOKEN", reason: "Task says TOKEN"})], {stopReason: "toolUse"});
    return fauxAssistantMessage(text.includes("The parent answered: TOKEN") ? "CHILD-FINISHED" : "Done");
  }));
  const registry = createRegistry(); const children = durableChildExtensions(); const decision = decisionExtension();
  for (const extension of [...children.parent, ...children.childOnly, decision, hold]) registry.install(extension);
  let now = Date.now();
  const submissions = new Map<string, SubmissionRecord>();
  const open = async () => {
    const journal = await DurableSessionJournal.open({manager, models, registry,
      agent: {cwd: root, model: {provider: "faux", modelId: "faux-1"}, extensions: [...children.parent, decision, hold]}, familyOptions: {models, registry, now: () => now}});
    journal.harness.subscribeCommits((publication) => {
      for (const change of publication.changes) if (change.type === "submission" && change.value.requestId !== undefined) submissions.set(change.value.requestId, change.value);
    });
    journal.harness.resume(); return journal;
  };
  let journal = await open();
  await journal.conversation.submit({type: "input", content: "Start"}, context);
  const deliveries = () => [...submissions.values()].filter((submission) => submission.requestId?.startsWith("child-question:") === true || submission.requestId?.startsWith("decision-overturn:") === true);
  await vi.waitFor(() => { expect(deliveries().filter((submission) => submission.status === "queued")).toHaveLength(1); });
  const child = (await durableChildRunMetadata(journal.harness, journal.conversation.id, context))['helper'];
  if (child === undefined) throw new Error("Missing child");
  return {
    journal: () => journal, child: child.conversationId, deliveries,
    queued: () => deliveries().filter((submission) => submission.status === "queued"),
    advance: () => { now += 1000; },
    restart: async () => { await journal.close(); now += 1000; journal = await open(); },
    close: async () => { await journal.close(); await rm(root, {recursive: true, force: true}); },
    overturn: async (toChild = false) => {
      await journal.conversation.commit((tx) => logDecision(tx, journal.conversation.id, {id: "d:correction", kind: "guess", by: "parent", question: "Proceed?", choice: "Yes", reason: "Best guess", flagged: true}, toChild ? child.conversationId : undefined), context);
      await overturnDecision(journal.harness, journal.conversation, "d:correction", "Use NEW", context);
    },
    parentMessages: async () => (await journal.conversation.context(context)).entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role === "user").map((message) => message.content),
  };
}

it("keeps queued questions and corrections pending across restart, then redelivers withdrawn inputs once after parent abort/reopen", async () => {
  const run = await fixture();
  try {
    await run.overturn();
    await vi.waitFor(() => { expect(run.queued()).toHaveLength(2); });
    const original = run.queued();
    await run.restart();
    expect((await run.journal().harness.snapshot(InboxDoc, run.journal().conversation.id, context))?.items).toHaveLength(2);
    const tasks = await run.journal().harness.commit(async (tx) => (await tx.scanTasks({}, 100)).items, context);
    expect(tasks.filter((task) => ["forgerie.child-question-delivery", "forgerie.decision-correction"].includes(task.kind) && task.state.status !== "terminal")).toHaveLength(2);
    // Withdrawal of a single queued receipt is not necessarily a conversation abort.
    for (const queued of original) {
      const submission = await run.journal().harness.submission(queued.id, context);
      if (submission === undefined) throw new Error("Missing queued submission");
      expect(await submission.abort(context)).toBe("aborted");
    }
    run.advance();
    await vi.waitFor(() => { expect(run.queued()).toHaveLength(2); });
    expect(run.queued().every((receipt) => !original.some((old) => old.id === receipt.id))).toBe(true);
    await run.restart();
    await run.journal().conversation.abort(context);
    await run.restart();
    await vi.waitFor(async () => {
      expect(JSON.stringify(await childMessages(run.journal().harness, run.journal().conversation.id, Number(run.child), context))).toContain("CHILD-FINISHED");
      expect((await run.parentMessages()).filter((text) => typeof text === "string" && text.startsWith("[decision d:correction overturned"))).toHaveLength(1);
    });
    expect((await run.parentMessages()).filter((text) => typeof text === "string" && text.startsWith("[child helper asks"))).toHaveLength(1);
    expect(run.deliveries().filter((receipt) => receipt.entry !== undefined)).toHaveLength(2);
    expect((await decisions(run.journal().harness, run.journal().conversation.id, context)).find((decision) => decision.id === "d:correction")?.state.kind).toBe("overturned");
    await run.restart();
    expect(run.deliveries().filter((receipt) => receipt.entry !== undefined)).toHaveLength(2);
    expect((await run.parentMessages()).filter((text) => typeof text === "string" && text.startsWith("[decision d:correction overturned"))).toHaveLength(1);
  } finally { await run.close(); }
});

it.each(["live", "gone"])("rechecks a withdrawn correction target after restart when the child is %s", async (state) => {
  const run = await fixture();
  try {
    await run.overturn(true);
    await vi.waitFor(() => { expect(run.queued()).toHaveLength(2); });
    const correction = run.queued().find((submission) => submission.requestId?.startsWith("decision-overturn:") === true);
    if (correction === undefined) throw new Error("Missing correction");
    expect(correction.conversationId).toBe(run.child);
    await run.restart();
    if (state === "gone") await stopChild(run.journal().harness, run.journal().conversation, Number(run.child), context);
    else {
      const submission = await run.journal().harness.submission(correction.id, context);
      if (submission === undefined) throw new Error("Missing correction receipt");
      expect(await submission.abort(context)).toBe("aborted");
      run.advance();
      await vi.waitFor(() => {
        expect(run.queued().find((submission) => submission.requestId?.startsWith("decision-overturn:") === true)?.conversationId).toBe(run.child);
      });
    }
    await run.journal().conversation.abort(context);
    await run.restart();
    const targetMessages = async () => state === "gone" ? run.parentMessages() : (await childMessages(run.journal().harness, run.journal().conversation.id, Number(run.child), context)).messages.filter((message) => message.role === "user").map((message) => message.content);
    const corrections = async () => (await targetMessages()).filter((text) => typeof text === "string" && text.startsWith("[decision d:correction overturned"));
    await vi.waitFor(async () => { expect(await corrections()).toHaveLength(1); });
    const placed = run.deliveries().filter((submission) => submission.requestId?.startsWith("decision-overturn:") === true && submission.entry !== undefined);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.conversationId).toBe(state === "gone" ? run.journal().conversation.id : run.child);
    await run.restart(); expect(await corrections()).toHaveLength(1);
  } finally { await run.close(); }
});

it("does not resend a question already placed before parent abort, even when its parent does not answer", async () => {
  const run = await fixture(false);
  try {
    let closing: Promise<void> | undefined;
    const closeReceipt = () => closing;
    const unsubscribe = run.journal().harness.subscribeCommits((publication) => {
      if (publication.changes.some((change) => change.type === "submission" && change.value.requestId?.startsWith("child-question:") === true && change.value.entry !== undefined)) {
        queueMicrotask(() => { closing ??= run.journal().close(); });
      }
    });
    await run.journal().conversation.abort(context); run.advance();
    await vi.waitFor(() => { expect(closing).toBeDefined(); });
    await closeReceipt(); unsubscribe();
    await run.restart();
    await run.journal().conversation.abort(context);
    await run.restart();
    await vi.waitFor(async () => {
      const task = await run.journal().harness.commit(async (tx) => (await tx.scanTasks({kind: "forgerie.child-question-delivery"}, 10)).items[0], context);
      expect(task?.state.status).toBe("terminal");
    });
    expect(run.deliveries().filter((receipt) => receipt.entry !== undefined)).toHaveLength(1);
    expect((await run.parentMessages()).filter((text) => typeof text === "string" && text.startsWith("[child helper asks"))).toHaveLength(1);
    expect(await decisions(run.journal().harness, run.journal().conversation.id, context)).toEqual([]);
    expect(JSON.stringify(await childMessages(run.journal().harness, run.journal().conversation.id, Number(run.child), context))).not.toContain("The parent answered:");
  } finally { await run.close(); }
});
