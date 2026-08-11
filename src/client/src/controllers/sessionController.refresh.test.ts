import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { ChatTranscriptStore } from "../chatTranscriptStore";
import { textMessage } from "../chatMessages";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, EmitSocket, FakeSocket, oldSession, replacementSession, sessionLookupId, status, workspace, type AppState, type MessagePage, type SessionStatus, type SessionStreamSnapshot } from "./sessionController.testSupport";

function page(text: string, total: number): MessagePage {
  return { messages: [{ role: "assistant", content: text }], start: 0, total };
}

describe("SessionController selected-session refresh", () => {
  it("commits fresh transcript history before a delayed status/snapshot join becomes live-ready", async () => {
    const messages = deferred<MessagePage>();
    const selectedStatus = deferred<SessionStatus>();
    const snapshot = deferred<SessionStreamSnapshot>();
    const ready: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => messages.promise,
      status: () => selectedStatus.promise,
      streamSnapshot: () => snapshot.promise,
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), onSelectedSessionReady: ({ machineId, session }) => { ready.push(`${machineId}:${session.id}`); } },
    );

    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    await Promise.resolve();
    expect(state.selectedChatLoad).toMatchObject({ kind: "loading-without-content", target: { machineId: "local", sessionId: oldSession.id, cwd: oldSession.cwd } });

    messages.resolve(page("history first", 1));
    await Promise.resolve();
    await Promise.resolve();

    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "history first" }] }]);
    expect(state.selectedChatLoad).toMatchObject({ kind: "fresh-readable", target: { machineId: "local", sessionId: oldSession.id, cwd: oldSession.cwd } });
    expect(ready).toEqual([]);

    selectedStatus.resolve(status(oldSession.id));
    snapshot.resolve({ seq: 0, partial: null });
    await selecting;

    expect(state.selectedChatLoad).toMatchObject({ kind: "live-ready", target: { machineId: "local", sessionId: oldSession.id, cwd: oldSession.cwd } });
    expect(ready).toEqual([`local:${oldSession.id}`]);
  });

  it("paints a bounded prefetched transcript before canonical history and runtime readiness", async () => {
    const preview = deferred<MessagePage>();
    const canonical = deferred<MessagePage>();
    const selectedStatus = deferred<SessionStatus>();
    const snapshot = deferred<SessionStreamSnapshot>();
    const requests: { preview?: boolean }[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, options) => {
        requests.push({ ...(options?.preview === undefined ? {} : { preview: options.preview }) });
        return options?.preview === true ? preview.promise : canonical.promise;
      },
      status: () => selectedStatus.promise,
      streamSnapshot: () => snapshot.promise,
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const prefetched = controller.previewSession(oldSession, "local");
    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    preview.resolve(page("readable preview", 1));
    await prefetched;
    await Promise.resolve();

    expect(state.messages).toEqual([textMessage("assistant", "readable preview")]);
    expect(state.selectedChatLoad.kind).toBe("preview-readable");
    expect(requests).toEqual([{ preview: true }, {}]);

    canonical.resolve(page("canonical history", 1));
    selectedStatus.resolve(status(oldSession.id));
    snapshot.resolve({ seq: 0, partial: null });
    await selecting;

    expect(state.messages).toEqual([textMessage("assistant", "canonical history")]);
    expect(state.selectedChatLoad.kind).toBe("live-ready");
  });

  it("does not let a stalled preview block canonical readiness or queued delivery", async () => {
    const stalledPreview = deferred<MessagePage>();
    const delivered: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, options) => options?.preview === true ? stalledPreview.promise : Promise.resolve(page("canonical", 1)),
      status: () => Promise.resolve(status(oldSession.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      prompt: (_session, text) => { delivered.push(text); return Promise.resolve({ accepted: true }); },
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    void controller.previewSession(oldSession, "local");
    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    await controller.send("deliver without preview");
    await selecting;

    expect(state.selectedChatLoad.kind).toBe("live-ready");
    expect(delivered).toEqual(["deliver without preview"]);
  });

  it("does not synchronously render an oversized warm cache ahead of its bounded preview", async () => {
    const preview = deferred<MessagePage>();
    const canonical = deferred<MessagePage>();
    const selectedStatus = deferred<SessionStatus>();
    const snapshot = deferred<SessionStreamSnapshot>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (_session, options) => options?.preview === true ? preview.promise : canonical.promise,
      status: () => selectedStatus.promise,
      streamSnapshot: () => snapshot.promise,
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const transcripts = new ChatTranscriptStore();
    transcripts.mergeHistory("local:old-session", {
      messages: Array.from({ length: 30 }, (_, index) => ({ role: "assistant", content: `cached ${String(index)}` })),
      start: 0,
      total: 30,
    });
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), transcripts },
    );

    const prefetched = controller.previewSession(oldSession, "local");
    const selecting = controller.selectSession(oldSession, { updateUrl: false });

    expect(state.messages).toEqual([]);
    expect(state.selectedChatLoad.kind).toBe("loading-without-content");

    preview.resolve(page("bounded preview", 30));
    await prefetched;
    await Promise.resolve();
    expect(state.messages).toEqual([textMessage("assistant", "bounded preview")]);

    canonical.resolve(page("canonical", 30));
    selectedStatus.resolve(status(oldSession.id));
    snapshot.resolve({ seq: 0, partial: null });
    await selecting;
  });

  it("keeps an opening send owned by its non-selected target until that target is live", async () => {
    const messages = deferred<MessagePage>();
    const selectedStatus = deferred<SessionStatus>();
    const snapshot = deferred<SessionStreamSnapshot>();
    const delivered: { id: string; text: string; machineId: string | undefined }[] = [];
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: replacementSession,
      sessions: [replacementSession, oldSession],
      selectedChatLoad: { kind: "live-ready", target: { machineId: "local", sessionId: replacementSession.id, cwd: replacementSession.cwd } },
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => messages.promise,
      status: () => selectedStatus.promise,
      streamSnapshot: () => snapshot.promise,
      prompt: (session, text, _streamingBehavior, machineId) => { delivered.push({ id: session.id, text, machineId }); return Promise.resolve({ accepted: true }); },
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.sendToSession(oldSession, "local", "owned by target");
    expect(delivered).toEqual([]);
    expect(state.clientQueuedSessionMessages[oldSession.id]).toEqual([{ kind: "followUp", text: "owned by target" }]);

    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    messages.resolve(page("history", 1));
    selectedStatus.resolve(status(oldSession.id));
    snapshot.resolve({ seq: 0, partial: null });
    await selecting;

    expect(delivered).toEqual([{ id: oldSession.id, text: "owned by target", machineId: "local" }]);
  });

  it("accepts and visibly queues a send before live readiness, then delivers it in order", async () => {
    const messages = deferred<MessagePage>();
    const selectedStatus = deferred<SessionStatus>();
    const snapshot = deferred<SessionStreamSnapshot>();
    const delivered: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => messages.promise,
      status: () => selectedStatus.promise,
      streamSnapshot: () => snapshot.promise,
      prompt: (_session, text) => { delivered.push(text); return Promise.resolve({ accepted: true }); },
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    await Promise.resolve();
    await controller.send("first queued");
    await controller.send("second queued");
    await controller.send("third queued");

    expect(delivered).toEqual([]);
    expect(state.clientQueuedSessionMessages[oldSession.id]).toEqual([
      { kind: "followUp", text: "first queued" },
      { kind: "followUp", text: "second queued" },
      { kind: "followUp", text: "third queued" },
    ]);

    messages.resolve(page("history", 1));
    selectedStatus.resolve(status(oldSession.id));
    snapshot.resolve({ seq: 0, partial: null });
    await selecting;

    expect(delivered).toEqual(["first queued", "second queued", "third queued"]);
    expect(state.clientQueuedSessionMessages[oldSession.id]).toBeUndefined();
  });

  it("restores an ambiguous failed delivery instead of retrying it automatically", async () => {
    let promptCalls = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(page("history", 1)),
      status: () => Promise.resolve(status(oldSession.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      prompt: () => { promptCalls += 1; return Promise.reject(new Error("response lost")); },
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const replacePromptEditorText = vi.fn(() => true);
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), replacePromptEditorText },
    );

    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    await Promise.resolve();
    await controller.send("uncertain send");
    await selecting;
    await controller.refreshSelectedSession();

    expect(promptCalls).toBe(1);
    expect(state.error).toContain("delivery is uncertain");
    expect(state.clientQueuedSessionMessages[oldSession.id]).toBeUndefined();
    expect(replacePromptEditorText).toHaveBeenCalledWith({ machineId: "local", sessionId: oldSession.id, text: "uncertain send" });
  });

  it("restores queued sends when refresh runtime readiness fails", async () => {
    const selectedStatus = deferred<SessionStatus>();
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      selectedChatLoad: { kind: "live-ready", target: { machineId: "local", sessionId: oldSession.id, cwd: oldSession.cwd } },
    };
    const replacePromptEditorText = vi.fn(() => true);
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(page("history", 1)),
      status: () => selectedStatus.promise,
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), replacePromptEditorText },
    );

    const refreshing = controller.refreshSelectedSession();
    await vi.waitFor(() => { expect(state.selectedChatLoad.kind).toBe("fresh-readable"); });
    await controller.send("recover after readiness failure");
    selectedStatus.reject(new Error("status unavailable"));
    await refreshing;

    expect(state.selectedChatLoad.kind).toBe("failed");
    expect(state.error).toContain("restored to the draft");
    expect(state.clientQueuedSessionMessages[oldSession.id]).toBeUndefined();
    expect(replacePromptEditorText).toHaveBeenCalledWith({ machineId: "local", sessionId: oldSession.id, text: "recover after readiness failure" });
  });

  it("restores queued opening sends when navigation cannot reach the target", async () => {
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
      selectedChatLoad: { kind: "loading-without-content", target: { machineId: "local", sessionId: oldSession.id, cwd: oldSession.cwd } },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api: defaultApi, socket: new FakeSocket() },
    );

    await controller.send("recover me", undefined, [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }]);
    const recovery = controller.recoverReadinessSends(oldSession, "local");

    expect(recovery).toEqual({ count: 1, attachmentsNeedReattaching: true, restoredText: "recover me" });
    expect(state.clientQueuedSessionMessages[oldSession.id]).toBeUndefined();
  });

  it("keeps cached history readable and controls ineligible when the fresh history request fails", async () => {
    const ready: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.reject(new Error("history failed")),
      status: () => Promise.resolve(status(oldSession.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const transcripts = new ChatTranscriptStore();
    transcripts.mergeHistory("local:old-session", { messages: [{ role: "user", content: "cached" }], start: 0, total: 1 });
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), transcripts, onSelectedSessionReady: ({ machineId, session }) => { ready.push(`${machineId}:${session.id}`); } },
    );

    await controller.selectSession(oldSession, { updateUrl: false });

    expect(state.messages).toEqual([{ role: "user", parts: [{ type: "text", text: "cached" }] }]);
    expect(state.selectedChatLoad).toMatchObject({ kind: "failed", readability: "cached", target: { machineId: "local", sessionId: oldSession.id, cwd: oldSession.cwd } });
    expect(state.error).toContain("history failed");
    expect(ready).toEqual([]);
  });

  it("does not replay initial buffered transcript events when the stream snapshot join fails", async () => {
    const messages = deferred<MessagePage>();
    const selectedStatus = deferred<SessionStatus>();
    const snapshot = deferred<SessionStreamSnapshot>();
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => messages.promise,
      status: () => selectedStatus.promise,
      streamSnapshot: () => snapshot.promise,
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    await Promise.resolve();
    messages.resolve(page("fresh history", 1));
    await Promise.resolve();
    await Promise.resolve();
    socket.emit({ type: "message.append", message: { role: "assistant", content: "buffered event after history" }, seq: 1 });
    selectedStatus.resolve(status(oldSession.id));
    snapshot.reject(new Error("snapshot failed"));
    await selecting;

    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "fresh history" }] }]);
    expect(state.selectedChatLoad).toMatchObject({ kind: "failed", readability: "fresh" });
  });

  it("uses a successful stream snapshot watermark to dedupe buffered events when status fails", async () => {
    const messages = deferred<MessagePage>();
    const selectedStatus = deferred<SessionStatus>();
    const snapshot = deferred<SessionStreamSnapshot>();
    const socket = new EmitSocket();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => messages.promise,
      status: () => selectedStatus.promise,
      streamSnapshot: () => snapshot.promise,
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket },
    );

    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    await Promise.resolve();
    messages.resolve(page("fresh history", 1));
    await Promise.resolve();
    await Promise.resolve();
    socket.emit({ type: "message.append", message: { role: "assistant", content: "already in snapshot" }, seq: 2 });
    socket.emit({ type: "status.update", status: { ...status(oldSession.id), pendingMessageCount: 3 }, seq: 2 });
    snapshot.resolve({ seq: 2, partial: null });
    selectedStatus.reject(new Error("status failed"));
    await selecting;
    controller.flushPendingUpdates();

    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "fresh history" }] }]);
    expect(state.status?.pendingMessageCount).toBe(3);
    expect(state.selectedChatLoad).toMatchObject({ kind: "failed", readability: "fresh" });
  });

  it("loads an archived selection as read-only without connecting a session socket", async () => {
    const archived = { ...oldSession, archived: true, archivedAt: "2026-05-16T00:00:00.000Z" };
    const socket = new FakeSocket();
    const ready: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [archived] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(page("archived history", 1)),
      status: () => Promise.reject(new Error("status should not be called")),
      streamSnapshot: () => Promise.reject(new Error("snapshot should not be called")),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket, onSelectedSessionReady: ({ machineId, session }) => { ready.push(`${machineId}:${session.id}`); } },
    );

    await controller.selectSession(archived, { updateUrl: false });

    expect(socket.connectedSessionIds).toEqual([]);
    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "archived history" }] }]);
    expect(state.selectedChatLoad).toMatchObject({ kind: "read-only", readability: "fresh", target: { machineId: "local", sessionId: oldSession.id, cwd: oldSession.cwd } });
    expect(ready).toEqual([`local:${oldSession.id}`]);
  });

  it("signals selection readiness only after the initial transcript join succeeds", async () => {
    const messages = deferred<MessagePage>();
    const selectedStatus = deferred<SessionStatus>();
    const ready: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => messages.promise,
      status: () => selectedStatus.promise,
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api,
        socket: new FakeSocket(),
        onSelectedSessionReady: ({ machineId, session }) => { ready.push(`${machineId}:${session.id}`); },
      },
    );

    const selecting = controller.selectSession(oldSession, { updateUrl: false });
    await Promise.resolve();
    expect(ready).toEqual([]);

    messages.resolve(page("ready", 1));
    selectedStatus.resolve(status(oldSession.id));
    await selecting;

    expect(ready).toEqual([`local:${oldSession.id}`]);
  });

  it("shares same-turn requests and runs one trailing refresh requested during the active fetch", async () => {
    const firstPage = deferred<MessagePage>();
    const firstStatus = deferred<SessionStatus>();
    const trailingPage = deferred<MessagePage>();
    const trailingStatus = deferred<SessionStatus>();
    const trailingStarted = deferred<undefined>();
    let messageCalls = 0;
    let statusCalls = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => {
        messageCalls += 1;
        if (messageCalls === 2) trailingStarted.resolve(undefined);
        return messageCalls === 1 ? firstPage.promise : trailingPage.promise;
      },
      status: () => {
        statusCalls += 1;
        return statusCalls === 1 ? firstStatus.promise : trailingStatus.promise;
      },
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const first = controller.refreshSelectedSession();
    const duplicate = controller.refreshSelectedSession();
    await Promise.resolve();

    expect(messageCalls).toBe(1);
    expect(statusCalls).toBe(1);

    const later = controller.refreshSelectedSession();
    const laterDuplicate = controller.refreshSelectedSession();
    firstPage.resolve(page("stale", 1));
    firstStatus.resolve({ ...status(oldSession.id), messageCount: 1 });
    await trailingStarted.promise;

    expect(messageCalls).toBe(2);
    expect(statusCalls).toBe(2);

    trailingPage.resolve(page("fresh", 2));
    trailingStatus.resolve({ ...status(oldSession.id), messageCount: 2 });
    await Promise.all([first, duplicate, later, laterDuplicate]);

    expect(messageCalls).toBe(2);
    expect(statusCalls).toBe(2);
    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "fresh" }] }]);
    expect(state.status?.messageCount).toBe(2);
  });

  it("does not apply an older refresh after the user selects another session", async () => {
    const stalePage = deferred<MessagePage>();
    const staleStatus = deferred<SessionStatus>();
    const replacementPage = page("replacement", 1);
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession, replacementSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: (session) => sessionLookupId(session) === oldSession.id ? stalePage.promise : Promise.resolve(replacementPage),
      status: (session) => sessionLookupId(session) === oldSession.id ? staleStatus.promise : Promise.resolve(status(replacementSession.id)),
      streamSnapshot: () => Promise.resolve({ seq: 0, partial: null }),
      thinkingLevels: () => Promise.resolve({ levels: [] }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const staleRefresh = controller.refreshSelectedSession();
    await Promise.resolve();
    await controller.selectSession(replacementSession, { updateUrl: false });
    stalePage.resolve(page("old response", 1));
    staleStatus.resolve({ ...status(oldSession.id), messageCount: 1 });
    await staleRefresh;

    expect(state.selectedSession?.id).toBe(replacementSession.id);
    expect(state.messages).toEqual([{ role: "assistant", parts: [{ type: "text", text: "replacement" }] }]);
    expect(state.status?.sessionId).toBe(replacementSession.id);
  });

  it("fetches the join-time stream snapshot alongside messages and status on refresh", async () => {
    // Leg 3 contract: the snapshot is fetched for the selected session on the join
    // refresh path. Seeding/watermark application is deliberately NOT asserted here
    // (that is Leg 4); this only guards that the data is fetched.
    const snapshotLookups: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, selectedSession: oldSession, sessions: [oldSession] };
    const api: typeof defaultApi = {
      ...defaultApi,
      messages: () => Promise.resolve(page("live", 1)),
      status: () => Promise.resolve({ ...status(oldSession.id), isStreaming: true }),
      streamSnapshot: (session) => {
        snapshotLookups.push(sessionLookupId(session));
        return Promise.resolve({ seq: 5, partial: { role: "assistant", content: [{ type: "text", text: "partial" }] } });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.refreshSelectedSession();

    expect(snapshotLookups).toEqual([oldSession.id]);
  });
});
