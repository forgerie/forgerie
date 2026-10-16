import { DatabaseSync } from "node:sqlite";
import type { JsonValue } from "@earendil-works/chord";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { Harness, createRegistry, type Conversation, type Cursor } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtensionRunner, ModelRegistry, ModelRuntime, SessionManager, createAgentSessionServices, convertToLlm } from "@earendil-works/pi-coding-agent";
import { durableJson } from "./durableJson.js";
import { createDurableParentState } from "./durableParentState.js";
import { askDeliveryExtension, askAnswerRequestId } from "./durableAskDelivery.js";
import { ExtensionEntries, Labels, ParentAsks, ParentResponse, Presentation, SessionName, initializeParentDocuments } from "./durableParentDocuments.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE, type AskUserQuestion } from "../../shared/apiTypes.js";
import { renderAskUserAnswersText } from "./sessionAsks.js";
import { DurableSdkSessionView } from "./durableSdkSessionView.js";
import { endTurnReplyMessage } from "./endTurnReply.js";
import { DurableParentReadModel } from "./durableParentReadModel.js";

const questions: AskUserQuestion[] = [{ id: "q", question: "Which?", options: [{ value: "a", label: "A" }] }];
const answers = { answers: [{ id: "q", values: ["a"] }] };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(deliver = false) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-parent-state-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, "state.sqlite");
  const models = createModels();
  const provider = fauxProvider();
  models.setProvider(provider.provider);
  const open = async () => {
    const registry = createRegistry();
    if (deliver) registry.install(askDeliveryExtension());
    const harness = await Harness.open(await openNodeSqliteStorage(databasePath), { models, registry, conversationCreated: initializeParentDocuments }, context);
    cleanup.push(() => harness.close(context));
    const conversation = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });
    const state = stateFor(harness, conversation, databasePath);
    return { harness, conversation, state, registry };
  };
  return { ...await open(), open, provider, directory, databasePath };
}
function stateFor(harness: Harness, conversation: Conversation, databasePath: string) {
  const address = { journalId: "journal", databasePath, sessionId: "logical", conversationId: conversation.id };
  return createDurableParentState({ address, harness, conversation, release: () => Promise.resolve() }, {
    resolve: async (id) => {
      let cursor: Cursor | undefined;
      do {
        const page = await conversation.entries({ order: "ascending" }, 100, cursor, context);
        for (const entry of page.items) {
          if (String(entry.id) === id || (typeof entry.data === "object" && entry.data !== null && !Array.isArray(entry.data) && entry.data["sdkEntryId"] === id)) {
            return { journalId: address.journalId, conversationId: entry.conversationId, entryId: entry.id, messageIndex: 0 };
          }
        }
        cursor = page.next;
      } while (cursor !== undefined);
      throw new Error("Unknown or invisible entry");
    },
  });
}

describe("committed Durable parent state", () => {
  it("declares, opens, supersedes, cancels, and voids in chat across reopen without JSONL", async () => {
    const f = await fixture();
    await f.state.declareResponse("reply", context);
    expect(await f.state.response(context)).toEqual({ kind: "needs-response", reason: "reply" });
    const first = await f.state.openAsk(questions, context);
    const second = await f.state.openAsk(questions, context);
    expect(second.superseded).toMatchObject({ askId: first.ask.askId, reason: "superseded" });
    expect(await f.state.submitAsk(first.ask.askId, answers, context)).toEqual({ status: "stale" });
    await f.harness.close(context);
    const reopened = await f.open();
    expect(await reopened.state.pendingAsk(context)).toEqual(second.ask);
    expect(await reopened.state.cancelAsk(second.ask.askId, context)).toMatchObject({ status: "closed", outcome: { reason: "cancelled", unansweredIds: ["q"] } });
    const third = await reopened.state.openAsk(questions, context);
    expect(await reopened.state.voidForChatReply(context)).toMatchObject({ askId: third.ask.askId, reason: "answered-in-chat" });
    expect(await reopened.state.response(context)).toEqual({ kind: "needs-response", reason: "reply" });
    expect(await reopened.state.voidForChatReply(context)).toBeUndefined();
  });

  it("commits a display-only answer with its declaration and projects it once after native reopen", async () => {
    const f = await fixture();
    const activeHandle = { address: { journalId: "journal", databasePath: f.databasePath, sessionId: "logical", conversationId: f.conversation.id }, harness: f.harness, conversation: f.conversation, release: () => Promise.resolve() };
    const liveReader = new DurableParentReadModel({ handle: activeHandle, messageId: entry => String(entry.id) });
    const frames: unknown[] = [];
    const failures: Error[] = [];
    const attached = await liveReader.attach(frame => { frames.push(frame); return Promise.resolve(); }, error => failures.push(error), context);
    try {
      await f.state.declareResponse("nothing", context, "Visible answer");
      await vi.waitFor(() => { expect(JSON.stringify(frames.at(-1))).toContain("Visible answer"); });
      expect(failures).toEqual([]);
    } finally { await attached.stop(); }
    await f.harness.close(context);
    const reopened = await f.open();
    const handle = { address: { journalId: "journal", databasePath: f.databasePath, sessionId: "logical", conversationId: reopened.conversation.id }, harness: reopened.harness, conversation: reopened.conversation, release: () => Promise.resolve() };
    const reader = new DurableParentReadModel({ handle, messageId: entry => String(entry.id) });
    expect(await reopened.state.response(context)).toEqual({ kind: "none" });
    const messages = await reader.messages(context);
    expect(messages).toEqual([expect.objectContaining({ role: "assistant", content: [{ type: "text", text: "Visible answer" }] })]);
    expect(await reader.messages(context)).toEqual(messages);
    const view = await reopened.conversation.viewState(context);
    try { expect(reader.snapshot(view.value, "epoch", 0).history.messages).toEqual(messages); }
    finally { view.dispose(); }
    expect((await reopened.conversation.context(context)).messages).toEqual([]);
    expect(f.provider.state.callCount).toBe(0);
    expect((await reopened.conversation.entries({}, 100, undefined, context)).items.filter(entry => endTurnReplyMessage(entry) !== undefined)).toHaveLength(1);
  });

  it("rejects blank replies and pending forms without recording a completion answer", async () => {
    const f = await fixture();
    await expect(f.state.declareResponse("nothing", context, "  ")).rejects.toThrow("Invalid visible reply");
    const { ask } = await f.state.openAsk(questions, context);
    await expect(f.state.declareResponse("nothing", context, "Answer")).rejects.toThrow("unanswered ask_user");
    expect(await f.state.pendingAsk(context)).toEqual(ask);
    expect((await f.conversation.entries({}, 100, undefined, context)).items.some(entry => endTurnReplyMessage(entry) !== undefined)).toBe(false);
  });

  it("rejects malformed answers without closing and admits exactly one concurrent browser decision", async () => {
    const { state, harness, conversation } = await fixture();
    await expect(state.openAsk([], context)).rejects.toThrow("at least one");
    const { ask } = await state.openAsk(questions, context);
    await expect(state.submitAsk(ask.askId, { answers: [{ id: "q", values: ["foreign"] }] }, context)).rejects.toThrow("no option");
    expect(await state.pendingAsk(context)).toEqual(ask);
    const results = await Promise.all([state.submitAsk(ask.askId, answers, context), state.submitAsk(ask.askId, answers, context)]);
    expect(results.map(result => result.status).sort()).toEqual(["closed", "stale"]);
    expect(await state.pendingAsk(context)).toBeUndefined();
    const closed = (await harness.snapshot(ParentAsks, conversation.id, context))?.closed[ask.askId];
    expect(closed).toMatchObject({ outcome: { answeredCount: 1 }, delivery: { kind: "pending" } });
    const task = (await harness.inspect(context)).tasks.find(task => task.record.kind === "forgerie.parent-ask-delivery");
    expect(task).toBeDefined();
  });

  it("restarts a committed close, replays one request ID, and never copies a delivery task or phantom form", async () => {
    const f = await fixture();
    const { ask } = await f.state.openAsk(questions, context);
    const closed = await f.state.submitAsk(ask.askId, answers, context);
    expect(closed.status).toBe("closed");
    const receipt = (await f.harness.snapshot(ParentAsks, f.conversation.id, context))?.closed[ask.askId];
    if (receipt?.delivery.kind !== "pending") throw new Error("A close must persist its request ID");
    const tasks = (await f.harness.inspect(context)).tasks.filter(task => task.record.kind === "forgerie.parent-ask-delivery");
    expect(tasks).toHaveLength(1);
    const cut = (await f.conversation.entries({}, 1, undefined, context)).items[0];
    if (cut === undefined) throw new Error("Expected marker");
    const fork = await f.conversation.fork(cut.id, { ownership: { kind: "ownerless" } }, context);
    expect(await stateFor(f.harness, fork, "unused").pendingAsk(context)).toBeUndefined();
    expect(await stateFor(f.harness, fork, "unused").response(context)).not.toEqual({ kind: "needs-response", reason: "questions" });
    expect((await f.harness.inspect(context)).tasks.filter(task => task.record.conversationId === fork.id)).toHaveLength(0);
    await f.harness.close(context); // close was accepted, but the extension was absent: no delivery ran.
    const reopened = await f.open();
    // Admission succeeds first, then delivery retries from its checkpoint with the same ID.
    const admitted = await reopened.conversation.submit({ type: "input", content: [{ type: "text", text: renderAskUserAnswersText(receipt.outcome) }], requestId: receipt.delivery.requestId }, context);
    await admitted.wait(context);
    reopened.registry.install(askDeliveryExtension());
    reopened.harness.resume();
    const taskId = tasks[0]?.record.id;
    if (taskId === undefined) throw new Error("Expected delivery task");
    await reopened.harness.waitForTask(taskId, context);
    const delivered = (await reopened.harness.snapshot(ParentAsks, reopened.conversation.id, context))?.closed[ask.askId];
    expect(delivered?.delivery).toEqual({ kind: "admitted", requestId: receipt.delivery.requestId, submissionId: admitted.id });
    expect(f.provider.state.callCount).toBe(1);
    const page = await reopened.conversation.entries({ order: "ascending" }, 100, undefined, context);
    expect(page.items.filter(entry => entry.kind === "pi.user")).toHaveLength(1);
    const entryId = (await admitted.status(context)).entry;
    if (entryId === undefined) throw new Error("Expected replayed entry");
    expect(await reopened.harness.snapshot(Presentation, reopened.conversation.id, String(entryId), context)).toMatchObject({ envelope: { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, details: receipt.outcome } });
  });

  it.each(["submit", "cancel"] as const)("delivers a %s outcome in SDK custom-message form on the admitted input entry", async action => {
    const f = await fixture();
    const view = await DurableSdkSessionView.open({ address: { journalId: "journal", databasePath: f.databasePath, sessionId: "logical", conversationId: f.conversation.id }, harness: f.harness, conversation: f.conversation, release: () => Promise.resolve() }, context);
    try {
      const { ask } = await f.state.openAsk(questions, context);
      const result = action === "submit" ? await f.state.submitAsk(ask.askId, answers, context) : await f.state.cancelAsk(ask.askId, context);
      if (result.status !== "closed") throw new Error("Expected accepted outcome");
      const marker = (await f.conversation.entries({}, 1, undefined, context)).items[0];
      if (marker === undefined) throw new Error("Missing close marker");
      expect(await f.harness.snapshot(Presentation, f.conversation.id, String(marker.id), context)).toBeUndefined();
      const task = (await f.conversation.commit(tx => tx.scanTasks({ conversationId: f.conversation.id, kind: "forgerie.parent-ask-delivery" }, 100), context)).items[0];
      if (task === undefined) throw new Error("Missing delivery task");
      f.registry.install(askDeliveryExtension());
      await f.harness.waitForTask(task.id, context);
      await f.conversation.waitForIdle(context);
      const receipt = (await f.harness.snapshot(ParentAsks, f.conversation.id, context))?.closed[ask.askId];
      if (receipt?.delivery.kind !== "admitted") throw new Error("Missing admission receipt");
      const requestId = receipt.delivery.requestId;
      const admitted = await f.conversation.commit(tx => tx.submissionByRequest(f.conversation.id, requestId), context);
      if (admitted?.entry === undefined) throw new Error("Missing admitted input entry");
      const entry = (await f.conversation.entries({}, 100, undefined, context)).items.find(candidate => candidate.id === admitted.entry);
      const model = entry?.model?.[0];
      if (entry === undefined || model?.role !== "user") throw new Error("Missing model input");
      const content = renderAskUserAnswersText(result.outcome);
      expect(entry.model).toEqual(convertToLlm([{ role: "custom", customType: ASK_USER_ANSWERS_CUSTOM_TYPE, content, display: true, details: result.outcome, timestamp: model.timestamp }]));
      expect(await f.harness.snapshot(Presentation, f.conversation.id, String(entry.id), context)).toMatchObject({ envelope: { type: "custom", customType: ASK_USER_ANSWERS_CUSTOM_TYPE, display: true, details: result.outcome } });
      await view.refresh(context);
      expect(view.projectEntry(marker)).toBeUndefined();
      const reader = new DurableParentReadModel({ handle: { address: { journalId: "journal", databasePath: f.databasePath, sessionId: "logical", conversationId: f.conversation.id }, harness: f.harness, conversation: f.conversation, release: () => Promise.resolve() }, messageId: native => String(native.id), projectEntry: native => view.projectEntry(native) });
      const messages = await reader.messages(context);
      const notices = messages.filter(message => message.customType === ASK_USER_ANSWERS_CUSTOM_TYPE);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ id: String(entry.id), role: "custom", content: [{ type: "text", text: content }], details: result.outcome });
      expect(messages.filter(message => message.role === "user")).toHaveLength(0);
    } finally { view.close(); }
  });

  it("presents a queued answer on its input entry before the follow-up model answer finishes", async () => {
    const f = await fixture(true);
    let enterFirst!: () => void, releaseFirst!: () => void, enterSecond!: () => void, releaseSecond!: () => void;
    const firstEntered = new Promise<void>(resolve => { enterFirst = resolve; });
    const firstHeld = new Promise<void>(resolve => { releaseFirst = resolve; });
    const secondEntered = new Promise<void>(resolve => { enterSecond = resolve; });
    const secondHeld = new Promise<void>(resolve => { releaseSecond = resolve; });
    f.provider.setResponses([
      async () => { enterFirst(); await firstHeld; return fauxAssistantMessage("first finished"); },
      async () => { enterSecond(); await secondHeld; return fauxAssistantMessage("follow-up finished"); },
    ]);
    const initial = await f.conversation.submit({ type: "input", content: "working" }, context);
    try {
      await firstEntered;
      const { ask } = await f.state.openAsk(questions, context);
      await f.state.submitAsk(ask.askId, answers, context);
      const requestId = askAnswerRequestId(ask.askId);
      await vi.waitFor(async () => {
        expect((await f.conversation.commit(tx => tx.submissionByRequest(f.conversation.id, requestId), context))?.status).toBe("queued");
      });
      const task = (await f.conversation.commit(tx => tx.scanTasks({ conversationId: f.conversation.id, kind: "forgerie.parent-ask-delivery" }, 100), context)).items[0];
      if (task === undefined) throw new Error("Missing queued delivery task");
      releaseFirst();
      await secondEntered;
      await f.harness.waitForTask(task.id, context); // Must not wait for the provider's held follow-up answer.
      const status = await f.conversation.commit(tx => tx.submissionByRequest(f.conversation.id, requestId), context);
      expect(status?.status).toBe("placed");
      if (status?.entry === undefined) throw new Error("Missing placed answer entry");
      const receipt = (await f.harness.snapshot(ParentAsks, f.conversation.id, context))?.closed[ask.askId];
      expect(receipt?.delivery.kind).toBe("admitted");
      expect(await f.harness.snapshot(Presentation, f.conversation.id, String(status.entry), context)).toMatchObject({ envelope: { customType: ASK_USER_ANSWERS_CUSTOM_TYPE, details: receipt?.outcome } });
      expect(f.provider.state.callCount).toBe(2);
    } finally {
      releaseFirst(); releaseSecond();
      await initial.wait(context);
      await f.conversation.waitForIdle(context);
    }
  });

  it("keeps historical reply intent without an actionable form on a fork at the ask", async () => {
    const { state, harness, conversation } = await fixture();
    await state.openAsk(questions, context);
    const cut = (await conversation.entries({}, 1, undefined, context)).items[0];
    if (cut === undefined) throw new Error("Expected ask marker");
    const fork = await conversation.fork(cut.id, { ownership: { kind: "ownerless" } }, context);
    const child = stateFor(harness, fork, "unused");
    expect(await child.pendingAsk(context)).toBeUndefined();
    expect(await child.response(context)).toEqual({ kind: "needs-response", reason: "reply" });
  });

  it("persists ordered custom appends, labels, and names; rewinds custom data at concrete markers", async () => {
    const f = await fixture();
    const a = await f.state.appendCustomEntry("extension", { counter: 1 }, context);
    const b = await f.state.appendCustomEntry("extension", { counter: 2 }, context);
    await f.state.setLabel(a, "first", context);
    await f.state.setSessionName("A durable title", context);
    const doc = await f.harness.snapshot(ExtensionEntries, f.conversation.id, "extension", context);
    expect(doc?.entries.map(entry => entry.id)).toEqual([a, b]);
    const at = doc?.entries[0]?.nativeEntryId;
    if (at === undefined) throw new Error("Expected marker ID");
    expect((await f.harness.snapshotAsOf(ExtensionEntries, f.conversation.id, "extension", at, context))?.entries.map(entry => entry.data)).toEqual([{ counter: 1 }]);
    await f.harness.close(context);
    const reopened = await f.open();
    expect((await reopened.harness.snapshot(SessionName, reopened.conversation.id, context))?.name).toBe("A durable title");
    expect((await reopened.harness.snapshot(Labels, reopened.conversation.id, context))?.entries[a]?.label).toBe("first");
    await reopened.state.setLabel(a, undefined, context);
    expect((await reopened.harness.snapshot(Labels, reopened.conversation.id, context))?.entries[a]).toBeUndefined();
    await expect(reopened.state.setLabel("foreign", "no", context)).rejects.toThrow("invisible");
  });

  it("rejects non-JSON payloads and exposes a failed queued commit at the flush boundary", async () => {
    const { state, harness, conversation } = await fixture();
    expect(() => state.appendCustomEntry("extension", { invalid: Number.NaN }, context)).toThrow();
    expect((await harness.snapshot(ExtensionEntries, conversation.id, "extension", context))?.entries ?? []).toEqual([]);
    await state.setSessionName("committed", context);
    await harness.close(context);
    // An SDK callback need not await this promise. The state retains the rejection for its enclosing barrier.
    void state.setSessionName("not saved", context);
    await expect(state.flush(context)).rejects.toThrow();
  });

  it("runs a configured SDK extension through the real runner and fails its callback boundary on a queued commit failure", async () => {
    const f = await fixture();
    const anchor = await f.conversation.commit(tx => tx.appendEntry(f.conversation.id, { kind: "forgerie.origin", data: null }), context);
    const manager = SessionManager.inMemory(f.directory);
    const modelRuntime = await ModelRuntime.create({ authPath: join(f.directory, "auth.json"), modelsPath: join(f.directory, "models.json") });
    let readDuringCallback: string | undefined;
    const services = await createAgentSessionServices({ cwd: f.directory, agentDir: join(f.directory, "agent"), modelRuntime,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
        extensionFactories: [{ name: "parent-state-acceptance", factory(pi) {
          pi.on("session_start", () => {
            pi.appendEntry("configured-extension", { step: 1 });
            pi.appendEntry("configured-extension", { step: 2 });
            pi.setLabel(String(anchor.id), "extension label");
            pi.setSessionName("Extension title");
            readDuringCallback = pi.getSessionName();
          });
        } }],
      } });
    const extensions = services.resourceLoader.getExtensions();
    expect(extensions.errors).toEqual([]);
    const runner = new ExtensionRunner(extensions.extensions, extensions.runtime, f.directory, manager, new ModelRegistry(modelRuntime));
    const committedName: { value?: string } = {};
    runner.bindCore({ ...extensions.runtime,
      appendEntry: (type, data) => { void f.state.appendCustomEntry(type, data === undefined ? undefined : durableJson(data), context); },
      setLabel: (id, label) => { void f.state.setLabel(id, label, context); },
      setSessionName: name => { void f.state.setSessionName(name, context); },
      getSessionName: () => committedName.value,
    }, { getModel: () => undefined, getScopedModels: () => [], isIdle: () => true, isProjectTrusted: () => true,
      getSignal: () => undefined, abort: () => undefined, hasPendingMessages: () => false, shutdown: () => undefined,
      getContextUsage: () => undefined, compact: () => undefined, getSystemPrompt: () => "" });
    const callbackBoundary = async () => { await runner.emit({ type: "session_start", reason: "startup" }); await f.state.flush(context); };
    await callbackBoundary();
    expect(readDuringCallback).toBeUndefined(); // SDK read-after-write sees the last committed cache, not a queued name.
    const name = (await f.harness.snapshot(SessionName, f.conversation.id, context))?.name;
    if (name !== undefined) committedName.value = name;
    expect(committedName.value).toBe("Extension title");
    expect((await f.harness.snapshot(ExtensionEntries, f.conversation.id, "configured-extension", context))?.entries.map(entry => entry.data)).toEqual([{ step: 1 }, { step: 2 }]);
    expect((await f.harness.snapshot(Labels, f.conversation.id, context))?.entries[String(anchor.id)]?.label).toBe("extension label");
    const database = new DatabaseSync(f.databasePath);
    try {
      database.exec("CREATE TRIGGER reject_extension_commit BEFORE INSERT ON document_revisions BEGIN SELECT RAISE(FAIL, 'extension commit unavailable'); END");
      await expect(callbackBoundary()).rejects.toThrow("extension commit unavailable");
      database.exec("DROP TRIGGER reject_extension_commit");
      await f.harness.close(context);
      const reopened = await f.open();
      expect((await reopened.harness.snapshot(ExtensionEntries, reopened.conversation.id, "configured-extension", context))?.entries).toHaveLength(2);
      expect((await reopened.harness.snapshot(SessionName, reopened.conversation.id, context))?.name).toBe("Extension title");
    } finally { database.close(); }
    runner.invalidate("acceptance test complete");
  });

  it("rejects strict-JSON violations before queueing and snapshots a queued payload at the call boundary", async () => {
    const { state, harness, conversation } = await fixture();
    const cycle: Record<string, JsonValue> = {};
    cycle["self"] = cycle;
    const symbol: Record<string, JsonValue> = {};
    Object.defineProperty(symbol, Symbol("hidden"), { value: "not JSON" });
    const sparse = new Array<number>(2);
    for (const value of [cycle, symbol, sparse, { infinity: Number.POSITIVE_INFINITY }]) {
      expect(() => state.appendCustomEntry("extension", value, context)).toThrow();
    }
    const payload = { count: 1 };
    const write = state.appendCustomEntry("extension", payload, context);
    payload.count = 2;
    await write;
    expect((await harness.snapshot(ExtensionEntries, conversation.id, "extension", context))?.entries[0]?.data).toEqual({ count: 1 });
  });

  it("updates declaration intent from queued SDK protocol events without making reads start work", async () => {
    const { state, harness, conversation } = await fixture();
    void state.appendCustomEntry("forgerie.session-response.v1", { version: 1, kind: "started" }, context);
    await state.flush(context);
    expect(await state.response(context)).toEqual({ kind: "needs-response", reason: "undeclared" });
    expect((await harness.snapshot(ParentResponse, conversation.id, context))?.undeclaredRun).toBe(true);
    expect((await harness.inspect(context)).scheduling).toBe("paused");
  });

  it("stores missing-reply recovery independently from pending forms", async () => {
    const { harness, conversation } = await fixture();
    const cut = await conversation.commit(async tx => {
      (await tx.doc(ParentResponse, conversation.id)).missingReplyRetry = "spent";
      return (await tx.appendEntry(conversation.id, { kind: "forgerie.reply-refused", data: null })).id;
    }, context);
    const fork = await conversation.fork(cut, { ownership: { kind: "ownerless" } }, context);
    expect((await harness.snapshot(ParentResponse, fork.id, context))?.missingReplyRetry).toBe("spent");
  });
});
