import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonRepresentation } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { AssistantEntry, GenerationTask, Harness, InboxDoc, LiveDoc, UserEntry, UsageDoc, createRegistry, defineDoc, type EntryRecord } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { durableBrowserAppStateSchema, type DurableBrowserAppState, type DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import { DurableParentReadModel } from "./durableParentReadModel.js";
import type { DurableSessionHandle } from "./durableSessionAddress.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-native-reads-"));
  const database = join(directory, "state.sqlite");
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  const harness = await Harness.open(await openNodeSqliteStorage(database), { models, registry: createRegistry() }, context);
  const conversation = await harness.root(context);
  const handle: DurableSessionHandle = { address: { journalId: "family", databasePath: database, sessionId: "logical", conversationId: conversation.id }, harness, conversation,
    release: () => Promise.resolve() };
  const messageId = (entry: EntryRecord, index: number) => `entry:${String(entry.conversationId)}:${String(entry.id)}:${String(index)}`;
  const reader = new DurableParentReadModel({ handle, messageId });
  const user = (text: string) => conversation.commit((tx) => tx.appendEntry(UserEntry, conversation.id, { model: [{ role: "user", content: text, timestamp: 1 }] }), context);
  cleanups.push(async () => { await harness.close(context); await rm(directory, { recursive: true, force: true }); });
  return { reader, harness, conversation, handle, user, messageId, provider };
}

function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe("native Durable parent reads", () => {
  it("reads complete history across a reset without starting the scheduler or needing any JSONL file", async () => {
    const { reader, conversation, harness, user, provider } = await fixture();
    const first = await user("before reset");
    await conversation.commit((tx) => tx.appendEntry(conversation.id, { kind: "pi.reset", head: "self" }), context);
    await user("after reset");
    const page = await reader.history({ before: 1, limit: 1 }, context);
    expect(page).toMatchObject({ start: 0, total: 2, messages: [{ id: `entry:${String(conversation.id)}:${String(first.id)}:0`, content: "before reset" }] });
    expect((await reader.context(context)).messages.map((message) => message.content)).toEqual(["after reset"]);
    expect((await harness.inspect(context)).scheduling).toBe("paused");
    expect(provider.state.callCount).toBe(0);
  });

  it("preserves several entry contributions and filters private provider and thinking fields", async () => {
    const { reader, conversation } = await fixture();
    await conversation.commit(async (tx) => {
      const answer = fauxAssistantMessage([{ type: "thinking", thinking: "reason", thinkingSignature: "secret" }, { type: "text", text: "answer" }]);
      await tx.appendEntry(conversation.id, { kind: "pi.assistant", model: [answer, { ...answer, content: [{ type: "text", text: "second contribution" }] }], data: { providerSessionId: "private-provider", extensionPayload: "private" } });
    }, context);
    const messages = await reader.messages(context);
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((message) => message.id)).size).toBe(2);
    expect(messages[0]?.content).toEqual([{ type: "thinking", thinking: "reason" }, { type: "text", text: "answer" }]);
    expect(JSON.stringify(messages)).not.toMatch(/secret|private-provider|extensionPayload|provider|faux/);
  });

  it("filters successful declaration tools consistently from history and snapshots", async () => {
    const { reader, conversation } = await fixture();
    await conversation.commit(async (tx) => {
      await tx.appendEntry(AssistantEntry, conversation.id, { model: [fauxAssistantMessage([fauxToolCall("end_turn", {}, { id: "end" })])] });
      await tx.appendEntry(conversation.id, { kind: "pi.tool-result", model: [{ role: "toolResult", toolCallId: "end", toolName: "end_turn", content: [{ type: "text", text: "declaration" }], isError: false, timestamp: 2 }] });
      (await tx.doc(LiveDoc, conversation.id)).tools = [{ callId: "end", name: "end_turn", status: "running", output: "internal progress" }];
    }, context);
    expect(await reader.messages(context)).toMatchObject([{ role: "assistant", content: [] }]);
    const view = await conversation.viewState(context);
    try {
      const snapshot = reader.snapshot(view.value, "epoch", 0);
      expect(snapshot.history.messages).toMatchObject([{ role: "assistant", content: [] }]);
      expect(snapshot.tools).toEqual([]);
    }
    finally { view.dispose(); }
  });

  it("late-joins with current tool output, committed partial, queue and operation state", async () => {
    const { reader, conversation, harness, user } = await fixture();
    await user("working input");
    await conversation.commit(async (tx) => {
      const task = await tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" } });
      const submission = await tx.createSubmission({ conversationId: conversation.id, type: "input", status: "queued" });
      const live = await tx.doc(LiveDoc, conversation.id);
      live.run = { taskId: task, inputs: [] };
      const answer = fauxAssistantMessage("in flight");
      live.generation = { attempt: 1, message: { role: "assistant", api: answer.api, provider: answer.provider, model: answer.model, usage: answer.usage, stopReason: answer.stopReason, timestamp: answer.timestamp, content: [{ type: "thinking", thinking: "partial", thinkingSignature: "hidden" }, { type: "text", text: "in flight" }] } };
      live.tools = [{ callId: "call", name: "read", status: "running", output: "committed tool output", details: { private: "never sent" } }];
      (await tx.doc(InboxDoc, conversation.id)).items.push({ id: submission.id, mode: "followUp", content: "next input" });
    }, context);
    const frames: DurableBrowserSnapshot[] = [];
    const attachment = await reader.attach((frame) => { frames.push(frame); return Promise.resolve(); }, (error) => { throw error; }, context);
    try {
      expect(frames[0]).toMatchObject({ type: "session.snapshot", revision: 0, isStreaming: true, partial: { content: [{ type: "thinking", thinking: "partial" }, { type: "text", text: "in flight" }] },
        tools: [{ toolCallId: "call", output: "committed tool output", status: "running" }], queuedMessages: [{ kind: "followUp", text: "next input" }] });
      expect(JSON.stringify(frames)).not.toMatch(/hidden|never sent/);
      expect((await harness.inspect(context)).scheduling).toBe("paused");
    } finally { await attachment.stop(); }
  });

  it("replaces a blocked seed after more than 100 commits instead of replaying append events", async () => {
    const { reader, user } = await fixture();
    const gate = held();
    const frames: DurableBrowserSnapshot[] = [];
    const attaching = reader.attach(async (frame) => { frames.push(frame); if (frames.length === 1) await gate.promise; }, (error) => { throw error; }, context);
    await vi.waitFor(() => { expect(frames).toHaveLength(1); });
    try { for (let index = 0; index < 103; index++) await user(`commit ${String(index)}`); }
    finally { gate.release(); }
    const attachment = await attaching;
    try {
      await vi.waitFor(() => { expect(frames.at(-1)?.history.total).toBe(103); });
      expect(frames.length).toBeLessThan(6);
      expect(frames.map((frame) => frame.type)).toEqual(Array.from({ length: frames.length }, () => "session.snapshot"));
      const latest = frames.at(-1);
      expect(latest?.history.messages.at(-1)?.content).toBe("commit 102");
      expect(new Set(latest?.history.messages.map((message) => message.id)).size).toBe(latest?.history.messages.length);
      expect(new Set(frames.map((frame) => frame.epoch)).size).toBe(1);
      expect(frames.map((frame) => frame.revision)).toEqual(frames.map((_, index) => index));
    } finally { await attachment.stop(); }
  });

  it("buffers a committed form change during attachment through the same replacement publisher", async () => {
    const { conversation, harness, handle, messageId } = await fixture();
    const Forms = defineDoc<JsonRepresentation<DurableBrowserAppState>>({ kind: "test.parent-form", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ response: { kind: "none" } }) });
    await conversation.commit((tx) => tx.doc(Forms, conversation.id), context);
    const attached = held();
    const finishAttach = held();
    const reader = new DurableParentReadModel({ handle, messageId, appWatch: async () => {
      const watch = await harness.watchDoc(Forms, conversation.id, context);
      if (watch === undefined) throw new Error("Form document must exist before attachment");
      attached.release();
      await finishAttach.promise;
      return { get value() { return durableBrowserAppStateSchema.parse(watch.value); }, closed: watch.closed,
        stop: () => watch.stop(), start: (listener) => { watch.start(async (value, ops, ctx) => { await listener(durableBrowserAppStateSchema.parse(value), ops, ctx); }); } };
    } });
    const frames: DurableBrowserSnapshot[] = [];
    const opening = reader.attach((frame) => { frames.push(frame); return Promise.resolve(); }, (error) => { throw error; }, context);
    await attached.promise;
    await conversation.commit(async (tx) => {
      const state = await tx.doc(Forms, conversation.id);
      state.pendingAsk = { askId: "new-form", askedAt: new Date(0).toISOString(), questions: [{ id: "choice", question: "Choose", options: [] }] };
      state.response = { kind: "needs-response", reason: "questions" };
    }, context);
    finishAttach.release();
    const attachment = await opening;
    try {
      expect(frames[0]?.app?.pendingAsk).toBeUndefined();
      await vi.waitFor(() => { expect(frames.at(-1)?.app?.pendingAsk?.askId).toBe("new-form"); });
      expect(frames.map((frame) => frame.revision)).toEqual(frames.map((_, index) => index));
      expect((await harness.inspect(context)).scheduling).toBe("paused");
    } finally { await attachment.stop(); }
  });

  it("reports a failed watch and detaches without converting the failure into a legacy read", async () => {
    const { reader, user } = await fixture();
    const failed = new Error("transport failed");
    const failures: Error[] = [];
    let frames = 0;
    const attachment = await reader.attach(() => ++frames === 1 ? Promise.resolve() : Promise.reject(failed), (error) => { failures.push(error); }, context);
    await user("new commit");
    expect(await attachment.closed).toEqual({ reason: "listener_error", error: failed });
    expect(failures).toEqual([failed]);
    await attachment.stop();
  });

  it("counts native history before reset and does not charge inherited spend to a fork", async () => {
    const { reader, handle, conversation, user, messageId } = await fixture();
    const entry = await user("inherited user");
    await conversation.commit(async (tx) => {
      (await tx.doc(UsageDoc, conversation.id)).models = { "metered/model": { input: 4, output: 6, cacheRead: 0, cacheWrite: 0, totalTokens: 10, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 } } };
    }, context);
    const fork = await conversation.fork(entry.id, { ownership: { kind: "ownerless" } }, context);
    const child = new DurableParentReadModel({ handle: { ...handle, conversation: fork, address: { ...handle.address, conversationId: fork.id } }, messageId });
    expect(await child.statistics(context)).toMatchObject({ totalMessages: 1, userMessages: 1, assistantMessages: 0, toolCalls: 0, cost: 0, tokens: { total: 0 } });
    await conversation.commit((tx) => tx.appendEntry(conversation.id, { kind: "pi.reset", head: "self" }), context);
    await user("new context");
    expect(await reader.statistics(context)).toMatchObject({ totalMessages: 2, userMessages: 2, cost: 3, tokens: { total: 10 } });
  });

  it("reads only own usage and rejects an oversized indivisible tool-round page", async () => {
    const { reader, conversation, user } = await fixture();
    const view = await conversation.viewState(context);
    try { expect(reader.usage(view.value)).toEqual({ models: {}, tools: {} }); }
    finally { view.dispose(); }
    await user("one long turn");
    await conversation.commit(async (tx) => {
      for (let index = 0; index < 501; index++) await tx.appendEntry(AssistantEntry, conversation.id, { model: [fauxAssistantMessage(`answer ${String(index)}`)] });
      await tx.doc(UsageDoc, conversation.id);
    }, context);
    await expect(reader.history(undefined, context)).rejects.toThrow("exceeds 500 messages");
  });
});
