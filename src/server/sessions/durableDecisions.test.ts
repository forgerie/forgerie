import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { durableChildExtensions, listChildren, childMessages } from "./durableChildAgents.js";
import { decisions, decisionExtension, logDecision, overturnDecision, DECISIONS_DOC_KIND } from "./durableDecisions.js";

it("logs future slice kinds once and does not duplicate a placed correction after abort/reopen", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-decisions-replay-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const models = createModels(); const provider = fauxProvider({tokensPerSecond: 100000}); models.setProvider(provider.provider);
  provider.setResponses(Array.from({length: 10}, () => fauxAssistantMessage("Redo complete")));
  const registry = createRegistry(); const extension = decisionExtension(); registry.install(extension);
  const open = () => DurableSessionJournal.open({manager, models, registry, agent: {model: {provider: "faux", modelId: "faux-1"}, extensions: [extension]}});
  let journal = await open();
  try {
    for (const kind of ["gated", "auto-stop", "issue"] as const) {
      const input = {id: `d:${kind}`, kind, by: kind === "gated" ? "user" : "parent", question: "Proceed?", choice: "Proceed", reason: "Policy allows it", flagged: false};
      const log = () => journal.conversation.commit((tx) => logDecision(tx, journal.conversation.id, input), context);
      expect(await log()).toEqual(await log());
    }
    expect(await decisions(journal.harness, journal.conversation.id, context)).toHaveLength(3);
    let closing: Promise<void> | undefined;
    const closeReceipt = () => closing;
    let atomicOverturn = false;
    const unsubscribe = journal.harness.subscribeCommits((publication) => {
      if (publication.changes.some((change) => change.type === "task" && change.value.kind === "forgerie.decision-correction")) {
        atomicOverturn ||= publication.changes.some((change) => change.type === "document" && change.record.kind === DECISIONS_DOC_KIND);
      }
      if (publication.changes.some((change) => change.type === "submission" && change.value.requestId === "decision-overturn:d:issue")) {
        queueMicrotask(() => { closing ??= journal.close(); });
      }
    });
    await overturnDecision(journal.harness, journal.conversation, "d:issue", "Do not file it", context);
    await vi.waitFor(() => { expect(closing).toBeDefined(); });
    await closeReceipt(); unsubscribe(); expect(atomicOverturn).toBe(true);
    journal = await open();
    // This is the crash window, not merely a reopen after normal completion.
    const task = await journal.harness.commit(async (tx) => (await tx.scanTasks({kind: "forgerie.decision-correction"}, 10)).items[0], context);
    expect(task?.state.status).not.toBe("terminal");
    await journal.conversation.abort(context);
    const receipt = await journal.harness.commit((tx) => tx.submissionByRequest(journal.conversation.id, "decision-overturn:d:issue"), context);
    expect(receipt?.status).toBe("unanswered");
    expect(receipt?.entry).toBeDefined();
    journal.harness.resume();
    await vi.waitFor(async () => {
      const task = await journal.harness.commit(async (tx) => (await tx.scanTasks({kind: "forgerie.decision-correction"}, 10)).items[0], context);
      expect(task?.state.status).toBe("terminal");
    });
    const corrections = (await journal.conversation.context(context)).entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role === "user");
    expect(corrections).toHaveLength(1);
    expect(JSON.stringify(corrections)).toContain("Correction: Do not file it. Redo the affected work.");
    expect((await decisions(journal.harness, journal.conversation.id, context)).find((decision) => decision.id === "d:issue")?.state).toMatchObject({kind: "overturned", note: "Do not file it"});
    await expect(overturnDecision(journal.harness, journal.conversation, "d:issue", "Again", context)).rejects.toThrow("already overturned");
  } finally { await journal.close(); await rm(root, {recursive: true, force: true}); }
});

it("replays parent question admission and a committed answer without asking or logging twice", async () => {
  const root = await mkdtemp(join(tmpdir(), "forgerie-question-replay-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const models = createModels(); const provider = fauxProvider({tokensPerSecond: 100000}); models.setProvider(provider.provider);
  let asks = 0; let answers = 0;
  provider.setResponses(Array.from({length: 50}, () => (request) => {
    const last = [...request.messages].reverse().find((message) => message.role !== "system");
    const said = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
    const call = (name: string, args: Record<string, string>) => fauxAssistantMessage([fauxToolCall(name, args)], {stopReason: "toolUse"});
    if (said === "Start") return call("child_agent", {action: "spawn", name: "helper", message: "Ask", isolation: "shared"});
    if (said === "Ask") { asks++; return call("ask_human", {question: "Which token?"}); }
    const qid = /^\[child helper asks ([^\]]+)\]/.exec(said)?.[1];
    if (qid !== undefined) { answers++; return call("child_agent", {action: "answer", name: "helper", questionId: qid, answer: "TOKEN", reason: "Task says TOKEN"}); }
    return fauxAssistantMessage(said.includes("The parent answered: TOKEN") ? "CHILD-FINISHED" : "Done");
  }));
  const registry = createRegistry(); const children = durableChildExtensions(); const decision = decisionExtension();
  for (const extension of [...children.parent, ...children.childOnly, decision]) registry.install(extension);
  const open = () => DurableSessionJournal.open({manager, models, registry, agent: {cwd: root, model: {provider: "faux", modelId: "faux-1"}, extensions: [...children.parent, decision]}});
  let journal = await open();
  try {
    let closing: Promise<void> | undefined;
    const closeReceipt = () => closing;
    let unsubscribe = journal.harness.subscribeCommits((publication) => {
      if (publication.changes.some((change) => change.type === "submission" && change.value.requestId?.startsWith("child-question:") === true)) queueMicrotask(() => { closing ??= journal.close(); });
    });
    journal.harness.resume();
    await journal.conversation.submit({type: "input", content: "Start"}, context);
    await vi.waitFor(() => { expect(closing).toBeDefined(); });
    await closeReceipt(); unsubscribe(); journal = await open();
    const delivery = await journal.harness.commit(async (tx) => (await tx.scanTasks({kind: "forgerie.child-question-delivery"}, 10)).items[0], context);
    expect(delivery?.state.status).not.toBe("terminal");
    closing = undefined;
    unsubscribe = journal.harness.subscribeCommits((publication) => {
      if (publication.changes.some((change) => change.type === "document" && change.record.kind === DECISIONS_DOC_KIND)) queueMicrotask(() => { closing ??= journal.close(); });
    });
    journal.harness.resume();
    await vi.waitFor(() => { expect(closing).toBeDefined(); });
    await closeReceipt(); unsubscribe(); journal = await open(); journal.harness.resume();
    await vi.waitFor(async () => {
      const child = (await listChildren(journal.harness, journal.conversation.id, context))[0];
      expect(child).toBeDefined();
      if (child === undefined) throw new Error("Missing child");
      expect(JSON.stringify(await childMessages(journal.harness, journal.conversation.id, child.conversationId, context))).toContain("CHILD-FINISHED");
    });
    expect(asks).toBe(1); expect(answers).toBe(1);
    expect(await decisions(journal.harness, journal.conversation.id, context)).toMatchObject([{choice: "TOKEN", kind: "child-answer", flagged: false}]);
    const questions = (await journal.conversation.context(context)).entries.flatMap((entry) => entry.model ?? []).filter((message) => message.role === "user" && typeof message.content === "string" && message.content.startsWith("[child helper asks"));
    expect(questions).toHaveLength(1);
  } finally { await journal.close(); await rm(root, {recursive: true, force: true}); }
});
