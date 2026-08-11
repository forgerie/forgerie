import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, emptyPage, FakeSocket, MemoryStorage, oldSession, sessionLookupId, status, workspace, type AppState, type SessionInfo } from "./sessionController.testSupport";

describe("SessionController session launch", () => {
  it("selects one pending session and queues its initial prompt before creation resolves", async () => {
    const startRequest = deferred<SessionInfo>();
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const launch = controller.launchSession("Build the feature");
    const temporaryId = state.selectedSession?.id;

    expect(temporaryId).toMatch(/^pending-session-/);
    expect(state.sessions.map((session) => session.id)).toEqual([temporaryId]);
    expect(state.clientQueuedSessionMessages[temporaryId ?? ""]).toEqual([
      { kind: "followUp", text: "Build the feature" },
    ]);
    expect(state.activity).toMatchObject({
      sessionId: temporaryId,
      phase: "active",
      label: "Creating session",
    });

    startRequest.reject(new Error("stop test"));
    await launch;
  });

  it("retains stage-specific recovery data when creation fails", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.reject(new Error("backend unavailable")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Recover this prompt");
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected a failed pending session");

    expect(controller.getSessionLaunchRecovery(temporaryId)).toEqual({
      stage: "creationFailed",
      sessionId: temporaryId,
      destination: { machineId: "local", workspaceId: workspace.id, cwd: workspace.path },
      prompt: "Recover this prompt",
      retrying: false,
    });
    expect(state.clientQueuedSessionMessages[temporaryId]).toEqual([
      { kind: "followUp", text: "Recover this prompt" },
    ]);
    expect(state.activity).toMatchObject({ phase: "error", label: "Session creation failed" });
    const durableValues = Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "") ?? "");
    expect(durableValues.join("\n")).not.toContain("Recover this prompt");

    await controller.deleteCachedNewSession(state.selectedSession);

    expect(controller.getSessionLaunchRecovery(temporaryId)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[temporaryId]).toBeUndefined();
  });

  it("clears a failed creation only after a replacement pending launch is accepted", async () => {
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.reject(new Error("backend unavailable")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Move this prompt");
    const failedId = state.selectedSession?.id;
    if (failedId === undefined) throw new Error("Expected a failed pending session");
    const failedSession = state.selectedSession;
    expect(state.sessions).toContain(failedSession);
    const replacement = { ...oldSession, id: "pending-replacement", clientPendingStart: true as const, machineId: "local" };
    state = { ...state, selectedSession: replacement, sessions: [replacement, ...state.sessions] };

    controller.acceptSessionLaunchReplacement(failedId, replacement.id);

    expect(state.sessions).toEqual([replacement]);
    expect(state.sessions).not.toContain(failedSession);
    expect(state.clientQueuedSessionMessages[failedId]).toBeUndefined();
    expect(controller.getSessionLaunchRecovery(failedId)).toBeUndefined();
  });

  it("retries failed creation once while a retry is active and keeps the original queue", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const retryStart = deferred<SessionInfo>();
    let startCallCount = 0;
    const promptCalls: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => {
        startCallCount += 1;
        return startCallCount === 1 ? Promise.reject(new Error("backend unavailable")) : retryStart.promise;
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: (_session, text) => { promptCalls.push(text); return Promise.resolve({ accepted: true }); },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Recover creation");
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected a failed pending session");

    const firstRetry = controller.retrySessionLaunch(temporaryId);
    const secondRetry = controller.retrySessionLaunch(temporaryId);

    expect(startCallCount).toBe(2);
    expect(controller.getSessionLaunchRecovery(temporaryId)?.retrying).toBe(true);
    expect(state.clientQueuedSessionMessages[temporaryId]).toEqual([
      { kind: "followUp", text: "Recover creation" },
    ]);

    retryStart.resolve(started);
    await Promise.all([firstRetry, secondRetry]);

    expect(startCallCount).toBe(2);
    expect(promptCalls).toEqual(["Recover creation"]);
    expect(controller.getSessionLaunchRecovery(temporaryId)).toBeUndefined();
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[temporaryId]).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
  });

  it("classifies a rejected delivery as accepted when the canonical transcript contains the prompt", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    let deliveryAttempted = false;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(deliveryAttempted
        ? { messages: [{ role: "user", content: "The accepted prompt" }], start: 0, total: 1 }
        : emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => {
        deliveryAttempted = true;
        return Promise.reject(new Error("response lost"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("The accepted prompt");

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.error).toBe("");
  });

  it("offers one guarded retry when delivery is confirmed unsent", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const retryRequest = deferred<{ accepted: true }>();
    let promptCallCount = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => {
        promptCallCount += 1;
        return promptCallCount === 1 ? Promise.reject(new Error("definitely not sent")) : retryRequest.promise;
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Retry this prompt");

    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({
      stage: "promptConfirmedUnsent",
      prompt: "Retry this prompt",
      retrying: false,
    });
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "Retry this prompt" },
    ]);

    const firstRetry = controller.retrySessionLaunch(started.id);
    const secondRetry = controller.retrySessionLaunch(started.id);

    expect(promptCallCount).toBe(2);
    expect(controller.getSessionLaunchRecovery(started.id)?.retrying).toBe(true);

    retryRequest.resolve({ accepted: true });
    await Promise.all([firstRetry, secondRetry]);

    expect(promptCallCount).toBe(2);
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
  });

  it("transfers ambiguous delivery to the editor only after replacement succeeds", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const replacement = deferred<undefined>();
    const replacements: string[] = [];
    let promptCallCount = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: () => {
        promptCallCount += 1;
        return Promise.reject(new Error("delivery timed out"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api,
        socket: new FakeSocket(),
        replacePromptEditorText: ({ text }) => {
          replacements.push(text);
          return replacement.promise;
        },
      },
    );

    await controller.launchSession("Inspect before resending");

    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({
      stage: "promptDeliveryAmbiguous",
      prompt: "Inspect before resending",
      retrying: false,
    });
    await controller.retrySessionLaunch(started.id);
    expect(promptCallCount).toBe(1);

    const restore = controller.restoreSessionLaunchPrompt(started.id);

    expect(replacements).toEqual(["Inspect before resending"]);
    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "Inspect before resending" },
    ]);

    replacement.resolve(undefined);
    await restore;

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBeUndefined();
    expect(state.activity).toBeUndefined();
    expect(state.error).toBe("");
  });

  it("restores only the ambiguous first prompt and flushes later queued sends", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const shellRequest = deferred<{ accepted: true }>();
    const shellStarted = deferred<undefined>();
    const promptCalls: string[] = [];
    const shellCalls: string[] = [];
    const replacements: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: (_session, text) => {
        promptCalls.push(text);
        return text === "Ambiguous first prompt"
          ? Promise.reject(new Error("delivery timed out"))
          : Promise.resolve({ accepted: true });
      },
      shell: (_session, text) => {
        shellCalls.push(text);
        shellStarted.resolve(undefined);
        return shellRequest.promise;
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api,
        socket: new FakeSocket(),
        replacePromptEditorText: ({ text }) => {
          replacements.push(text);
          return Promise.resolve(undefined);
        },
      },
    );

    const launch = controller.launchSession("Ambiguous first prompt");
    await controller.runShell("!pwd");
    await controller.send("Continue after restore");
    startRequest.resolve(started);
    await launch;

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "Ambiguous first prompt" },
      { kind: "followUp", text: "!pwd" },
      { kind: "followUp", text: "Continue after restore" },
    ]);

    const restore = controller.restoreSessionLaunchPrompt(started.id);
    await shellStarted.promise;

    expect(replacements).toEqual(["Ambiguous first prompt"]);
    expect(promptCalls).toEqual(["Ambiguous first prompt"]);
    expect(shellCalls).toEqual(["!pwd"]);
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "!pwd" },
      { kind: "followUp", text: "Continue after restore" },
    ]);

    shellRequest.resolve({ accepted: true });
    await restore;

    expect(promptCalls).toEqual(["Ambiguous first prompt", "Continue after restore"]);
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBeUndefined();
    expect(state.activity).toBeUndefined();
    expect(state.error).toBe("");
  });

  it("keeps ambiguous recovery and its queued preview when editor replacement fails", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: () => Promise.reject(new Error("delivery timed out")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      {
        api,
        socket: new FakeSocket(),
        replacePromptEditorText: () => Promise.reject(new Error("editor unavailable")),
      },
    );

    await controller.launchSession("Keep this prompt");

    await expect(controller.restoreSessionLaunchPrompt(started.id)).rejects.toThrow("editor unavailable");

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "Keep this prompt" },
    ]);
  });

  it("clears accepted recovery and flushes retained tail sends in order after transcript refresh", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const calls: string[] = [];
    let transcriptContainsPrompt = false;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(transcriptContainsPrompt
        ? { messages: [{ role: "user", content: "Accepted after timeout" }], start: 0, total: 1 }
        : emptyPage),
      status: (session) => Promise.resolve(transcriptContainsPrompt
        ? status(sessionLookupId(session))
        : { ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: (_session, text) => {
        calls.push(`prompt:${text}`);
        return text === "Accepted after timeout"
          ? Promise.reject(new Error("delivery timed out"))
          : Promise.resolve({ accepted: true });
      },
      shell: (_session, text) => { calls.push(`shell:${text}`); return Promise.resolve({ accepted: true }); },
      runCommand: (_session, text) => { calls.push(`command:${text}`); return Promise.resolve({ type: "done" }); },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const launch = controller.launchSession("Accepted after timeout");
    await controller.runShell("!pwd");
    await controller.runCommand("/help");
    await controller.send("Continue after recovery");
    startRequest.resolve(started);
    await launch;

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(calls).toEqual(["prompt:Accepted after timeout"]);

    transcriptContainsPrompt = true;
    await controller.refreshSessionLaunchRecovery(started.id);

    expect(calls).toEqual([
      "prompt:Accepted after timeout",
      "shell:!pwd",
      "command:/help",
      "prompt:Continue after recovery",
    ]);
    expect(state.messages).toEqual([
      { role: "user", parts: [{ type: "text", text: "Accepted after timeout" }] },
      { role: "user", parts: [{ type: "text", text: "!pwd" }] },
    ]);
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBeUndefined();
    expect(state.activity).toBeUndefined();
    expect(state.error).toBe("");
  });

  it("changes ambiguous recovery to confirmed unsent after refresh without resending", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const promptCalls: string[] = [];
    let transcriptIsIdle = false;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(transcriptIsIdle
        ? status(sessionLookupId(session))
        : { ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: (_session, text) => {
        promptCalls.push(text);
        return Promise.reject(new Error("delivery timed out"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Refresh without resending");
    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");

    transcriptIsIdle = true;
    await controller.refreshSessionLaunchRecovery(started.id);

    expect(promptCalls).toEqual(["Refresh without resending"]);
    expect(state.status).toEqual(status(started.id));
    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({
      stage: "promptConfirmedUnsent",
      prompt: "Refresh without resending",
      retrying: false,
    });
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "Refresh without resending" },
    ]);
  });

  it("keeps ambiguous recovery without resending when transcript reconciliation fails", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const promptCalls: string[] = [];
    let reconciliationShouldFail = false;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => reconciliationShouldFail
        ? Promise.reject(new Error("canonical transcript unavailable"))
        : Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: (_session, text) => {
        promptCalls.push(text);
        return Promise.reject(new Error("delivery timed out"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Do not resend this prompt");
    reconciliationShouldFail = true;

    await controller.refreshSessionLaunchRecovery(started.id);

    expect(promptCalls).toEqual(["Do not resend this prompt"]);
    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "Do not resend this prompt" },
    ]);
    expect(state.error).toContain("canonical transcript unavailable");
  });

  it("keeps delivery recovery out of durable storage and clears it when the resolved session is deleted", async () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => Promise.reject(new Error("confirmed unsent")),
      stop: () => Promise.resolve({ stopped: true }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Never persist this recovery prompt");

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptConfirmedUnsent");
    const durableValues = Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "") ?? "");
    expect(durableValues.join("\n")).not.toContain("Never persist this recovery prompt");

    await controller.deleteCachedNewSession(state.selectedSession);

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBeUndefined();
    expect(state.sessions.some((session) => session.id === started.id)).toBe(false);
  });

  it("clears delivery recovery projections when the session is archived", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const nextSession: SessionInfo = { ...oldSession, id: "next-session", path: "/tmp/next-session.jsonl" };
    const unrelatedActivity = { sessionId: nextSession.id, phase: "active" as const, label: "Other activity", at: "now" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => Promise.reject(new Error("confirmed unsent")),
      archive: () => Promise.resolve({ archived: true }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Do not retain after archive");
    const persisted = { ...started, persisted: true };
    state = {
      ...state,
      selectedSession: nextSession,
      sessions: [persisted, nextSession],
      sendingPrompts: { [started.id]: true },
      sessionActivities: { ...state.sessionActivities, [nextSession.id]: unrelatedActivity },
      activity: unrelatedActivity,
      error: "Keep this error",
    };
    expect(controller.getSessionLaunchRecovery(started.id)).toBeDefined();

    await controller.archiveSession(persisted);

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBeUndefined();
    expect(state.sendingPrompts[started.id]).toBeUndefined();
    expect(state.sessionActivities[nextSession.id]).toBe(unrelatedActivity);
    expect(state.activity).toBe(unrelatedActivity);
    expect(state.error).toBe("Keep this error");
  });

  it("clears delivery recovery projections when an archived session is deleted", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const nextSession: SessionInfo = { ...oldSession, id: "next-session", path: "/tmp/next-session.jsonl" };
    const unrelatedActivity = { sessionId: nextSession.id, phase: "active" as const, label: "Other activity", at: "now" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => Promise.reject(new Error("confirmed unsent")),
      deleteArchivedMany: (sessions) => Promise.resolve({ deleted: true, deletedSessionIds: sessions.map(sessionLookupId), failures: [], generatedAt: "now" }),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Do not retain after delete");
    const archived = { ...started, archived: true, archivedAt: "now" };
    const recoveryActivity = state.activity;
    state = {
      ...state,
      selectedSession: nextSession,
      sessions: [archived, nextSession],
      sendingPrompts: { [started.id]: true },
      sessionActivities: { ...state.sessionActivities, [nextSession.id]: unrelatedActivity },
      activity: recoveryActivity,
      error: "Keep this error",
    };
    expect(controller.getSessionLaunchRecovery(started.id)).toBeDefined();

    await controller.deleteArchivedSessions([archived]);

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBeUndefined();
    expect(state.sendingPrompts[started.id]).toBeUndefined();
    expect(state.sessionActivities[nextSession.id]).toBe(unrelatedActivity);
    expect(state.activity).toBeUndefined();
    expect(state.error).toBe("Keep this error");
  });

  it("clears delivery recovery projections when session cleanup archives the session", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const nextSession: SessionInfo = { ...oldSession, id: "next-session", path: "/tmp/next-session.jsonl" };
    const unrelatedActivity = { sessionId: nextSession.id, phase: "active" as const, label: "Other activity", at: "now" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => Promise.reject(new Error("confirmed unsent")),
      sessions: () => Promise.resolve([nextSession]),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Do not retain after cleanup");
    state = {
      ...state,
      selectedSession: nextSession,
      sessions: [started, nextSession],
      sendingPrompts: { [started.id]: true },
      sessionActivities: { ...state.sessionActivities, [nextSession.id]: unrelatedActivity },
      activity: unrelatedActivity,
      error: "Keep this error",
    };
    expect(controller.getSessionLaunchRecovery(started.id)).toBeDefined();

    await controller.applySessionCleanupResult({
      generatedAt: "now",
      thresholds: { archiveIdleDays: 30, deleteArchivedDays: 60 },
      projects: [{ cwd: workspace.path, archiveCount: 1, deleteCount: 0 }],
      totals: { archiveCount: 1, deleteCount: 0 },
      archivedSessionIds: [started.id],
      deletedSessionIds: [],
    });

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBeUndefined();
    expect(state.sendingPrompts[started.id]).toBeUndefined();
    expect(state.sessionActivities[nextSession.id]).toBe(unrelatedActivity);
    expect(state.activity).toBe(unrelatedActivity);
    expect(state.error).toBe("Keep this error");
  });

  it("preserves local recovery projections when cleanup belongs to another machine", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => Promise.reject(new Error("confirmed unsent")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession("Keep local recovery");
    state = { ...state, sendingPrompts: { [started.id]: true }, error: "Keep this error" };
    const recoveryActivity = state.sessionActivities[started.id];

    await controller.applySessionCleanupResult({
      generatedAt: "now",
      thresholds: { archiveIdleDays: 30, deleteArchivedDays: 60 },
      projects: [{ cwd: workspace.path, archiveCount: 1, deleteCount: 0 }],
      totals: { archiveCount: 1, deleteCount: 0 },
      archivedSessionIds: [started.id],
      deletedSessionIds: [],
    }, "remote");

    expect(controller.getSessionLaunchRecovery(started.id)).toBeDefined();
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "Keep local recovery" },
    ]);
    expect(state.sessionActivities[started.id]).toBe(recoveryActivity);
    expect(state.activity).toBe(recoveryActivity);
    expect(state.sendingPrompts[started.id]).toBe(true);
    expect(state.error).toBe("Keep this error");
  });

  it("keeps prompts, shell input, and commands queued after the initial prompt in their original order", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const calls: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: (_session, text) => { calls.push(`prompt:${text}`); return Promise.resolve({ accepted: true }); },
      shell: (_session, text) => { calls.push(`shell:${text}`); return Promise.resolve({ accepted: true }); },
      runCommand: (_session, text) => { calls.push(`command:${text}`); return Promise.resolve({ type: "done" }); },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const launch = controller.launchSession("First prompt");
    await controller.runShell("!pwd");
    await controller.runCommand("/help");
    await controller.send("Later prompt");

    startRequest.resolve(started);
    await launch;

    expect(calls).toEqual([
      "prompt:First prompt",
      "shell:!pwd",
      "command:/help",
      "prompt:Later prompt",
    ]);
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
  });

  it("replaces the pending identity, delivers the initial prompt once, and clears its preview after acceptance", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const promptCalls: { sessionId: string; text: string }[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: (session, text) => {
        promptCalls.push({ sessionId: sessionLookupId(session), text });
        return Promise.resolve({ accepted: true });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const launch = controller.launchSession("Build the feature");
    const temporaryId = state.selectedSession?.id;
    startRequest.resolve(started);
    await launch;

    expect(state.sessions.map((session) => session.id)).toEqual([started.id]);
    expect(state.selectedSession?.id).toBe(started.id);
    expect(promptCalls).toEqual([{ sessionId: started.id, text: "Build the feature" }]);
    expect(state.clientQueuedSessionMessages[temporaryId ?? ""]).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
  });
});
