import { askAnswerRequestId, askDeliveryExtension } from "./durableAskDelivery.js";
import { acceptProcessEvents, processEventsExtension } from "./durableProcessEvents.js";
import { createDurableParentState } from "./durableParentState.js";
import { ParentAsks, Presentation } from "./durableParentDocuments.js";
import { workflowExtension, WorkflowLaunch } from "./durableWorkflowRuns.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createRegistry, defineExtension, defineTask, defineTool, InboxDoc, type TaskId } from "@earendil-works/pi-durable";
import { expect, it, vi } from "vitest";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { childParentSubmission, submitChildParentInput } from "./durableChildParentInput.js";
import { durableChildExtensions } from "./durableChildAgents.js";
import { deliverInputUntilPlaced, type InputPlacementState } from "./durableInputPlacement.js";
import { modelChainExtension, SessionModelChain } from "./durableModelChains.js";
import { ChildAgentCatalog } from "./durableChildProfiles.js";

async function fixture(spawnChildren = false, askQuestion = false, chain = false) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-child-batch-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const models = createModels();
  const provider = fauxProvider({ tokensPerSecond: 100_000 }); models.setProvider(provider.provider);
  const seen: string[] = [];
  const inputs: string[] = [];
  const requests: string[] = [];
  let released = false;
  let holding = false;
  const hold = defineTool({ name: "hold", description: "Wait for test release", parameters: Type.Object({}), replay: "safe",
    execute: async (_args, _api, ctx) => {
      holding = true;
      while (!released) await sleep(10, undefined, { signal: ctx.abortSignal });
      return { content: [{ type: "text", text: "Released" }] };
    },
  });
  const emit = defineTask<{ requestId: string; text: string }, { phase: "send" }, null>({
    name: "test.child-message", version: 1, initial: () => ({ phase: "send" }),
    phases: { send: async (task, runtime, ctx) => {
      await submitChildParentInput(runtime, task.input.requestId, task.input.text, ctx);
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), ctx);
    } },
    abort: (_task, runtime, ctx) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
  });
  const place = defineTask<{ requestId: string; text: string }, InputPlacementState, null>({
    name: "test.question-placement", version: 1, initial: () => ({ phase: "deliver" }),
    phases: { deliver: (task, runtime, ctx) => deliverInputUntilPlaced(runtime, task.state.checkpoint, {
      requestId: task.input.requestId, content: task.input.text, previousRecipient: runtime.conversationId,
      selectRecipient: () => Promise.resolve(runtime.conversationId),
    }, ctx) },
    abort: (_task, runtime, ctx) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx),
  });
  let journal: DurableSessionJournal;
  const chains = modelChainExtension(() => ({ modelChains: () => ({ workhorse: ["faux/faux-1"] }), commit: (change, ctx) => journal.harness.commit(change, ctx) }));
  const testing = defineExtension({ name: "test.child-batch", tools: [hold], tasks: [emit, place] });
  await writeFile(join(root, "reader.md"), "---\nname: reader\ntools: read\n---\nRead only.\n");
  const children = durableChildExtensions({ catalog: new ChildAgentCatalog([root]) });
  const registry = createRegistry();
  for (const extension of [...children.parent, ...children.childOnly, testing]) registry.install(extension);
  provider.setResponses(Array.from({ length: 100 }, () => request => {
    const last = request.messages.at(-1);
    const user = [...request.messages].reverse().find(message => message.role === "user");
    const text = typeof user?.content === "string" ? user.content : JSON.stringify(user?.content);
    seen.push(text);
    requests.push(JSON.stringify(request.messages));
    if (last?.role === "user") inputs.push(text);
    if (askQuestion && text === "Child gamma" && last?.role === "user") return fauxAssistantMessage([
      fauxToolCall("ask_human", { question: "Which token?" }),
    ], { stopReason: "toolUse" });
    const questions = [...text.matchAll(/^\[child (\w+) asks ([^\]]+)\]/gm)];
    if (askQuestion && last?.role === "user" && questions.length > 0) return fauxAssistantMessage(questions.map(question => fauxToolCall("child_agent", {
      action: "answer", name: question[1] ?? "", questionId: question[2] ?? "", answer: "TOKEN", reason: "Task says TOKEN",
    })), { stopReason: "toolUse" });
    if (text === "Spawn children" && last?.role === "user") return fauxAssistantMessage([
      ...["alpha", "beta", "gamma"].map(name => fauxToolCall("child_agent", { action: "spawn", name, agent: "reader", message: `Child ${name}`, isolation: "shared" })),
      fauxToolCall("hold", {}),
    ], { stopReason: "toolUse" });
    return text === "Hold" && last?.role === "user"
      ? fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }) : fauxAssistantMessage("Done");
  }));
  registry.install(askDeliveryExtension()); registry.install(processEventsExtension()); registry.install(workflowExtension());
  if (chain) registry.install(chains);
  const open = async () => {
    const journal = await DurableSessionJournal.open({ manager, models, registry,
      agent: { cwd: root, model: { provider: "faux", modelId: "faux-1" }, extensions: [...children.parent, testing, ...(chain ? [chains] : [])] },
      familyOptions: { models, registry, settings: { followUpMode: "one-at-a-time" } },
    });
    journal.harness.resume(); return journal;
  };
  journal = await open();
  if (chain) await journal.conversation.commit(async tx => { (await tx.doc(SessionModelChain, journal.conversation.id)).reference = "workhorse"; }, context);
  await journal.conversation.submit({ type: "input", content: spawnChildren ? "Spawn children" : "Hold" }, context);
  await vi.waitFor(() => { expect(holding).toBe(true); });
  return {
    seen, inputs, requests,
    custom: (text: string, mode: "steer" | "followUp" = "followUp") => journal.submitCustomMessage(text, mode),
    workflow: async (id: string, prompt: string) => {
      const task = await journal.conversation.commit(tx => tx.createTask(WorkflowLaunch, { runId: id, prompt }, { conversationId: journal.conversation.id, ownership: { kind: "conversation" }, background: true }), context);
      expect((await journal.harness.waitForTask(task, context)).state.outcome).toEqual({ status: "completed", result: null });
    },
    process: (id: string) => acceptProcessEvents(journal.conversation, { id, missed: false, events: [{ processId: id, name: id, watchId: "exit", attention: "turn", kind: "exit", line: 0, count: 1, samples: [], reason: "exited 0" }] }, context),
    ask: async () => {
      const state = createDurableParentState(journal.handle, { resolve: () => { throw new Error("Unused"); } });
      const { ask } = await state.openAsk([{ id: "q", question: "Continue?", options: [] }], context);
      await state.submitAsk(ask.askId, { answers: [{ id: "q", values: [], otherText: "ASK-ANSWER" }] }, context);
      return ask.askId;
    },
    askReceipt: async (id: string) => (await journal.harness.snapshot(ParentAsks, journal.conversation.id, context))?.closed[id],
    presentation: (entry: string) => journal.harness.snapshot(Presentation, journal.conversation.id, entry, context),
    questions: (messages: readonly { requestId: string; text: string }[]) => journal.conversation.commit(async tx => {
      for (const message of messages) await tx.createTask(place, message, { conversationId: journal.conversation.id, ownership: { kind: "conversation" }, background: true });
    }, context),
    inbox: async () => (await journal.harness.snapshot(InboxDoc, journal.conversation.id, context))?.items ?? [],
    emit: async (messages: readonly { requestId: string; text: string }[]) => {
      const tasks = await journal.conversation.commit(async tx => {
        const tasks = [];
        for (const message of messages) tasks.push(await tx.createTask(emit, message, { conversationId: journal.conversation.id, ownership: { kind: "conversation" }, background: true }));
        return tasks;
      }, context);
      for (const task of tasks) expect((await journal.harness.waitForTask(task, context)).state.outcome).toEqual({ status: "completed", result: null });
    },
    abortEmission: async (message: { requestId: string; text: string }, afterAdmission = false) => {
      let aborting: Promise<"marked" | "terminal"> | undefined;
      let deliveryOwner: TaskId | undefined;
      const unsubscribe = journal.harness.subscribeCommits(publication => {
        for (const change of publication.changes) {
          if (change.type !== "task" || change.value.kind !== "forgerie.child-parent-input-delivery" || change.value.owner === undefined) continue;
          const input = change.value.input;
          if (typeof input === "object" && input !== null && !Array.isArray(input) && input["requestId"] === message.requestId) deliveryOwner = change.value.owner;
        }
        if (aborting === undefined && deliveryOwner !== undefined && (!afterAdmission || publication.changes.some(item => item.type === "submission" && item.value.requestId === message.requestId))) {
          aborting = journal.harness.abortTask(deliveryOwner, context);
        }
      });
      try {
        const owner = await journal.conversation.commit(tx => tx.createTask(emit, message,
          { conversationId: journal.conversation.id, ownership: { kind: "conversation" }, background: true }), context);
        expect((await journal.harness.waitForTask(owner, context)).state.outcome.status).toBe("aborted");
        expect(aborting).toBeDefined();
        await aborting;
      } finally { unsubscribe(); }
    },
    receipt: (key: string) => journal.conversation.commit(tx => childParentSubmission(tx, journal.conversation.id, key), context),
    human: (text: string) => journal.conversation.submit({ type: "input", content: text, whenBusy: "followUp" }, context),
    withdraw: async () => {
      const item = (await journal.harness.snapshot(InboxDoc, journal.conversation.id, context))?.items.find(item => item.mode !== "write");
      if (item === undefined) throw new Error("Missing queued input");
      expect(await journal.harness.abortSubmission(item.id, context, journal.conversation.id)).toBe("aborted");
    },
    release: async () => { released = true; await journal.conversation.waitForIdle(context); },
    restart: async () => { await journal.close(); journal = await open(); },
    close: async () => { released = true; await journal.close(); await rm(root, { recursive: true, force: true }); },
  };
}

const messages = [
  { requestId: "child-report:alpha", text: "[subagent alpha answered, no reply needed] ALPHA" },
  { requestId: "child-report:beta", text: "[subagent beta failed: model_error: BETA]" },
  { requestId: "child-question:gamma", text: "[child gamma asks q1] GAMMA?" },
] as const;

it("delivers pending reports, failures and questions in one parent turn with one-at-a-time follow-ups", async () => {
  const run = await fixture();
  try {
    await run.emit(messages);
    expect(await run.inbox()).toMatchObject([{ mode: "followUp", content: messages.map(message => message.text).join("\n\n") }]);
    const receipts = await Promise.all(messages.map(message => run.receipt(message.requestId)));
    expect(new Set(receipts.map(receipt => receipt?.id)).size).toBe(1);
    await run.release();
    expect(run.seen.filter(text => text.startsWith("[subagent"))).toEqual([messages.map(message => message.text).join("\n\n")]);
    expect(run.seen).toHaveLength(3);
  } finally { await run.close(); }
});

it("keeps a pending batch and each logical receipt across restart without duplicating replayed messages", async () => {
  const run = await fixture();
  try {
    await run.emit(messages);
    const before = await run.receipt(messages[0].requestId);
    await run.restart();
    await run.emit([...messages, { requestId: "child-report:delta", text: "[subagent delta answered] DELTA" }]);
    expect(await run.inbox()).toHaveLength(1);
    const content = (await run.inbox())[0];
    expect(content).toMatchObject({ mode: "followUp", content: `${messages.map(message => message.text).join("\n\n")}\n\n[subagent delta answered] DELTA` });
    expect((await run.receipt("child-report:delta"))?.id).toBe(before?.id);
    await run.release();
    expect(run.seen.filter(text => text.startsWith("[subagent"))).toHaveLength(1);
  } finally { await run.close(); }
});

it("keeps batching after an intervening admission is cancelled before it submits", async () => {
  const run = await fixture();
  try {
    await run.emit(messages.slice(0, 1));
    await run.abortEmission(messages[1]);
    await run.emit(messages.slice(2));
    expect(await run.inbox()).toMatchObject([{ mode: "followUp", content: `${messages[0].text}\n\n${messages[2].text}` }]);
    expect(await run.receipt(messages[1].requestId)).toBeUndefined();
    expect((await run.receipt(messages[2].requestId))?.id).toBe((await run.receipt(messages[0].requestId))?.id);
    await run.release();
    expect(run.seen.filter(text => text.startsWith("[subagent"))).toHaveLength(1);
  } finally { await run.close(); }
});

it("keeps an admitted batch across cancellation before its pointer is saved", async () => {
  const run = await fixture();
  try {
    await run.abortEmission(messages[0], true);
    await run.abortEmission(messages[1]);
    await run.emit(messages.slice(2));
    expect(await run.inbox()).toMatchObject([{ mode: "followUp", content: `${messages[0].text}\n\n${messages[2].text}` }]);
    expect((await run.receipt(messages[2].requestId))?.id).toBe((await run.receipt(messages[0].requestId))?.id);
    await run.release();
  } finally { await run.close(); }
});

it("keeps human follow-ups separate and FIFO while all automation joins its first boundary", async () => {
  const run = await fixture();
  try {
    await run.emit(messages.slice(0, 1));
    await run.human("Human first");
    await run.human("Human second");
    await run.emit(messages.slice(1));
    expect((await run.inbox()).map(item => item.mode === "write" ? "write" : item.content)).toEqual([
      messages.map(message => message.text).join("\n\n"), "Human first", "Human second",
    ]);
    await run.release();
    expect(run.seen.slice(2)).toEqual([messages.map(message => message.text).join("\n\n"), "Human first", "Human second"]);
  } finally { await run.close(); }
});

it("batches actual child-agent completion reports before the parent resumes", async () => {
  const run = await fixture(true);
  try {
    await vi.waitFor(async () => {
      const inbox = await run.inbox();
      expect(inbox).toHaveLength(1);
      for (const name of ["alpha", "beta", "gamma"]) expect(JSON.stringify(inbox)).toContain(`[subagent ${name} answered`);
    });
    await run.release();
    const turns = run.seen.filter(text => text.startsWith("[subagent"));
    expect(turns).toHaveLength(1);
    for (const name of ["alpha", "beta", "gamma"]) expect(turns[0]).toContain(`[subagent ${name} answered`);
  } finally { await run.close(); }
});

it("restores a shared batch of real child reports and a question, then answers the waiting child", async () => {
  const run = await fixture(true, true);
  try {
    await vi.waitFor(async () => {
      const inbox = await run.inbox();
      expect(inbox).toHaveLength(1);
      expect(JSON.stringify(inbox)).toContain("[subagent alpha answered");
      expect(JSON.stringify(inbox)).toContain("[subagent beta answered");
      expect(JSON.stringify(inbox)).toContain("[child gamma asks");
    });
    await run.restart();
    expect(await run.inbox()).toHaveLength(1);
    await run.release();
    await vi.waitFor(() => {
      expect(run.requests.some(request => request.includes("The parent answered: TOKEN"))).toBe(true);
      expect(run.inputs.some(input => input.includes("[subagent gamma answered"))).toBe(true);
    });
    const shared = run.inputs.filter(input => input.includes("[child gamma asks"));
    expect(shared).toHaveLength(1);
    expect(shared[0]).toContain("[subagent alpha answered");
    expect(shared[0]).toContain("[subagent beta answered");
  } finally { await run.close(); }
});

it("starts a fresh batch when the previous input is already placed", async () => {
  const run = await fixture();
  try {
    await run.emit(messages.slice(0, 1)); await run.release();
    await run.emit(messages.slice(1)); await run.release();
    expect((await run.receipt(messages[1].requestId))?.id).not.toBe((await run.receipt(messages[0].requestId))?.id);
    expect(run.seen.join("\n")).toContain("GAMMA?");
  } finally { await run.close(); }
});


it("batches consecutive question deliveries on a model chain before their placement waits", async () => {
  const run = await fixture(false, false, true);
  const questions = Array.from({ length: 4 }, (_, i) => ({ requestId: `child-question:q${String(i)}${i === 3 ? ":retry:1" : ""}`, text: `[child obj-${String(i)} asks q:${String(i)}] QUESTION ${String(i)}` }));
  try {
    await run.questions(questions);
    await vi.waitFor(async () => { expect(JSON.stringify(await run.inbox())).toContain("QUESTION 3"); });
    expect(await run.inbox()).toMatchObject([{ content: questions.map(item => item.text).join("\n\n") }]);
    expect(await run.inbox()).toHaveLength(1);
    await run.release();
  } finally { await run.close(); }
});


it.each([false, true])("joins real workflow, process, ask-answer and journal notifications with child inputs across humans and replay, chain=%s", async chain => {
  const run = await fixture(false, false, chain);
  try {
    await run.emit(messages.slice(0, 1));
    await run.human("Human first");
    await run.workflow("mixed", "WORKFLOW-LAUNCH");
    await run.process("PROCESS-ONE");
    const ask = await run.ask();
    await run.custom("GITHUB-WATCH");
    await run.human("Human second");
    await run.emit([{ requestId: "child-reminder:q:retry:1", text: "[child obj-4 still waits on q:4] REMINDER" }]);
    await vi.waitFor(async () => { expect(JSON.stringify(await run.inbox())).toContain("ASK-ANSWER"); });
    const keys = [messages[0].requestId, "workflow:mixed", "forgerie.custom-message:process-events:PROCESS-ONE", askAnswerRequestId(ask), "child-reminder:q:retry:1"];
    const before = await Promise.all(keys.map(key => run.receipt(key)));
    expect(before.every(receipt => receipt?.status === "queued")).toBe(true);
    expect(new Set(before.map(receipt => receipt?.id)).size).toBe(1);
    await run.restart();
    await run.emit(messages.slice(0, 1));
    await run.workflow("mixed", "WORKFLOW-LAUNCH");
    await run.process("PROCESS-ONE");
    const inbox = await run.inbox();
    expect(inbox).toHaveLength(3);
    expect(inbox.slice(1)).toMatchObject([{ content: "Human first" }, { content: "Human second" }]);
    const combined = JSON.stringify(inbox[0]);
    for (const text of ["ALPHA", "WORKFLOW-LAUNCH", "PROCESS-ONE (PROCESS-ONE)", "ASK-ANSWER", "GITHUB-WATCH", "REMINDER"]) expect(combined.split(text)).toHaveLength(2);
    await run.release();
    await vi.waitFor(async () => { expect((await run.askReceipt(ask))?.delivery.kind).toBe("admitted"); });
    const after = await Promise.all(keys.map(key => run.receipt(key)));
    expect(after.every(receipt => receipt?.entry !== undefined)).toBe(true);
    expect(new Set(after.map(receipt => receipt?.entry)).size).toBe(1);
    // No individual source may apply its hidden/custom-only presentation to the other sources' shared entry.
    expect((await run.presentation(String(after[0]?.entry)))?.envelope).toBeUndefined();
    expect(run.inputs.slice(-3).map(text => text.includes("ALPHA") ? "automated batch" : text)).toEqual(["automated batch", "Human first", "Human second"]);
  } finally { await run.close(); }
});

it("batches automated steers on their native steering boundary", async () => {
  const run = await fixture();
  try {
    await run.custom("AUTO-STEER-ONE", "steer");
    await run.custom("AUTO-STEER-TWO", "steer");
    expect(await run.inbox()).toMatchObject([{ mode: "steer", content: "AUTO-STEER-ONE\n\nAUTO-STEER-TWO" }]);
    await run.release();
    expect(run.inputs.filter(text => text.includes("AUTO-STEER"))).toEqual(["AUTO-STEER-ONE\n\nAUTO-STEER-TWO"]);
  } finally { await run.close(); }
});


it.each([false, true])("retries every unplaced logical question after withdrawal and restart, chain=%s", async chain => {
  const run = await fixture(false, false, chain);
  const questions = Array.from({ length: 3 }, (_, i) => ({ requestId: `question-withdraw:${String(i)}`, text: `[child retry-${String(i)} asks q:${String(i)}] RETRY-${String(i)}?` }));
  try {
    await run.questions(questions);
    await vi.waitFor(async () => { expect(JSON.stringify(await run.inbox())).toContain("RETRY-2?"); });
    const original = await Promise.all(questions.map(item => run.receipt(item.requestId)));
    expect(new Set(original.map(item => item?.id)).size).toBe(1);
    await run.withdraw();
    await run.restart();
    await vi.waitFor(async () => {
      const retry = await Promise.all(questions.map(item => run.receipt(`${item.requestId}:retry:1`)));
      expect(retry.every(item => item?.status === "queued")).toBe(true);
      expect(new Set(retry.map(item => item?.id)).size).toBe(1);
    });
    expect(await run.inbox()).toHaveLength(1);
    await run.release();
    const placed = await Promise.all(questions.map(item => run.receipt(`${item.requestId}:retry:1`)));
    expect(placed.every(item => item?.entry !== undefined)).toBe(true);
    expect(new Set(placed.map(item => item?.entry)).size).toBe(1);
    expect(run.inputs.filter(text => text.includes("RETRY-0?"))).toHaveLength(1);
    for (const question of questions) expect(run.inputs.join("\n").split(question.text)).toHaveLength(2);
  } finally { await run.close(); }
});

it("replays a cancelled admission on its original logical request without dropping it", async () => {
  const run = await fixture();
  try {
    await run.abortEmission(messages[0]);
    await run.emit(messages.slice(0, 1));
    expect(await run.inbox()).toMatchObject([{ content: messages[0].text }]);
    await run.release();
    expect(run.inputs.filter(text => text === messages[0].text)).toHaveLength(1);
  } finally { await run.close(); }
});

it("keeps process-event retry payloads separate from other members of a withdrawn batch", async () => {
  const run = await fixture();
  const question = { requestId: "question:mixed-retry", text: "[child retry asks q:1] QUESTION-RETRY" };
  try {
    await run.process("PROCESS-FIRST");
    await vi.waitFor(async () => { expect(await run.inbox()).toHaveLength(1); });
    await run.questions([question]);
    await vi.waitFor(async () => { expect(JSON.stringify(await run.inbox())).toContain("QUESTION-RETRY"); });
    await run.process("PROCESS-SECOND");
    await run.withdraw();
    await run.restart();
    await vi.waitFor(async () => {
      const first = await run.receipt("forgerie.custom-message:process-events:PROCESS-FIRST:retry:1");
      const second = await run.receipt(`${question.requestId}:retry:1`);
      expect(first?.status).toBe("queued");
      expect(second?.id).toBe(first?.id);
    });
    expect(await run.inbox()).toHaveLength(1);
    await run.release();
    const delivered = run.inputs.filter(text => text.includes("PROCESS-FIRST"));
    expect(delivered).toHaveLength(1);
    for (const text of ["PROCESS-FIRST (PROCESS-FIRST)", "PROCESS-SECOND (PROCESS-SECOND)", "QUESTION-RETRY"]) expect(delivered[0]?.split(text)).toHaveLength(2);
  } finally { await run.close(); }
});
