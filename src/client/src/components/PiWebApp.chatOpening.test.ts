// @vitest-environment happy-dom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { textMessage } from "../chatMessages";
import { selectedChatFailed, selectedChatFreshReadable, selectedChatLiveReady, selectedChatLoading, selectedChatTarget } from "../selectedChatLoad";
import { SessionUnreadController } from "../sessionUnread";
import { PiWebApp } from "./PiWebApp";
import type { ChatView } from "./ChatView";
import type { PromptEditor } from "./PromptEditor";
import type { AppNavigationPanel } from "./appShell/AppNavigationPanel";
import type { AppContextBar } from "./appShell/AppContextBar";
import type { SessionInboxPanel } from "./SessionInboxPanel";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [], start: 0, total: 0 }), { status: 200, headers: { "content-type": "application/json" } }))));
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp chat opening", () => {
  it("shows a same-workspace target shell and editable target composer before selection joins", async () => {
    const app = new PiWebApp();
    const previous = session("previous", "/repo", "Previous session");
    const target = session("target", "/repo", "Target session");
    setAppState(app, appState({ selectedSession: previous, sessions: [previous, target], inboxSessions: [previous, target], messages: [textMessage("assistant", "previous transcript must not show")] }));
    resolveAppUpdateComplete(app);
    const selecting = deferred<undefined>();
    const previewing = deferred<{ messages: ReturnType<typeof textMessage>[]; messagePageStart: number; messagePageEnd: number; messagePageTotal: number }>();
    const controller = appSessionController(app);
    vi.spyOn(controller, "previewSession").mockReturnValue(previewing.promise);
    const sendToSession = vi.spyOn(controller, "sendToSession").mockResolvedValue(undefined);
    const selectSession = vi.spyOn(controller, "selectSession").mockImplementation(async (selected) => {
      appSetState(app, { selectedSession: selected, selectedChatLoad: selectedChatLoading(selectedChatTarget("local", selected)), messages: [], messagePageStart: 0, messagePageEnd: 0, messagePageTotal: 0 });
      await selecting.promise;
    });
    const frames = installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, target.id);
    await Promise.resolve();
    renderApp(app, container);

    const chat = requiredElement(container.querySelector<ChatView>("chat-view"), "opening chat view");
    await chat.updateComplete;
    expect(chat.sessionId).toBe(target.id);
    expect(chat.messages).toEqual([]);
    expect(chat.shadowRoot?.textContent).toContain("Opening Target session");
    expect(chat.shadowRoot?.textContent).not.toContain("previous transcript must not show");
    const editor = requiredElement(container.querySelector<PromptEditor>("prompt-editor"), "opening target prompt editor");
    await editor.updateComplete;
    expect(editor.sessionId).toBe(target.id);
    expect(editor.cwd).toBe(target.cwd);
    expect(editor.disabled).toBe(false);
    expect(editor.submissionAvailable).toBe(true);
    expect(editor.runtimeControlsAvailable).toBe(false);
    expect(document.activeElement?.localName).not.toBe("prompt-editor");
    void editor.onSend?.("queued for target");
    expect(sendToSession).toHaveBeenCalledWith(target, "local", "queued for target", undefined, undefined, undefined);
    expect(selectSession).not.toHaveBeenCalled();

    previewing.resolve({ messages: [textMessage("assistant", "target preview")], messagePageStart: 9, messagePageEnd: 10, messagePageTotal: 10 });
    await app.updateComplete;
    renderApp(app, container);
    expect(requiredElement(container.querySelector<ChatView>("chat-view"), "preview chat view").messages).toEqual([textMessage("assistant", "target preview")]);

    frames.releaseAll();
    await vi.waitFor(() => { expect(selectSession).toHaveBeenCalledWith(target); });
  });

  it("opens an unread inbox session without a reading-target delay", async () => {
    const app = new PiWebApp();
    const previous = session("previous", "/repo", "Previous session");
    const target = session("target", "/repo", "Target session");
    setAppState(app, appState({ selectedSession: previous, sessions: [previous, target], inboxSessions: [previous, target] }));
    markSessionUnread(app, target);
    resolveAppUpdateComplete(app);
    const joining = deferred<undefined>();
    const selectSession = vi.spyOn(appSessionController(app), "selectSession").mockImplementation(async (selected) => {
      appSetState(app, {
        selectedSession: selected,
        selectedChatLoad: selectedChatFreshReadable(selectedChatTarget("local", selected)),
        messages: [textMessage("user", "question"), textMessage("assistant", "answer")],
        messagePageStart: 0,
        messagePageEnd: 2,
        messagePageTotal: 2,
      });
      await joining.promise;
    });
    const frames = installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, target.id);
    await Promise.resolve();
    renderApp(app, container);

    const chat = requiredElement(container.querySelector<ChatView>("chat-view"), "opening unread chat view");
    await chat.updateComplete;
    expect(chat.sessionId).toBe(target.id);
    expect("initialReadingTarget" in chat).toBe(false);

    frames.releaseAll();
    await vi.waitFor(() => { expect(selectSession).toHaveBeenCalledWith(target); });
    renderApp(app, container);
    const selectedChat = requiredElement(container.querySelector<ChatView>("chat-view"), "selected unread chat view");
    await selectedChat.updateComplete;
    expect("initialReadingTarget" in selectedChat).toBe(false);
  });

  it("shows a cross-workspace target shell while the normal workspace cascade is still resolving", async () => {
    const app = new PiWebApp();
    const previousWorkspace = workspace("workspace-a", "project-a", "/repo-a", "A");
    const targetWorkspace = workspace("workspace-b", "project-a", "/repo-b", "B");
    const previous = session("previous", previousWorkspace.path, "Previous session");
    const target = session("target", targetWorkspace.path, "Target session");
    setAppState(app, appState({
      selectedWorkspace: previousWorkspace,
      selectedSession: previous,
      sessions: [previous],
      inboxSessions: [previous, target],
      workspacesByProjectId: { "project-a": [previousWorkspace, targetWorkspace] },
      messages: [textMessage("assistant", "previous cross-workspace transcript")],
    }));
    resolveAppUpdateComplete(app);
    const selectingWorkspace = deferred<undefined>();
    const selectWorkspace = vi.spyOn(appWorkspaceController(app), "selectWorkspace").mockImplementation(async () => {
      await selectingWorkspace.promise;
    });
    const frames = installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, target.id);
    await Promise.resolve();
    renderApp(app, container);

    const chat = requiredElement(container.querySelector<ChatView>("chat-view"), "opening chat view");
    await chat.updateComplete;
    expect(chat.sessionId).toBe(target.id);
    expect(chat.shadowRoot?.textContent).toContain("Opening Target session");
    expect(chat.shadowRoot?.textContent).not.toContain("previous cross-workspace transcript");
    const editor = requiredElement(container.querySelector<PromptEditor>("prompt-editor"), "cross-workspace opening prompt editor");
    await editor.updateComplete;
    expect(editor.sessionId).toBe(target.id);
    expect(editor.cwd).toBe(target.cwd);
    expect(editor.disabled).toBe(false);
    expect(editor.runtimeControlsAvailable).toBe(false);
    expect(selectWorkspace).not.toHaveBeenCalled();

    frames.releaseAll();
    await vi.waitFor(() => { expect(selectWorkspace).toHaveBeenCalledWith(targetWorkspace, expect.objectContaining({ sessionId: target.id })); });
  });

  it("keeps a selected loading chat readable with an editable composer", async () => {
    const app = new PiWebApp();
    const selected = session("selected", "/repo", "Selected session");
    const state = appState({ selectedSession: selected, sessions: [selected], inboxSessions: [selected], messages: [textMessage("assistant", "readable while opening")] });
    setAppState(app, { ...state, mainView: "chat", selectedChatLoad: selectedChatFreshReadable(selectedChatTarget("local", selected)) });

    const container = renderApp(app);
    const chat = requiredElement(container.querySelector<ChatView>("chat-view"), "chat view");
    const editor = requiredElement(container.querySelector<PromptEditor>("prompt-editor"), "prompt editor");
    await chat.updateComplete;
    await editor.updateComplete;

    expect(chat.messages).toEqual([textMessage("assistant", "readable while opening")]);
    expect(editor.disabled).toBe(false);
    expect(editor.runtimeControlsAvailable).toBe(false);
  });

  it("keeps the composer New session handler stable across transcript renders", () => {
    const app = new PiWebApp();
    const selected = session("selected", "/repo", "Selected session");
    const state = appState({ selectedSession: selected, sessions: [selected], inboxSessions: [selected] });
    setAppState(app, { ...state, mainView: "chat", selectedChatLoad: selectedChatLiveReady(selectedChatTarget("local", selected)) });
    const container = renderApp(app);
    const editor = requiredElement(container.querySelector<PromptEditor>("prompt-editor"), "prompt editor");
    const firstHandler = editor.capabilities.newSession?.onNewSession;

    appSetState(app, { messages: [textMessage("assistant", "streamed update")] });
    renderApp(app, container);

    expect(requiredElement(container.querySelector<PromptEditor>("prompt-editor"), "updated prompt editor").capabilities.newSession?.onNewSession).toBe(firstHandler);
  });

  it("gates runtime-dependent app handlers until the selected chat is live-ready", async () => {
    const app = new PiWebApp();
    const selected = session("selected", "/repo", "Selected session");
    const state = appState({ selectedSession: selected, sessions: [selected], inboxSessions: [selected] });
    setAppState(app, { ...state, mainView: "chat", selectedChatLoad: selectedChatFreshReadable(selectedChatTarget("local", selected)) });
    const controller = appSessionController(app);
    const send = vi.spyOn(controller, "send").mockResolvedValue(undefined);
    const stop = vi.spyOn(controller, "stopActiveWork").mockResolvedValue(undefined);
    const listModels = vi.spyOn(controller, "listModels").mockResolvedValue([]);
    const listThinkingLevels = vi.spyOn(controller, "listThinkingLevels").mockResolvedValue([]);

    sendPrompt(app, "hello");
    stopActiveWork(app);
    await openModelDialog(app);
    await openThinkingDialog(app);

    expect(send).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
    expect(listModels).not.toHaveBeenCalled();
    expect(listThinkingLevels).not.toHaveBeenCalled();

    setAppState(app, { ...state, mainView: "chat", selectedChatLoad: selectedChatLiveReady(selectedChatTarget("local", selected)) });
    sendPrompt(app, "hello");
    stopActiveWork(app);
    await openModelDialog(app);
    await openThinkingDialog(app);

    expect(send).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledOnce();
    expect(listModels).toHaveBeenCalledOnce();
    expect(listThinkingLevels).toHaveBeenCalledOnce();
  });

  it("keeps rapid A then B selection on B and never flashes A after B is current", async () => {
    const app = new PiWebApp();
    const previous = session("previous", "/repo", "Previous session");
    const alpha = session("alpha", "/repo", "Alpha session");
    const beta = session("beta", "/repo", "Beta session");
    setAppState(app, appState({ selectedSession: previous, sessions: [previous, alpha, beta], inboxSessions: [previous, alpha, beta], messages: [textMessage("assistant", "previous transcript")] }));
    markSessionUnread(app, alpha);
    resolveAppUpdateComplete(app);
    const alphaPreview = deferred<{ messages: ReturnType<typeof textMessage>[]; messagePageStart: number; messagePageEnd: number; messagePageTotal: number }>();
    const betaPreview = deferred<{ messages: ReturnType<typeof textMessage>[]; messagePageStart: number; messagePageEnd: number; messagePageTotal: number }>();
    const controller = appSessionController(app);
    vi.spyOn(controller, "previewSession").mockImplementation((selected) => selected.id === alpha.id ? alphaPreview.promise : betaPreview.promise);
    vi.spyOn(controller, "selectSession").mockImplementation(() => new Promise(() => undefined));
    const recoverReadinessSends = vi.spyOn(controller, "recoverReadinessSends");
    const frames = installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, alpha.id);
    await clickInboxRow(container, beta.id);
    frames.releaseAll();
    await Promise.resolve();
    renderApp(app, container);
    await vi.waitFor(() => { expect(recoverReadinessSends).toHaveBeenCalledWith(alpha, "local"); });

    const chat = requiredElement(container.querySelector<ChatView>("chat-view"), "opening chat view");
    await chat.updateComplete;
    expect(chat.sessionId).toBe(beta.id);
    expect(chat.shadowRoot?.textContent).toContain("Opening Beta session");
    expect(chat.shadowRoot?.textContent).not.toContain("Opening Alpha session");
    expect(chat.shadowRoot?.textContent).not.toContain("previous transcript");

    betaPreview.resolve({ messages: [textMessage("assistant", "beta preview")], messagePageStart: 0, messagePageEnd: 1, messagePageTotal: 1 });
    await Promise.resolve();
    alphaPreview.resolve({ messages: [textMessage("assistant", "stale alpha preview")], messagePageStart: 0, messagePageEnd: 1, messagePageTotal: 1 });
    await Promise.resolve();
    renderApp(app, container);
    const latest = requiredElement(container.querySelector<ChatView>("chat-view"), "latest opening chat view");
    expect(latest.sessionId).toBe(beta.id);
    expect(latest.messages).toEqual([textMessage("assistant", "beta preview")]);
  });


  it("preserves a queued send when an older same-target opening is superseded", async () => {
    const app = new PiWebApp();
    const target = session("target", "/repo", "Target session");
    setAppState(app, {
      ...appState({ selectedSession: target, sessions: [target], inboxSessions: [target] }),
      selectedChatLoad: selectedChatLoading(selectedChatTarget("local", target)),
    });
    const controller = appSessionController(app);

    await controller.sendToSession(target, "local", "keep queued for target");
    const recover: unknown = Reflect.get(app, "recoverSupersededOpeningSends");
    if (typeof recover !== "function") throw new Error("recoverSupersededOpeningSends unavailable");
    Reflect.apply(recover, app, ["local", target]);

    expect(appStateValue(app).clientQueuedSessionMessages[target.id]).toEqual([{ kind: "followUp", text: "keep queued for target" }]);
  });

  it("clears an old inbox intent after a non-inbox navigation supersedes it", async () => {
    const app = new PiWebApp();
    const previousWorkspace = workspace("workspace-a", "project-a", "/repo-a", "A");
    const targetWorkspace = workspace("workspace-b", "project-a", "/repo-b", "B");
    const previous = session("previous", previousWorkspace.path, "Previous session");
    const target = session("target", targetWorkspace.path, "Target session");
    setAppState(app, appState({
      selectedWorkspace: previousWorkspace,
      selectedSession: previous,
      sessions: [previous],
      inboxSessions: [previous, target],
      workspacesByProjectId: { "project-a": [previousWorkspace, targetWorkspace] },
    }));
    resolveAppUpdateComplete(app);
    const selectingWorkspace = deferred<undefined>();
    const selectWorkspace = vi.spyOn(appWorkspaceController(app), "selectWorkspace").mockImplementation(async () => {
      await selectingWorkspace.promise;
    });
    const frames = installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, target.id);
    await Promise.resolve();
    renderApp(app, container);
    expect(requiredElement(container.querySelector<ChatView>("chat-view"), "opening chat view").sessionId).toBe(target.id);

    frames.releaseAll();
    await vi.waitFor(() => { expect(selectWorkspace).toHaveBeenCalledOnce(); });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    const navigatingElsewhere = selectNavigationItem(app, "projects", "chat", () => Promise.resolve(undefined));
    selectingWorkspace.resolve(undefined);
    await navigatingElsewhere;
    await Promise.resolve();
    renderApp(app, container);

    expect(container.querySelector<ChatView>("chat-view")?.sessionId).not.toBe(target.id);
  });

  it("does not offer chat-join retry for a dead client-pending start row", async () => {
    const app = new PiWebApp();
    const pending = { ...session("pending-session-1", "/repo", "Pending session"), persisted: false, clientPendingStart: true, machineId: "local" };
    setAppState(app, {
      ...appState({ selectedSession: pending, sessions: [pending], inboxSessions: [pending] }),
      mainView: "chat",
      selectedChatLoad: selectedChatFailed(selectedChatTarget("local", pending), "absent", "Failed to start session: creation failed"),
      error: "Failed to start session: creation failed",
    });

    const container = renderApp(app);
    const chat = requiredElement(container.querySelector<ChatView>("chat-view"), "failed pending chat view");
    await chat.updateComplete;

    expect(chat.shadowRoot?.querySelector("[role='alert']")?.textContent ?? "").toContain("creation failed");
    expect(chat.shadowRoot?.querySelector(".chat-load-retry")).toBeNull();
    expect(container.querySelector(".error")).toBeNull();
  });

  it("clears stale global errors when opening a chat and suppresses duplicate selected-chat failures", async () => {
    const app = new PiWebApp();
    const selected = session("selected", "/repo", "Selected session");
    const target = session("target", "/repo", "Target session");
    setAppState(app, { ...appState({ selectedSession: selected, sessions: [selected, target], inboxSessions: [selected, target] }), error: "stale error" });
    resolveAppUpdateComplete(app);
    vi.spyOn(appSessionController(app), "selectSession").mockImplementation(() => new Promise(() => undefined));
    installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, target.id);
    await Promise.resolve();
    renderApp(app, container);

    expect(container.querySelector(".error")?.textContent ?? "").not.toContain("stale error");

    const failedApp = new PiWebApp();
    setAppState(failedApp, {
      ...appState({ selectedSession: selected, sessions: [selected], inboxSessions: [selected] }),
      mainView: "chat",
      selectedChatLoad: selectedChatFailed(selectedChatTarget("local", selected), "fresh", "join failed"),
      messages: [textMessage("assistant", "readable before failure")],
      messagePageTotal: 1,
      error: "join failed",
    });
    const failedContainer = renderApp(failedApp);
    const chat = requiredElement(failedContainer.querySelector<ChatView>("chat-view"), "failed chat view");
    await chat.updateComplete;

    expect(chat.shadowRoot?.querySelector("[role='alert']")?.textContent ?? "").toContain("join failed");
    expect(failedContainer.querySelector(".error")).toBeNull();
  });

  it("shows the navigation target in the context bar while an inbox intent is visible", async () => {
    const app = new PiWebApp();
    forceContextBarVisible(app);
    const previousProject = project("project-a", "Old Project");
    const targetProject = project("project-b", "Target Project");
    const previousWorkspace = workspace("workspace-a", previousProject.id, "/repo-a", "Old Workspace");
    const targetWorkspace = workspace("workspace-b", targetProject.id, "/repo-b", "Target Workspace");
    const previous = session("previous", previousWorkspace.path, "Previous session");
    const target = session("target", targetWorkspace.path, "Target session");
    setAppState(app, appState({
      projects: [previousProject, targetProject],
      selectedProject: previousProject,
      selectedWorkspace: previousWorkspace,
      selectedSession: previous,
      sessions: [previous],
      inboxSessions: [previous, target],
      workspacesByProjectId: { [previousProject.id]: [previousWorkspace], [targetProject.id]: [targetWorkspace] },
    }));
    resolveAppUpdateComplete(app);
    vi.spyOn(appWorkspaceController(app), "selectWorkspace").mockImplementation(() => new Promise(() => undefined));
    installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, target.id);
    await Promise.resolve();
    renderApp(app, container);
    const contextText = await contextBarText(container);

    expect(contextText).toContain("Target session");
    expect(contextText).toContain("Target Project");
    expect(contextText).toContain("Target Workspace");
    expect(contextText).not.toContain("Old Workspace");

    const unknown = session("unknown", "/unknown", "Unknown session");
    setAppState(app, appState({
      projects: [previousProject],
      selectedProject: previousProject,
      selectedWorkspace: previousWorkspace,
      selectedSession: previous,
      sessions: [previous],
      inboxSessions: [previous, unknown],
      workspacesByProjectId: { [previousProject.id]: [previousWorkspace] },
    }));
    renderApp(app, container);
    await clickInboxRow(container, unknown.id);
    await Promise.resolve();
    renderApp(app, container);
    const unknownContextText = await contextBarText(container);

    expect(unknownContextText).toContain("Unknown session");
    expect(unknownContextText).toContain("No project");
    expect(unknownContextText).toContain("No workspace");
    expect(unknownContextText).not.toContain("Old Project");
    expect(unknownContextText).not.toContain("Old Workspace");
  });

  it("accepts sends while still checking selected live-ready identity for stop", () => {
    const app = new PiWebApp();
    const selected = session("selected", "/repo", "Selected session");
    const state = appState({ selectedSession: selected, sessions: [selected], inboxSessions: [selected] });
    setAppState(app, { ...state, mainView: "chat", selectedChatLoad: selectedChatLiveReady({ machineId: "local", sessionId: selected.id, cwd: "/other" }) });
    const controller = appSessionController(app);
    const send = vi.spyOn(controller, "send").mockResolvedValue(undefined);
    const stop = vi.spyOn(controller, "stopActiveWork").mockResolvedValue(undefined);

    sendPrompt(app, "hello");
    stopActiveWork(app);

    expect(send).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();
  });

  it("handles auth slash commands before runtime send gating", () => {
    const app = new PiWebApp();
    const selected = session("selected", "/repo", "Selected session");
    const state = appState({ selectedSession: selected, sessions: [selected], inboxSessions: [selected] });
    setAppState(app, { ...state, mainView: "chat", selectedChatLoad: selectedChatFreshReadable(selectedChatTarget("local", selected)) });
    const send = vi.spyOn(appSessionController(app), "send").mockResolvedValue(undefined);

    sendPrompt(app, "/login");
    sendPrompt(app, "hello");

    expect(appStateValue(app).authDialog).toEqual({ step: "method" });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("hello", undefined, undefined, undefined);
  });

  it("uses first message when a session name is empty", async () => {
    const app = new PiWebApp();
    const selected = { ...session("selected", "/repo", "First prompt label"), name: "   " };
    setAppState(app, { ...appState({ selectedSession: selected, sessions: [selected], inboxSessions: [selected] }), mainView: "chat" });

    const container = renderApp(app);
    const chat = requiredElement(container.querySelector<ChatView>("chat-view"), "chat view");
    await chat.updateComplete;

    expect(chat.sessionTitle).toBe("First prompt label");
  });

  it("starts warm same-workspace selection after the shell paint boundary without an extra frame wait", async () => {
    const app = new PiWebApp();
    const previous = session("previous", "/repo", "Previous session");
    const target = session("target", "/repo", "Target session");
    setAppState(app, appState({ selectedSession: previous, sessions: [previous, target], inboxSessions: [previous, target] }));
    resolveAppUpdateComplete(app);
    const selectSession = vi.spyOn(appSessionController(app), "selectSession").mockResolvedValue(undefined);
    const frames = installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, target.id);
    await Promise.resolve();
    expect(selectSession).not.toHaveBeenCalled();

    frames.releaseAll();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await vi.waitFor(() => { expect(selectSession).toHaveBeenCalledWith(target); });
  });

  it("hands a synchronous selected-session commit to the selected readable shell before join completes", async () => {
    const app = new PiWebApp();
    const previous = session("previous", "/repo", "Previous session");
    const target = session("target", "/repo", "Target session");
    setAppState(app, appState({ selectedSession: previous, sessions: [previous, target], inboxSessions: [previous, target] }));
    resolveAppUpdateComplete(app);
    const joining = deferred<undefined>();
    vi.spyOn(appSessionController(app), "selectSession").mockImplementation(async (selected) => {
      appSetState(app, {
        selectedSession: selected,
        selectedChatLoad: selectedChatLoading(selectedChatTarget("local", selected), "fresh"),
        messages: [textMessage("assistant", "target readable before join")],
        messagePageStart: 0,
        messagePageEnd: 1,
        messagePageTotal: 1,
      });
      await joining.promise;
    });
    const frames = installHeldFrames();
    const container = renderApp(app);

    await clickInboxRow(container, target.id);
    frames.releaseAll();
    await vi.waitFor(() => {
      expect(appStateValue(app).selectedSession?.id).toBe(target.id);
    });
    renderApp(app, container);
    const chat = requiredElement(container.querySelector<ChatView>("chat-view"), "selected loading chat view");
    const editor = requiredElement(container.querySelector<PromptEditor>("prompt-editor"), "prompt editor");
    await chat.updateComplete;
    await editor.updateComplete;

    expect(chat.sessionId).toBe(target.id);
    expect(chat.messages).toEqual([textMessage("assistant", "target readable before join")]);
    expect(chat.shadowRoot?.textContent).toContain("Updating transcript");
    expect(editor.disabled).toBe(false);
    expect(editor.runtimeControlsAvailable).toBe(false);
    joining.resolve(undefined);
  });
});

function appState(options: {
  projects?: readonly Project[];
  selectedProject?: Project;
  selectedWorkspace?: Workspace;
  selectedSession?: SessionInfo;
  sessions: readonly SessionInfo[];
  inboxSessions: readonly SessionInfo[];
  workspacesByProjectId?: Record<string, Workspace[]>;
  messages?: AppState["messages"];
}): AppState {
  const selectedWorkspace = options.selectedWorkspace ?? workspace("workspace-main", "project-a", "/repo", "Main");
  const selectedProject = options.selectedProject ?? project(selectedWorkspace.projectId, "Project A");
  const projects = options.projects ?? [selectedProject];
  return {
    ...initialAppState(),
    machines: [{ id: "local", name: "Local", kind: "local", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" }],
    selectedMachine: { id: "local", name: "Local", kind: "local", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" },
    projects: [...projects],
    selectedProject,
    workspaces: [selectedWorkspace],
    workspacesByProjectId: options.workspacesByProjectId ?? { [selectedWorkspace.projectId]: [selectedWorkspace] },
    selectedWorkspace,
    selectedSession: options.selectedSession,
    sessions: [...options.sessions],
    globalSessions: { machineId: "local", status: "fresh", sessions: [...options.inboxSessions], statuses: {}, activities: {} },
    mainView: "navigation",
    messages: options.messages ?? [],
    selectedChatLoad: options.selectedSession === undefined ? initialAppState().selectedChatLoad : selectedChatLoading(selectedChatTarget("local", options.selectedSession)),
  };
}

function project(id: string, name: string): Project {
  return { id, path: `/projects/${id}`, name, createdAt: "2026-08-10T00:00:00.000Z" };
}

function workspace(id: string, projectId: string, path: string, label: string): Workspace {
  return { id, projectId, path, label, isMain: label === "Main", isGitRepo: true, isGitWorktree: label !== "Main", effectiveConfig: {} };
}

function session(id: string, cwd: string, title: string): SessionInfo {
  return {
    id,
    cwd,
    path: `${cwd}/${id}.jsonl`,
    created: "2026-08-10T00:00:00.000Z",
    modified: "2026-08-10T00:00:00.000Z",
    messageCount: 1,
    firstMessage: title,
  };
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function markSessionUnread(app: PiWebApp, target: SessionInfo, completionOrder = 1): void {
  const controller: unknown = Reflect.get(app, "sessionUnread");
  if (!(controller instanceof SessionUnreadController)) throw new Error("Session unread controller unavailable");
  controller.applyEvent("local", {
    type: "sessions.unread",
    catalogId: "catalog-test",
    catalogRevision: completionOrder,
    sessionId: target.id,
    cwd: target.cwd,
    unread: {
      sessionId: target.id,
      cwd: target.cwd,
      completionOrder,
      completedAt: `2026-08-10T01:00:0${String(completionOrder)}.000Z`,
    },
  });
}

function appStateValue(app: PiWebApp): AppState {
  const state: unknown = Reflect.get(app, "state");
  if (!isAppState(state)) throw new Error("PiWebApp state unavailable");
  return state;
}

function isAppState(value: unknown): value is AppState {
  return typeof value === "object" && value !== null && "mainView" in value;
}


function resolveAppUpdateComplete(app: PiWebApp): void {
  Object.defineProperty(app, "updateComplete", { configurable: true, value: Promise.resolve(true) });
}

function appSetState(app: PiWebApp, patch: Partial<AppState>): void {
  const method: unknown = Reflect.get(app, "setState");
  if (typeof method !== "function") throw new Error("PiWebApp.setState is unavailable");
  Reflect.apply(method, app, [patch]);
}

interface AppSessionControllerForTest {
  previewSession: (session: SessionInfo, machineId: string) => Promise<{ messages: ReturnType<typeof textMessage>[]; messagePageStart: number; messagePageEnd: number; messagePageTotal: number }>;
  selectSession: (session: SessionInfo, options?: { updateUrl?: boolean }) => Promise<void>;
  sendToSession: (session: SessionInfo, machineId: string, text: string, streamingBehavior?: "steer" | "followUp", attachments?: never[], delivery?: "inline" | "workspace") => Promise<void>;
  recoverReadinessSends: (session: SessionInfo, machineId: string) => unknown;
  send: (text: string) => Promise<void>;
  stopActiveWork: () => Promise<void>;
  listModels: () => Promise<readonly unknown[]>;
  listThinkingLevels: () => Promise<readonly unknown[]>;
}

function appSessionController(app: PiWebApp): AppSessionControllerForTest {
  const controller: unknown = Reflect.get(app, "sessions");
  if (!isAppSessionController(controller)) throw new Error("Session controller unavailable");
  return controller;
}

function isAppSessionController(value: unknown): value is AppSessionControllerForTest {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "previewSession") === "function"
    && typeof Reflect.get(value, "selectSession") === "function"
    && typeof Reflect.get(value, "sendToSession") === "function"
    && typeof Reflect.get(value, "recoverReadinessSends") === "function"
    && typeof Reflect.get(value, "send") === "function"
    && typeof Reflect.get(value, "stopActiveWork") === "function"
    && typeof Reflect.get(value, "listModels") === "function"
    && typeof Reflect.get(value, "listThinkingLevels") === "function";
}

function sendPrompt(app: PiWebApp, text: string): void {
  const method: unknown = Reflect.get(app, "sendPrompt");
  if (typeof method !== "function") throw new Error("sendPrompt unavailable");
  Reflect.apply(method, app, [text]);
}

function stopActiveWork(app: PiWebApp): void {
  const method: unknown = Reflect.get(app, "handleStopActiveWork");
  if (typeof method !== "function") throw new Error("handleStopActiveWork unavailable");
  Reflect.apply(method, app, []);
}

function openModelDialog(app: PiWebApp): Promise<void> {
  return invokeAsyncAppMethod(app, "openModelDialog");
}

function openThinkingDialog(app: PiWebApp): Promise<void> {
  return invokeAsyncAppMethod(app, "openThinkingDialog");
}

function selectNavigationItem(app: PiWebApp, section: "projects", target: "chat", action: () => Promise<void>): Promise<void> {
  const method: unknown = Reflect.get(app, "selectNavigationItem");
  if (typeof method !== "function") throw new Error("selectNavigationItem unavailable");
  const result: unknown = Reflect.apply(method, app, [section, target, action]);
  if (!isPromise(result)) throw new Error("selectNavigationItem did not return a promise");
  return result;
}

function invokeAsyncAppMethod(app: PiWebApp, name: string): Promise<void> {
  const method: unknown = Reflect.get(app, name);
  if (typeof method !== "function") throw new Error(`${name} unavailable`);
  const result: unknown = Reflect.apply(method, app, []);
  if (!isPromise(result)) throw new Error(`${name} did not return a promise`);
  return result;
}

interface WorkspaceControllerForTest {
  selectWorkspace: (workspace: Workspace, target?: { sessionId?: string }) => Promise<void>;
}

function appWorkspaceController(app: PiWebApp): WorkspaceControllerForTest {
  const controller: unknown = Reflect.get(app, "workspaces");
  if (!isWorkspaceController(controller)) throw new Error("Workspace controller unavailable");
  return controller;
}

function isWorkspaceController(value: unknown): value is WorkspaceControllerForTest {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "selectWorkspace") === "function";
}

function isPromise(value: unknown): value is Promise<void> {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "then") === "function";
}

function renderApp(app: PiWebApp, container = appendContainer()): HTMLDivElement {
  render(app.render(), container);
  return container;
}

function forceContextBarVisible(app: PiWebApp): void {
  const appShell: unknown = Reflect.get(app, "appShell");
  if (typeof appShell !== "object" || appShell === null) throw new Error("App shell unavailable");
  Object.defineProperty(appShell, "isChromeSummoned", { configurable: true, get: () => false });
  Object.defineProperty(appShell, "isMobileNavigationLayout", { configurable: true, get: () => true });
  Reflect.set(appShell, "layoutMode", "overlay");
}

async function contextBarText(container: ParentNode): Promise<string> {
  const bar = requiredElement(container.querySelector<AppContextBar>("app-context-bar"), "context bar");
  await bar.updateComplete;
  return bar.shadowRoot?.textContent ?? "";
}

function appendContainer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

async function clickInboxRow(container: ParentNode, sessionId: string): Promise<void> {
  const navigation = requiredElement(container.querySelector<AppNavigationPanel>("app-navigation-panel"), "navigation panel");
  await navigation.updateComplete;
  const inbox = requiredElement(navigation.shadowRoot?.querySelector<SessionInboxPanel>("session-inbox-panel"), "session inbox panel");
  await inbox.updateComplete;
  const row = requiredElement(inbox.shadowRoot?.querySelector<HTMLElement>(`[data-session="${sessionId}"]`), `${sessionId} row`);
  row.click();
}

function installHeldFrames(): { releaseNext: () => void; releaseAll: () => void } {
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  return {
    releaseNext: () => {
      const callback = callbacks.shift();
      if (callback === undefined) throw new Error("No animation frame is waiting");
      callback(performance.now());
    },
    releaseAll: () => {
      if (callbacks.length === 0) throw new Error("No animation frame is waiting");
      while (callbacks.length > 0) callbacks.shift()?.(performance.now());
    },
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
