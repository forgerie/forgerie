import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { SessionController, type PromptEditorTextReplacement } from "./sessionController";
import { fingerprintPromptResourceDeliveryText, type PromptResourceCommandIdentity } from "../../../shared/promptResourceCommand";
import { defaultApi, deferred, emptyPage, FakeSocket, MemoryStorage, oldSession, sessionLookupId, status, workspace, type AppState, type PromptAttachment, type SessionInfo } from "./sessionController.testSupport";

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

    const launch = controller.launchSession({ text: "Build the feature" });
    const temporaryId = state.selectedSession?.id;

    expect(temporaryId).toMatch(/^pending-session-/);
    expect(state.sessions.map((session) => session.id)).toEqual([temporaryId]);
    expect(state.clientQueuedSessionMessages[temporaryId ?? ""]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);
    expect(state.activity).toMatchObject({
      sessionId: temporaryId,
      phase: "active",
      label: "Creating session",
    });

    startRequest.reject(new Error("stop test"));
    await launch;
  });

  it("launches one session with a typed first-prompt submission and inline attachments", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    const promptCalls: { sessionId: string; text: string; attachments?: PromptAttachment[] }[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: (session, text, _behavior, _machineId, sentAttachments) => {
        promptCalls.push({ sessionId: sessionLookupId(session), text, ...(sentAttachments === undefined ? {} : { attachments: sentAttachments }) });
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

    const launch = controller.launchSession({ text: "Build with image", attachments, delivery: "inline" });
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected pending session");

    expect(state.sessions.map((session) => session.id)).toEqual([temporaryId]);
    expect(state.clientQueuedSessionMessages[temporaryId]).toEqual([
      { kind: "followUp", text: "[First prompt queued]\n\n[1 attachment queued: shot.png]" },
    ]);

    startRequest.resolve(started);
    await launch;

    expect(promptCalls).toEqual([{ sessionId: started.id, text: "Build with image", attachments }]);
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
  });

  it("allows an attachment-only launch through the structured empty-submission guard", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    const promptCalls: { text: string; attachments?: PromptAttachment[] }[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: (_session, text, _behavior, _machineId, sentAttachments) => {
        promptCalls.push({ text, ...(sentAttachments === undefined ? {} : { attachments: sentAttachments }) });
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

    await controller.launchSession({ text: "", attachments, delivery: "inline" });

    expect(promptCalls).toEqual([{ text: "", attachments }]);
    expect(state.sessions).toHaveLength(1);
    expect(state.selectedSession?.id).toBe(started.id);
  });

  it("exposes only attachment metadata for failed launch recovery and retries with private payloads", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    const promptCalls: { text: string; attachments?: PromptAttachment[] }[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    let startCount = 0;
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => {
        startCount += 1;
        return startCount === 1 ? Promise.reject(new Error("backend unavailable")) : Promise.resolve(started);
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: (_session, text, _behavior, _machineId, sentAttachments) => {
        promptCalls.push({ text, ...(sentAttachments === undefined ? {} : { attachments: sentAttachments }) });
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

    await controller.launchSession({ text: "Recover with attachment", attachments, delivery: "inline" });
    const failedId = state.selectedSession?.id;
    if (failedId === undefined) throw new Error("Expected failed pending session");

    const recovery = controller.getSessionLaunchRecovery(failedId);
    expect(recovery).toMatchObject({
      stage: "creationFailed",
      retrying: false,
      attachments: [{ mimeType: "image/png", name: "shot.png", size: 3 }],
      delivery: "inline",
    });
    expect(JSON.stringify(recovery)).not.toContain("QUJD");

    await controller.retrySessionLaunch(failedId);

    expect(promptCalls).toEqual([{ text: "Recover with attachment", attachments }]);
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
  });

  it("runs a prevalidated prompt-resource first prompt through the identity-bound endpoint only", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    let genericPromptCalls = 0;
    let genericCommandCalls = 0;
    const resourceCalls: { text: string; identity: PromptResourceCommandIdentity }[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => { genericPromptCalls += 1; return Promise.resolve({ accepted: true }); },
      runCommand: () => { genericCommandCalls += 1; return Promise.resolve({ type: "done" }); },
      runPromptResourceCommand: (_session, text, sentIdentity) => {
        resourceCalls.push({ text, identity: sentIdentity });
        return Promise.resolve({ accepted: true, deliveryFingerprint: "b".repeat(64) });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/review src", delivery: "inline", promptResourceCommandIdentity: identity });

    expect(resourceCalls).toEqual([{ text: "/review src", identity }]);
    expect(genericPromptCalls).toBe(0);
    expect(genericCommandCalls).toBe(0);
  });

  it("appends folder references before identity-bound first-prompt execution", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const identity: PromptResourceCommandIdentity = { source: "skill", name: "skill:audit", fingerprint: "a".repeat(64) };
    const attachments: PromptAttachment[] = [{ kind: "file", mimeType: "text/plain", data: "SGVsbG8=", name: "notes.txt" }];
    const calls: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      saveAttachments: (_session, sentAttachments) => {
        calls.push(`save:${sentAttachments[0]?.name ?? ""}`);
        return Promise.resolve([{ path: ".forgerie/attachments/notes.txt", mimeType: "text/plain", size: 5 }]);
      },
      prompt: () => { calls.push("generic-prompt"); return Promise.resolve({ accepted: true }); },
      runCommand: () => { calls.push("generic-command"); return Promise.resolve({ type: "done" }); },
      runPromptResourceCommand: (_session, text, sentIdentity, _behavior, _machineId, sentAttachments) => {
        calls.push(`resource:${text}:${sentIdentity.fingerprint}:${String(sentAttachments?.length ?? 0)}`);
        return Promise.resolve({ accepted: true, deliveryFingerprint: "b".repeat(64) });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/skill:audit target", attachments, delivery: "folder", promptResourceCommandIdentity: identity });

    expect(calls).toEqual([
      "save:notes.txt",
      `resource:/skill:audit target\n\n@.forgerie/attachments/notes.txt:${identity.fingerprint}:0`,
    ]);
  });

  it("retains confirmed-unsent prompt-resource recovery without calling generic prompt or command", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
    let genericPromptCalls = 0;
    let genericCommandCalls = 0;
    let resourceCalls = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => { genericPromptCalls += 1; return Promise.resolve({ accepted: true }); },
      runCommand: () => { genericCommandCalls += 1; return Promise.resolve({ type: "done" }); },
      runPromptResourceCommand: () => {
        resourceCalls += 1;
        return Promise.reject(new Error("Prompt-resource command is no longer available"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/review src", attachments, delivery: "inline", promptResourceCommandIdentity: identity });

    expect(resourceCalls).toBe(1);
    expect(genericPromptCalls).toBe(0);
    expect(genericCommandCalls).toBe(0);
    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({
      stage: "promptConfirmedUnsent",
      attachments: [{ mimeType: "image/png", name: "shot.png", size: 3 }],
    });
    expect(JSON.stringify(controller.getSessionLaunchRecovery(started.id))).not.toContain("QUJD");
    expect(controller.getSessionLaunchRecovery(started.id)).not.toHaveProperty("promptResourceCommandIdentity");
  });

  it("clears prompt-resource ambiguous recovery when expanded transcript text matches the delivery receipt", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    const expandedText = "Review src";
    const receipt = await fingerprintPromptResourceDeliveryText(expandedText);
    const transcriptText = expandedText;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve({ messages: [{ role: "user", content: transcriptText }], start: 0, total: 1 }),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      runPromptResourceCommand: () => Promise.reject(new Error("delivery timed out")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/review src", delivery: "inline", promptResourceCommandIdentity: identity });
    recordLaunchDeliveryReceipt(controller, started.id, receipt);

    await controller.refreshSessionLaunchRecovery(started.id);

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
  });

  it("keeps prompt-resource ambiguous recovery when transcript text does not match the delivery receipt", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    const receipt = await fingerprintPromptResourceDeliveryText("Review src");
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve({ messages: [{ role: "user", content: "Review other" }], start: 0, total: 1 }),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      runPromptResourceCommand: () => Promise.reject(new Error("delivery timed out")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/review src", delivery: "inline", promptResourceCommandIdentity: identity });
    recordLaunchDeliveryReceipt(controller, started.id, receipt);

    await controller.refreshSessionLaunchRecovery(started.id);

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);
  });

  it("does not clear prompt-resource recovery from raw slash text when the delivery receipt was for expanded text", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    const receipt = await fingerprintPromptResourceDeliveryText("Review src");
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve({ messages: [{ role: "user", content: "/review src" }], start: 0, total: 1 }),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      runPromptResourceCommand: () => Promise.reject(new Error("delivery timed out")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/review src", delivery: "inline", promptResourceCommandIdentity: identity });
    recordLaunchDeliveryReceipt(controller, started.id, receipt);

    await controller.refreshSessionLaunchRecovery(started.id);

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);
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

    await controller.launchSession({ text: "Recover this prompt" });
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected a failed pending session");

    expect(controller.getSessionLaunchRecovery(temporaryId)).toEqual({
      stage: "creationFailed",
      sessionId: temporaryId,
      destination: { machineId: "local", workspaceId: workspace.id, cwd: workspace.path },
      retrying: false,
    });
    expect(state.clientQueuedSessionMessages[temporaryId]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);
    expect(state.activity).toMatchObject({ phase: "error", label: "Session creation failed" });
    const durableValues = Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? "") ?? "");
    expect(durableValues.join("\n")).not.toContain("Recover this prompt");

    await controller.deleteCachedNewSession(state.selectedSession);

    expect(controller.getSessionLaunchRecovery(temporaryId)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[temporaryId]).toBeUndefined();
  });

  it("moves a claimed creation recovery draft out of the controller queue until rollback", async () => {
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

    const launch = controller.launchSession({ text: "Recover privately" });
    const failedId = state.selectedSession?.id;
    if (failedId === undefined) throw new Error("Expected pending session");
    await controller.send("Queued behind it");
    startRequest.reject(new Error("backend unavailable"));
    await launch;

    const seed = controller.claimSessionLaunchRecoveryDraft(failedId);

    expect(seed).toEqual({ id: `${failedId}:claim-1`, snapshot: { text: "Recover privately", delivery: "inline" } });
    expect(controller.claimSessionLaunchRecoveryDraft(failedId)).toBeUndefined();
    expect(controller.getSessionLaunchRecovery(failedId)).not.toHaveProperty("prompt");
    expect(state.clientQueuedSessionMessages[failedId]).toEqual([{ kind: "followUp", text: "Queued behind it" }]);
    expect(JSON.stringify({ recovery: controller.getSessionLaunchRecovery(failedId), queued: state.clientQueuedSessionMessages[failedId] })).not.toContain("Recover privately");
    expect(queuedRecoveryTexts(controller, failedId)).toEqual(["Queued behind it"]);

    controller.returnSessionLaunchRecoveryDraft(failedId, { text: "Edited recovery", delivery: "inline" });

    expect(controller.getSessionLaunchRecovery(failedId)).not.toHaveProperty("prompt");
    expect(state.clientQueuedSessionMessages[failedId]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
      { kind: "followUp", text: "Queued behind it" },
    ]);
    expect(queuedRecoveryTexts(controller, failedId)).toEqual(["Edited recovery", "Queued behind it"]);
    expect(controller.claimSessionLaunchRecoveryDraft(failedId)).toEqual({ id: `${failedId}:claim-2`, snapshot: { text: "Edited recovery", delivery: "inline" } });
    expect(state.clientQueuedSessionMessages[failedId]).toEqual([{ kind: "followUp", text: "Queued behind it" }]);
  });

  it("does not requeue an empty first prompt when a recovered draft is cleared", async () => {
    let startCount = 0;
    const prompt = vi.fn(() => Promise.resolve({ accepted: true as const }));
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => {
        startCount += 1;
        return startCount === 1 ? Promise.reject(new Error("backend unavailable")) : Promise.resolve({ ...oldSession, id: "blank-replacement" });
      },
      prompt,
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "remove this prompt" });
    const failedId = state.selectedSession?.id;
    if (failedId === undefined) throw new Error("Expected failed pending session");
    controller.claimSessionLaunchRecoveryDraft(failedId);

    controller.returnSessionLaunchRecoveryDraft(failedId, { text: "", delivery: "inline" });

    expect(queuedRecoveryTexts(controller, failedId)).toEqual([]);
    expect(state.clientQueuedSessionMessages[failedId]).toBeUndefined();
    await controller.retrySessionLaunch(failedId);
    expect(startCount).toBe(2);
    expect(prompt).not.toHaveBeenCalled();
  });

  it("restores claimed attachment-only recovery drafts without retaining base64 in app state", async () => {
    const attachments: PromptAttachment[] = [{ kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" }];
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

    await controller.launchSession({ text: "", attachments, delivery: "inline" });
    const failedId = state.selectedSession?.id;
    if (failedId === undefined) throw new Error("Expected failed pending session");

    const seed = controller.claimSessionLaunchRecoveryDraft(failedId);

    expect(seed).toEqual({ id: `${failedId}:claim-1`, snapshot: { text: "", attachments, delivery: "inline" } });
    expect(JSON.stringify({ recovery: controller.getSessionLaunchRecovery(failedId), queued: state.clientQueuedSessionMessages[failedId] })).not.toContain("QUJD");

    controller.returnSessionLaunchRecoveryDraft(failedId, { text: "", attachments, delivery: "inline" });

    expect(controller.claimSessionLaunchRecoveryDraft(failedId)).toEqual({ id: `${failedId}:claim-2`, snapshot: { text: "", attachments, delivery: "inline" } });
  });

  it("preserves prompt-resource identity when a claimed creation recovery rolls back and retries", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    let startCount = 0;
    const resourceCalls: { text: string; identity: PromptResourceCommandIdentity }[] = [];
    let genericPromptCalls = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => {
        startCount += 1;
        return startCount === 1 ? Promise.reject(new Error("backend unavailable")) : Promise.resolve(started);
      },
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => { genericPromptCalls += 1; return Promise.resolve({ accepted: true }); },
      runPromptResourceCommand: (_session, text, sentIdentity) => {
        resourceCalls.push({ text, identity: sentIdentity });
        return Promise.resolve({ accepted: true, deliveryFingerprint: "b".repeat(64) });
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/review src", delivery: "inline", promptResourceCommandIdentity: identity });
    const failedId = state.selectedSession?.id;
    if (failedId === undefined) throw new Error("Expected failed pending session");

    expect(controller.claimSessionLaunchRecoveryDraft(failedId)).toEqual({
      id: `${failedId}:claim-1`,
      snapshot: { text: "/review src", delivery: "inline" },
    });

    controller.returnSessionLaunchRecoveryDraft(failedId, { text: "/review src", delivery: "inline" });
    await controller.retrySessionLaunch(failedId);

    expect(resourceCalls).toEqual([{ text: "/review src", identity }]);
    expect(genericPromptCalls).toBe(0);
  });

  it("requires fresh validation before retrying an edited recovery slash command", async () => {
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    let startCount = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => {
        startCount += 1;
        return Promise.reject(new Error("backend unavailable"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/review src", promptResourceCommandIdentity: identity });
    const failedId = state.selectedSession?.id;
    if (failedId === undefined) throw new Error("Expected failed pending session");
    controller.claimSessionLaunchRecoveryDraft(failedId);
    controller.returnSessionLaunchRecoveryDraft(failedId, { text: "/tree", delivery: "inline" });

    expect(controller.getSessionLaunchRecovery(failedId)).toMatchObject({
      stage: "creationFailed",
      retrying: false,
      requiresPromptResourceValidation: true,
    });
    await controller.retrySessionLaunch(failedId);
    expect(startCount).toBe(1);
  });

  it("clears old claimed recovery bookkeeping when a replacement is accepted", async () => {
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

    await controller.launchSession({ text: "Replace this failed launch" });
    const failed = state.selectedSession;
    if (failed === undefined) throw new Error("Expected failed pending session");
    expect(controller.claimSessionLaunchRecoveryDraft(failed.id)).toEqual({ id: `${failed.id}:claim-1`, snapshot: { text: "Replace this failed launch", delivery: "inline" } });
    const replacement = { ...oldSession, id: "pending-replacement", clientPendingStart: true as const, machineId: "local" };
    state = { ...state, selectedSession: replacement, sessions: [replacement, ...state.sessions] };

    controller.acceptSessionLaunchReplacement(failed.id, replacement.id);

    expect(controller.getSessionLaunchRecovery(failed.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[failed.id]).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("Replace this failed launch");
  });

  it("retains an off-workspace creation failure and reconstructs its failed row when selected", async () => {
    const startRequest = deferred<SessionInfo>();
    const otherWorkspace = { ...workspace, id: "workspace-2", path: "/other" };
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

    const launch = controller.launchSession({ text: "Recover after returning" });
    const temporaryId = state.selectedSession?.id;
    const pendingRow = state.selectedSession;
    if (temporaryId === undefined || pendingRow === undefined) throw new Error("Expected a pending session");
    state = {
      ...state,
      selectedWorkspace: otherWorkspace,
      selectedSession: undefined,
      sessions: [],
      clientQueuedSessionMessages: {},
      activity: undefined,
    };

    startRequest.reject(new Error("backend unavailable away from destination"));
    await launch;

    expect(controller.getSessionLaunchRecovery(temporaryId)).toMatchObject({
      stage: "creationFailed",
      retrying: false,
    });
    const merged = controller.mergeCreationFailedSessionStarts(`${workspace.path}/`, [oldSession], "local");
    expect(merged).toEqual([pendingRow, oldSession]);

    state = { ...state, selectedWorkspace: workspace, sessions: merged };
    await controller.selectSession(pendingRow, { updateUrl: false });

    expect(state.selectedSession).toBe(pendingRow);
    expect(state.clientQueuedSessionMessages[temporaryId]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);
    expect(state.activity).toMatchObject({
      sessionId: temporaryId,
      phase: "error",
      label: "Session creation failed",
      detail: "backend unavailable away from destination · 1 queued message kept below",
    });
  });

  it("preserves a current-workspace creation failure across authoritative session refreshes", async () => {
    const retryStart = deferred<SessionInfo>();
    const otherWorkspace = { ...workspace, id: "workspace-2", path: "/other" };
    const startCalls: { cwd: string; machineId: string | undefined; requestId: string | undefined }[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: (cwd, machineId, requestId) => {
        startCalls.push({ cwd, machineId, requestId });
        if (startCalls.length === 1) return Promise.reject(new Error("current workspace unavailable"));
        if (startCalls.length === 2) return Promise.reject(new Error("other workspace unavailable"));
        return retryStart.promise;
      },
      sessions: () => Promise.resolve([oldSession]),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "Recover after refresh" });
    const failedId = state.selectedSession?.id;
    const failedRow = state.selectedSession;
    if (failedId === undefined || failedRow === undefined) throw new Error("Expected a failed pending session");

    state = { ...state, selectedWorkspace: otherWorkspace, selectedSession: undefined, sessions: [], activity: undefined };
    await controller.launchSession({ text: "Keep this recovery elsewhere" });
    const otherFailedId = state.selectedSession?.id;
    if (otherFailedId === undefined) throw new Error("Expected another failed pending session");

    state = {
      ...state,
      selectedWorkspace: { ...workspace, path: `${workspace.path}/` },
      selectedSession: undefined,
      sessions: [oldSession],
      activity: undefined,
    };
    await controller.selectSession(failedRow, { updateUrl: false });
    await controller.refreshCurrentWorkspaceSessions();

    expect(state.sessions.map((session) => session.id)).toEqual([failedId, oldSession.id]);
    expect(state.sessions.map((session) => session.id)).not.toContain(otherFailedId);
    expect(state.selectedSession?.id).toBe(failedId);
    expect(controller.getSessionLaunchRecovery(failedId)).toMatchObject({
      stage: "creationFailed",
      retrying: false,
    });
    expect(state.clientQueuedSessionMessages[failedId]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);

    const retry = controller.retrySessionLaunch(failedId);

    expect(startCalls.at(-1)).toEqual({ cwd: workspace.path, machineId: "local", requestId: failedId });
    expect(controller.getSessionLaunchRecovery(failedId)?.retrying).toBe(true);
    expect(state.clientQueuedSessionMessages[failedId]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);

    retryStart.reject(new Error("stop retry"));
    await retry;
  });

  it("does not retain an off-workspace recovery for a discarded start", async () => {
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

    const launch = controller.launchSession({ text: "Discard this prompt" });
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected a pending session");
    await controller.deleteCachedNewSession(state.selectedSession);
    state = { ...state, selectedWorkspace: { ...workspace, id: "workspace-2", path: "/other" } };
    startRequest.reject(new Error("late failure"));
    await launch;

    expect(controller.getSessionLaunchRecovery(temporaryId)).toBeUndefined();
    expect(controller.mergeCreationFailedSessionStarts(workspace.path, [], "local")).toEqual([]);
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

    await controller.launchSession({ text: "Move this prompt" });
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

    await controller.launchSession({ text: "Recover creation" });
    const temporaryId = state.selectedSession?.id;
    if (temporaryId === undefined) throw new Error("Expected a failed pending session");

    const firstRetry = controller.retrySessionLaunch(temporaryId);
    const secondRetry = controller.retrySessionLaunch(temporaryId);

    expect(startCallCount).toBe(2);
    expect(controller.getSessionLaunchRecovery(temporaryId)?.retrying).toBe(true);
    expect(state.clientQueuedSessionMessages[temporaryId]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
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

    await controller.launchSession({ text: "The accepted prompt" });

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.selectedSession).toMatchObject({ id: started.id });
    expect(state.selectedSession).not.toHaveProperty("browserCachedNew");
    const listedSession = state.sessions.find((session) => session.id === started.id);
    expect(listedSession).toMatchObject({ id: started.id });
    expect(listedSession).not.toHaveProperty("browserCachedNew");
    expect(state.error).toBe("");
  });

  it("reconciles ordinary folder-delivery first prompts against the rewritten canonical body", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const attachments: PromptAttachment[] = [{ kind: "file", mimeType: "text/plain", data: "SGVsbG8=", name: "notes.txt" }];
    const deliveredBody = "Read notes\n\n@.forgerie/attachments/notes.txt";
    let deliveryAttempted = false;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      saveAttachments: () => Promise.resolve([{ path: ".forgerie/attachments/notes.txt", mimeType: "text/plain", size: 5 }]),
      messages: () => Promise.resolve(deliveryAttempted
        ? { messages: [{ role: "user", content: deliveredBody }], start: 0, total: 1 }
        : emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: (_session, text) => {
        deliveryAttempted = true;
        expect(text).toBe(deliveredBody);
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

    await controller.launchSession({ text: "Read notes", attachments, delivery: "folder" });

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.error).toBe("");
  });

  it("refreshes ordinary folder-delivery recovery against the rewritten canonical body", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const attachments: PromptAttachment[] = [{ kind: "file", mimeType: "text/plain", data: "SGVsbG8=", name: "notes.txt" }];
    const deliveredBody = "Read notes\n\n@.forgerie/attachments/notes.txt";
    let exposeDeliveredTranscript = false;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      saveAttachments: () => Promise.resolve([{ path: ".forgerie/attachments/notes.txt", mimeType: "text/plain", size: 5 }]),
      messages: () => exposeDeliveredTranscript
        ? Promise.resolve({ messages: [{ role: "user", content: deliveredBody }], start: 0, total: 1 })
        : Promise.reject(new Error("transcript unavailable")),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      prompt: () => Promise.reject(new Error("response lost")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "Read notes", attachments, delivery: "folder" });
    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");

    exposeDeliveredTranscript = true;
    await controller.refreshSessionLaunchRecovery(started.id);

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
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

    await controller.launchSession({ text: "Retry this prompt" });

    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({
      stage: "promptConfirmedUnsent",
      retrying: false,
    });
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
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

  it("requires revalidation when a prompt-resource retry remains confirmed unsent", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const identity: PromptResourceCommandIdentity = { source: "prompt", name: "review", fingerprint: "a".repeat(64) };
    let resourceCallCount = 0;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve(status(sessionLookupId(session))),
      runPromptResourceCommand: () => {
        resourceCallCount += 1;
        return Promise.reject(new Error("resource changed"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "/review src", promptResourceCommandIdentity: identity });
    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({ stage: "promptConfirmedUnsent", retrying: false });

    await controller.retrySessionLaunch(started.id);

    expect(resourceCallCount).toBe(2);
    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({
      stage: "promptConfirmedUnsent",
      retrying: false,
      requiresPromptResourceValidation: true,
    });
    expect(controller.claimSessionLaunchRecoveryDraft(started.id)?.snapshot).toEqual({ text: "/review src", delivery: "inline" });
  });

  it("clears only its retry activity after a confirmed-unsent prompt retry succeeds", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const otherSession: SessionInfo = { ...oldSession, id: "other-session", path: "/tmp/other-session.jsonl" };
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

    await controller.launchSession({ text: "Retry this prompt" });
    const retry = controller.retrySessionLaunch(started.id);
    expect(state.sessionActivities[started.id]).toMatchObject({ phase: "active", label: "Sending first prompt" });

    const unrelatedActivity = { sessionId: otherSession.id, phase: "active" as const, label: "Indexing files", at: "now" };
    state = {
      ...state,
      sessions: [started, otherSession],
      sessionActivities: { ...state.sessionActivities, [otherSession.id]: unrelatedActivity },
    };
    retryRequest.resolve({ accepted: true });
    await retry;

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBeUndefined();
    expect(state.sessionActivities[otherSession.id]).toBe(unrelatedActivity);
    expect(state.activity).toBeUndefined();
  });

  it("preserves newer unrelated activity when a confirmed-unsent retry succeeds", async () => {
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

    await controller.launchSession({ text: "Retry this prompt" });
    const retry = controller.retrySessionLaunch(started.id);
    const newerActivity = { sessionId: started.id, phase: "active" as const, label: "Running tool", detail: "Still active", at: "later" };
    state = {
      ...state,
      sessionActivities: { ...state.sessionActivities, [started.id]: newerActivity },
      activity: newerActivity,
    };
    retryRequest.resolve({ accepted: true });
    await retry;

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.sessionActivities[started.id]).toBe(newerActivity);
    expect(state.activity).toBe(newerActivity);
  });

  it("transfers ambiguous delivery to the editor only after replacement succeeds", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const replacement = deferred<undefined>();
    const attachment: PromptAttachment = { kind: "image", mimeType: "image/png", data: "QUJD", name: "shot.png" };
    const replacements: PromptEditorTextReplacement[] = [];
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
        replacePromptEditorText: (request) => {
          replacements.push(request);
          return replacement.promise;
        },
      },
    );

    await controller.launchSession({ text: "Inspect before resending", attachments: [attachment], delivery: "inline" });

    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({
      stage: "promptDeliveryAmbiguous",
      retrying: false,
    });
    await controller.retrySessionLaunch(started.id);
    expect(promptCallCount).toBe(1);

    const restore = controller.restoreSessionLaunchPrompt(started.id);

    expect(replacements).toEqual([{
      machineId: "local",
      sessionId: started.id,
      text: "Inspect before resending",
      snapshot: { text: "Inspect before resending", attachments: [attachment], delivery: "inline" },
    }]);
    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]\n\n[1 attachment queued: shot.png]" },
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

    const launch = controller.launchSession({ text: "Ambiguous first prompt" });
    await controller.runShell("!pwd");
    await controller.send("Continue after restore");
    startRequest.resolve(started);
    await launch;

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
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

  it("clears retained tail previews but preserves the delivery error when restore flush fails", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const promptCalls: string[] = [];
    const shellCalls: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(emptyPage),
      status: (session) => Promise.resolve({ ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: (_session, text) => {
        promptCalls.push(text);
        return Promise.reject(new Error("initial delivery timed out"));
      },
      shell: (_session, text) => {
        shellCalls.push(text);
        return Promise.reject(new Error("retained shell failed"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket(), replacePromptEditorText: () => undefined },
    );

    const launch = controller.launchSession({ text: "Ambiguous first prompt" });
    await controller.runShell("!pwd");
    await controller.send("Do not deliver after tail failure");
    startRequest.resolve(started);
    await launch;

    await controller.restoreSessionLaunchPrompt(started.id);

    expect(promptCalls).toEqual(["Ambiguous first prompt"]);
    expect(shellCalls).toEqual(["!pwd"]);
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.error).toContain("retained shell failed");
  });

  it("keeps ambiguous recovery and its queued preview when editor replacement loses the selected-session race", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const replacement = deferred<boolean>();
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
      { api, socket: new FakeSocket(), replacePromptEditorText: () => replacement.promise },
    );

    await controller.launchSession({ text: "Keep this prompt after navigation" });
    const restore = controller.restoreSessionLaunchPrompt(started.id);
    state = { ...state, selectedSession: { ...oldSession, id: "different-session" } };
    replacement.resolve(false);
    await restore;

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);
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

    await controller.launchSession({ text: "Keep this prompt" });

    await expect(controller.restoreSessionLaunchPrompt(started.id)).rejects.toThrow("editor unavailable");

    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
    ]);
  });

  it("marks the cached session persisted when a later refresh proves the initial prompt was accepted", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    let transcriptContainsPrompt = false;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => Promise.resolve(started),
      messages: () => Promise.resolve(transcriptContainsPrompt
        ? { messages: [{ role: "user", content: "Accepted before refresh" }], start: 0, total: 1 }
        : emptyPage),
      status: (session) => Promise.resolve(transcriptContainsPrompt
        ? status(sessionLookupId(session))
        : { ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: () => Promise.reject(new Error("delivery timed out")),
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    await controller.launchSession({ text: "Accepted before refresh" });
    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.selectedSession).toHaveProperty("browserCachedNew", true);

    transcriptContainsPrompt = true;
    await controller.refreshSessionLaunchRecovery(started.id);

    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.selectedSession).toMatchObject({ id: started.id });
    expect(state.selectedSession).not.toHaveProperty("browserCachedNew");
    const listedSession = state.sessions.find((session) => session.id === started.id);
    expect(listedSession).toMatchObject({ id: started.id });
    expect(listedSession).not.toHaveProperty("browserCachedNew");
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

    const launch = controller.launchSession({ text: "Accepted after timeout" });
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

  it("clears retained tail previews but preserves the delivery error when refresh flush fails", async () => {
    const started: SessionInfo = { ...oldSession, id: "started-session", path: "/tmp/started-session.jsonl" };
    const startRequest = deferred<SessionInfo>();
    const promptCalls: string[] = [];
    const shellCalls: string[] = [];
    let transcriptContainsPrompt = false;
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace, sessions: [] };
    const api: typeof defaultApi = {
      ...defaultApi,
      startSession: () => startRequest.promise,
      messages: () => Promise.resolve(transcriptContainsPrompt
        ? { messages: [{ role: "user", content: "Accepted first prompt" }], start: 0, total: 1 }
        : emptyPage),
      status: (session) => Promise.resolve(transcriptContainsPrompt
        ? status(sessionLookupId(session))
        : { ...status(sessionLookupId(session)), isStreaming: true }),
      prompt: (_session, text) => {
        promptCalls.push(text);
        return Promise.reject(new Error("initial delivery timed out"));
      },
      shell: (_session, text) => {
        shellCalls.push(text);
        return Promise.reject(new Error("refresh tail failed"));
      },
    };
    const controller = new SessionController(
      () => state,
      (patch) => { state = { ...state, ...patch }; },
      () => undefined,
      undefined,
      { api, socket: new FakeSocket() },
    );

    const launch = controller.launchSession({ text: "Accepted first prompt" });
    await controller.runShell("!pwd");
    await controller.send("Do not deliver after refresh tail failure");
    startRequest.resolve(started);
    await launch;
    transcriptContainsPrompt = true;

    await controller.refreshSessionLaunchRecovery(started.id);

    expect(promptCalls).toEqual(["Accepted first prompt"]);
    expect(shellCalls).toEqual(["!pwd"]);
    expect(controller.getSessionLaunchRecovery(started.id)).toBeUndefined();
    expect(state.clientQueuedSessionMessages[started.id]).toBeUndefined();
    expect(state.error).toContain("refresh tail failed");
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

    await controller.launchSession({ text: "Refresh without resending" });
    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");

    transcriptIsIdle = true;
    await controller.refreshSessionLaunchRecovery(started.id);

    expect(promptCalls).toEqual(["Refresh without resending"]);
    expect(state.status).toEqual(status(started.id));
    expect(controller.getSessionLaunchRecovery(started.id)).toMatchObject({
      stage: "promptConfirmedUnsent",
      retrying: false,
    });
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
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

    await controller.launchSession({ text: "Do not resend this prompt" });
    reconciliationShouldFail = true;

    await controller.refreshSessionLaunchRecovery(started.id);

    expect(promptCalls).toEqual(["Do not resend this prompt"]);
    expect(controller.getSessionLaunchRecovery(started.id)?.stage).toBe("promptDeliveryAmbiguous");
    expect(state.clientQueuedSessionMessages[started.id]).toEqual([
      { kind: "followUp", text: "[First prompt queued]" },
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

    await controller.launchSession({ text: "Never persist this recovery prompt" });

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

    await controller.launchSession({ text: "Do not retain after archive" });
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

    await controller.launchSession({ text: "Do not retain after delete" });
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

    await controller.launchSession({ text: "Do not retain after cleanup" });
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

    await controller.launchSession({ text: "Keep local recovery" });
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
      { kind: "followUp", text: "[First prompt queued]" },
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

    const launch = controller.launchSession({ text: "First prompt" });
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

    const launch = controller.launchSession({ text: "Build the feature" });
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

interface ControllerWithLaunchRecoveries {
  sessionLaunchRecoveries: unknown;
}

interface QueuedRecoveryRecord {
  queuedSends: { text?: string | undefined; deliveryReceipt?: string | undefined }[];
}

function recordLaunchDeliveryReceipt(controller: SessionController, sessionId: string, receipt: string): void {
  const record = launchRecoveryRecord(controller, sessionId);
  const queued = record.queuedSends[0];
  if (queued === undefined) throw new Error("Expected launch recovery queued send");
  queued.deliveryReceipt = receipt;
}

function queuedRecoveryTexts(controller: SessionController, sessionId: string): string[] {
  return launchRecoveryRecord(controller, sessionId).queuedSends.map((queued) => queued.text ?? "");
}

function launchRecoveryRecord(controller: SessionController, sessionId: string): QueuedRecoveryRecord {
  const source: object = controller;
  if (!hasLaunchRecoveries(source)) throw new Error("Expected launch recovery map");
  const recoveries = source.sessionLaunchRecoveries;
  if (!isRecoveryMap(recoveries)) throw new Error("Expected launch recovery map");
  const record = recoveries.get(sessionId);
  if (!isQueuedRecoveryRecord(record)) throw new Error("Expected launch recovery queued sends");
  return record;
}

function hasLaunchRecoveries(value: object): value is ControllerWithLaunchRecoveries {
  return "sessionLaunchRecoveries" in value;
}

function isRecoveryMap(value: unknown): value is Map<string, unknown> {
  return value instanceof Map;
}

function isQueuedRecoveryRecord(value: unknown): value is QueuedRecoveryRecord {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "queuedSends"));
}
