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
import { ChildAgentCatalog } from "./durableChildProfiles.js";

async function fixture(spawnChildren = false, askQuestion = false) {
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
  const testing = defineExtension({ name: "test.child-batch", tools: [hold], tasks: [emit] });
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
  const open = async () => {
    const journal = await DurableSessionJournal.open({ manager, models, registry,
      agent: { cwd: root, model: { provider: "faux", modelId: "faux-1" }, extensions: [...children.parent, testing] },
      familyOptions: { models, registry, settings: { followUpMode: "one-at-a-time" } },
    });
    journal.harness.resume(); return journal;
  };
  let journal = await open();
  await journal.conversation.submit({ type: "input", content: spawnChildren ? "Spawn children" : "Hold" }, context);
  await vi.waitFor(() => { expect(holding).toBe(true); });
  return {
    seen, inputs, requests,
    inbox: async () => (await journal.harness.snapshot(InboxDoc, journal.conversation.id, context))?.items ?? [],
    emit: async (messages: readonly { requestId: string; text: string }[]) => {
      const tasks = await journal.conversation.commit(async tx => {
        const tasks = [];
        for (const message of messages) tasks.push(await tx.createTask(emit, message, { conversationId: journal.conversation.id, ownership: { kind: "conversation" }, background: true }));
        return tasks;
      }, context);
      for (const task of tasks) expect((await journal.harness.waitForTask(task, context)).state.outcome.status).toBe("completed");
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

it("does not merge human follow-ups or move later child messages ahead of them", async () => {
  const run = await fixture();
  try {
    await run.emit(messages.slice(0, 1));
    await run.human("Human first");
    await run.human("Human second");
    await run.emit(messages.slice(1));
    expect((await run.inbox()).map(item => item.mode === "write" ? "write" : item.content)).toEqual([
      messages[0].text, "Human first", "Human second", messages.slice(1).map(message => message.text).join("\n\n"),
    ]);
    await run.release();
    expect(run.seen.slice(2)).toEqual([messages[0].text, "Human first", "Human second", messages.slice(1).map(message => message.text).join("\n\n")]);
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
