// @vitest-environment happy-dom

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, Project, SessionInfo, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { InMemoryNewSessionDestinationCatalog, completeNewSessionDestination, type NewSessionLaunchIntent } from "../newSessionComposer";
import { PiWebApp } from "./PiWebApp";
import type { AppNavigationPanel } from "./appShell/AppNavigationPanel";
import type { NewSessionComposer } from "./NewSessionComposer";
import type { ChatView } from "./ChatView";
import type { WorkspacePanel } from "./WorkspacePanel";
import { NEW_SESSION_LABEL } from "./shared";
import type { SessionLaunchRecovery } from "../controllers/sessionController";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("PiWebApp New session composer root", () => {
  it("opens with the selected session's exact loaded machine, project, and sibling workspace", () => {
    const app = new PiWebApp();
    const selectedSession = session("selected", siblingWorkspace.path);
    setAppState(app, {
      machines: [localMachine],
      selectedMachine: localMachine,
      projects: [project],
      selectedProject: project,
      selectedWorkspace: mainWorkspace,
      workspaces: [mainWorkspace, siblingWorkspace],
      workspacesByProjectId: { [project.id]: [mainWorkspace, siblingWorkspace] },
      selectedSession,
      sessions: [selectedSession],
      mainView: "core:workspace.files",
    });

    invoke(app, "openNewSessionComposer");

    expect(composerRequest(app)).toMatchObject({
      kind: "open",
      initialDestination: completeNewSessionDestination(localMachine, project, siblingWorkspace),
    });
    expect(appState(app).mainView).toBe("core:workspace.files");
    expect(appState(app).selectedWorkspace).toBe(mainWorkspace);
    expect(appState(app).selectedSession).toBe(selectedSession);
  });

  it("requires a destination rather than guessing when the selected session cwd is not an exact loaded workspace", () => {
    const app = new PiWebApp();
    const selectedSession = session("selected", "/repo/.worktrees/feature/not-loaded");
    setAppState(app, {
      machines: [localMachine],
      selectedMachine: localMachine,
      projects: [project],
      selectedProject: project,
      selectedWorkspace: mainWorkspace,
      workspaces: [mainWorkspace],
      workspacesByProjectId: { [project.id]: [mainWorkspace] },
      selectedSession,
      sessions: [selectedSession],
    });

    invoke(app, "openNewSessionComposer");

    expect(composerRequest(app)).toEqual({ kind: "open", initialPrompt: "" });
  });

  it("focuses the mounted composer and preserves the existing request on repeated activation", () => {
    const app = new PiWebApp();
    setAppState(app, {
      machines: [localMachine],
      selectedMachine: localMachine,
      projects: [project],
      selectedProject: project,
      selectedWorkspace: mainWorkspace,
      workspaces: [mainWorkspace],
      workspacesByProjectId: { [project.id]: [mainWorkspace] },
      selectedSession: session("selected", mainWorkspace.path),
    });
    invoke(app, "openNewSessionComposer");
    const firstRequest = composerRequest(app);
    const focusExisting = vi.fn();
    Object.defineProperty(app, "newSessionComposer", { configurable: true, value: { focusExisting } });

    invoke(app, "openNewSessionComposer");

    expect(composerRequest(app)).toBe(firstRequest);
    expect(focusExisting).toHaveBeenCalledOnce();
  });

  it("routes both v1 plugin host methods through the same composer open path", () => {
    const app = new PiWebApp();
    const context = invoke(app, "createPluginRuntimeContext");
    if (!isPluginSessionRuntimeContext(context)) throw new Error("Expected plugin runtime context");

    void context.startSession();
    expect(composerRequest(app)).toMatchObject({ kind: "open" });

    invoke(app, "closeNewSessionComposer");
    context.openNewSessionComposer();
    expect(composerRequest(app)).toMatchObject({ kind: "open" });
  });

  it("routes the inbox trigger through the same root open path", () => {
    const app = new PiWebApp();
    const container = renderApp(app);
    const navigation = required(container.querySelector<AppNavigationPanel>("app-navigation-panel"), "navigation panel");

    void navigation.onNewSession?.();

    expect(composerRequest(app)).toMatchObject({ kind: "open" });
    expect(appState(app).workspaceManagementDialog).toBeUndefined();
  });

  it("routes the workspace header trigger through the same root open path", () => {
    const app = new PiWebApp();
    const container = renderApp(app);
    const workspace = required(container.querySelector<WorkspacePanel>("workspace-panel"), "workspace panel");

    workspace.onNewSession?.();

    expect(composerRequest(app)).toMatchObject({ kind: "open" });
  });

  it("shows the shared New session action when no chat composer exists", () => {
    const app = new PiWebApp();
    setAppState(app, { selectedWorkspace: mainWorkspace, selectedSession: undefined });
    const container = renderApp(app);
    const action = required(container.querySelector<HTMLButtonElement>(".empty [data-action='new-session']"), "empty-state New session action");

    expect(action.textContent).toContain(NEW_SESSION_LABEL);
    expect(action.title).toBe(NEW_SESSION_LABEL);
    expect(action.getAttribute("aria-label")).toBe(NEW_SESSION_LABEL);
    expect(action.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");

    action.click();
    expect(composerRequest(app)).toMatchObject({ kind: "open" });
  });

  it("cancel closes without changing navigation sequencing or the selected location", () => {
    const app = new PiWebApp();
    const selectedSession = session("selected", mainWorkspace.path);
    setAppState(app, {
      selectedMachine: localMachine,
      selectedProject: project,
      selectedWorkspace: mainWorkspace,
      selectedSession,
      mainView: "core:workspace.git",
    });
    Reflect.set(app, "navigationSelectionSeq", 17);
    invoke(app, "openNewSessionComposer");

    invoke(app, "closeNewSessionComposer");

    expect(Reflect.get(app, "navigationSelectionSeq")).toBe(17);
    expect(appState(app)).toMatchObject({
      selectedMachine: localMachine,
      selectedProject: project,
      selectedWorkspace: mainWorkspace,
      selectedSession,
      mainView: "core:workspace.git",
      newSessionComposer: { kind: "closed" },
    });
  });

  it("renders the root composer and hands Send to the real SessionController pending-row launch", async () => {
    const app = new PiWebApp();
    const destination = completeNewSessionDestination(localMachine, project, mainWorkspace);
    Reflect.set(app, "newSessionDestinationCatalog", new InMemoryNewSessionDestinationCatalog({
      machines: [localMachine],
      projectsByMachine: { [localMachine.id]: [project] },
      workspacesByMachineAndProject: { [`${localMachine.id}:${project.id}`]: [mainWorkspace] },
    }));
    const selectedSession = session("selected", mainWorkspace.path);
    setAppState(app, {
      machines: [localMachine],
      selectedMachine: localMachine,
      projects: [project],
      selectedProject: project,
      workspaces: [mainWorkspace],
      workspacesByProjectId: { [project.id]: [mainWorkspace] },
      selectedWorkspace: mainWorkspace,
      selectedSession,
      sessions: [selectedSession],
      mainView: "core:workspace.git",
    });
    Reflect.set(app, "navigateToNewSessionDestination", vi.fn(() => Promise.resolve(true)));
    Reflect.set(app, "openChat", vi.fn(() => Promise.resolve()));
    const controller = sessionController(app);
    const api: unknown = Reflect.get(controller, "api");
    if (!isSessionTransport(api)) throw new Error("Expected SessionController transport");
    const startSession = vi.fn(() => new Promise<SessionInfo>(() => undefined));
    Reflect.set(controller, "api", { ...api, startSession });
    invoke(app, "openNewSessionComposer");
    // The request has captured the selected session's destination. Keep the unrelated chat editor
    // out of this root-composer integration render.
    patchAppState(app, { selectedSession: undefined });
    const container = renderApp(app);
    const composer = required(container.querySelector<NewSessionComposer>("new-session-composer"), "new-session composer");
    expect(composer.initialDestination).toEqual(destination);
    await elementUpdateComplete(composer);
    const prompt = required(composer.shadowRoot?.querySelector<HTMLTextAreaElement>("textarea[data-field='prompt']"), "first prompt");
    prompt.value = "Build through the real controller";
    prompt.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    await elementUpdateComplete(composer);

    required(composer.shadowRoot?.querySelector<HTMLButtonElement>("[data-action='send']"), "Send button").click();

    await vi.waitFor(() => {
      expect(isClientPendingSession(appState(app).selectedSession)).toBe(true);
    });
    const pending = required(appState(app).selectedSession, "pending session");
    expect(startSession).toHaveBeenCalledWith(mainWorkspace.path, localMachine.id, pending.id);
    expect(appState(app).sessions.map((candidate) => candidate.id)).toEqual([pending.id, selectedSession.id]);
    expect(appState(app).clientQueuedSessionMessages[pending.id]).toEqual([
      { kind: "followUp", text: "Build through the real controller" },
    ]);
  });

  it("binds rendered creation recovery to its chat session and seeds one replacement composer", async () => {
    const app = new PiWebApp();
    const failed = { ...session("pending-failed", mainWorkspace.path), clientPendingStart: true as const, machineId: localMachine.id };
    setAppState(app, {
      machines: [localMachine],
      selectedMachine: localMachine,
      projects: [project],
      selectedProject: project,
      selectedWorkspace: mainWorkspace,
      workspaces: [mainWorkspace],
      workspacesByProjectId: { [project.id]: [mainWorkspace] },
      selectedSession: failed,
      sessions: [failed],
      clientQueuedSessionMessages: { [failed.id]: [{ kind: "followUp", text: "Move this prompt" }] },
    });
    const controller = sessionController(app);
    vi.spyOn(controller, "getSessionLaunchRecovery").mockReturnValue({
      stage: "creationFailed",
      sessionId: failed.id,
      destination: { machineId: localMachine.id, workspaceId: mainWorkspace.id, cwd: mainWorkspace.path },
      prompt: "Move this prompt",
      retrying: false,
    });
    const retry = vi.spyOn(controller, "retrySessionLaunch").mockResolvedValue();
    const container = renderApp(app);
    const chat = required(container.querySelector<ChatView>("chat-view"), "chat view");
    await elementUpdateComplete(chat);
    const other = session("selected-after-render", mainWorkspace.path);
    patchAppState(app, { selectedSession: other, sessions: [other, failed] });
    const recoveryButtons = Array.from(chat.shadowRoot?.querySelectorAll<HTMLButtonElement>(".session-launch-recovery button") ?? []);

    recoveryButtons[0]?.click();
    recoveryButtons[1]?.click();

    expect(retry).toHaveBeenCalledExactlyOnceWith(failed.id);
    expect(composerRequest(app)).toEqual({
      kind: "open",
      initialDestination: completeNewSessionDestination(localMachine, project, mainWorkspace),
      initialPrompt: "Move this prompt",
      replacesFailedSessionId: failed.id,
    });
    expect(appState(app).sessions).toEqual([other, failed]);

    invoke(app, "closeNewSessionComposer");

    expect(appState(app).sessions).toEqual([other, failed]);
  });

  it("keeps the failed row, recovery, and preview until the real controller selects its replacement pending row", async () => {
    const app = new PiWebApp();
    const destination = completeNewSessionDestination(localMachine, project, mainWorkspace);
    setAppState(app, {
      machines: [localMachine],
      selectedMachine: localMachine,
      projects: [project],
      selectedProject: project,
      workspaces: [mainWorkspace],
      workspacesByProjectId: { [project.id]: [mainWorkspace] },
      selectedWorkspace: mainWorkspace,
      sessions: [],
    });
    Reflect.set(app, "newSessionDestinationCatalog", new InMemoryNewSessionDestinationCatalog({
      machines: [localMachine],
      projectsByMachine: { [localMachine.id]: [project] },
      workspacesByMachineAndProject: { [`${localMachine.id}:${project.id}`]: [mainWorkspace] },
    }));
    Reflect.set(app, "navigateToNewSessionDestination", vi.fn(() => Promise.resolve(true)));
    Reflect.set(app, "openChat", vi.fn(() => Promise.resolve()));
    const controller = sessionController(app);
    const api: unknown = Reflect.get(controller, "api");
    if (!isSessionTransport(api)) throw new Error("Expected SessionController transport");
    let startCallCount = 0;
    const startSession = vi.fn(() => {
      startCallCount += 1;
      return startCallCount === 1
        ? Promise.reject(new Error("backend unavailable"))
        : new Promise<SessionInfo>(() => undefined);
    });
    Reflect.set(controller, "api", { ...api, startSession });

    await controller.launchSession("Move this prompt");
    const failed = required(appState(app).selectedSession, "failed pending session");
    const failedId = failed.id;
    invoke(app, "openSessionLaunchDestinationComposer", failedId);

    expect(appState(app).sessions).toContain(failed);
    expect(controller.getSessionLaunchRecovery(failedId)?.stage).toBe("creationFailed");
    expect(appState(app).clientQueuedSessionMessages[failedId]).toEqual([
      { kind: "followUp", text: "Move this prompt" },
    ]);

    const outcome = await invokeAsync(app, "submitNewSession", { destination, prompt: "Move this prompt" } satisfies NewSessionLaunchIntent);

    expect(outcome).toEqual({ kind: "accepted" });
    const replacement = required(appState(app).selectedSession, "replacement pending session");
    expect(replacement.id).not.toBe(failedId);
    expect(isClientPendingSession(replacement)).toBe(true);
    expect(appState(app).sessions).toContain(replacement);
    expect(appState(app).sessions).not.toContain(failed);
    expect(controller.getSessionLaunchRecovery(failedId)).toBeUndefined();
    expect(appState(app).clientQueuedSessionMessages[failedId]).toBeUndefined();
    expect(appState(app).clientQueuedSessionMessages[replacement.id]).toEqual([
      { kind: "followUp", text: "Move this prompt" },
    ]);
  });

  it("binds rendered ambiguous recovery to its chat session without retry", async () => {
    const app = new PiWebApp();
    const selected = session("real-session", mainWorkspace.path);
    setAppState(app, {
      selectedMachine: localMachine,
      selectedWorkspace: mainWorkspace,
      selectedSession: selected,
      sessions: [selected],
      clientQueuedSessionMessages: { [selected.id]: [{ kind: "followUp", text: "Inspect this prompt" }] },
    });
    const controller = sessionController(app);
    vi.spyOn(controller, "getSessionLaunchRecovery").mockReturnValue({
      stage: "promptDeliveryAmbiguous",
      sessionId: selected.id,
      destination: { machineId: localMachine.id, workspaceId: mainWorkspace.id, cwd: mainWorkspace.path },
      prompt: "Inspect this prompt",
      retrying: false,
    });
    const refresh = vi.spyOn(controller, "refreshSessionLaunchRecovery").mockResolvedValue();
    const restore = vi.spyOn(controller, "restoreSessionLaunchPrompt").mockResolvedValue();
    const retry = vi.spyOn(controller, "retrySessionLaunch").mockResolvedValue();
    const chat = required(renderApp(app).querySelector<ChatView>("chat-view"), "chat view");
    await elementUpdateComplete(chat);
    patchAppState(app, { selectedSession: session("selected-after-render", mainWorkspace.path) });
    const recoveryButtons = Array.from(chat.shadowRoot?.querySelectorAll<HTMLButtonElement>(".session-launch-recovery button") ?? []);

    recoveryButtons[0]?.click();
    recoveryButtons[1]?.click();

    expect(refresh).toHaveBeenCalledExactlyOnceWith(selected.id);
    expect(restore).toHaveBeenCalledExactlyOnceWith(selected.id);
    expect(retry).not.toHaveBeenCalled();
  });

  it("revalidates the exact destination before accepting the synchronous pending launch handoff", async () => {
    const app = new PiWebApp();
    const destination = completeNewSessionDestination(remoteMachine, remoteProject, remoteWorkspace);
    const catalog = new InMemoryNewSessionDestinationCatalog({
      machines: [remoteMachine],
      projectsByMachine: { [remoteMachine.id]: [remoteProject] },
      workspacesByMachineAndProject: { [`${remoteMachine.id}:${remoteProject.id}`]: [remoteWorkspace] },
    });
    Reflect.set(app, "newSessionDestinationCatalog", catalog);
    setAppState(app, { machines: [localMachine, remoteMachine], selectedMachine: localMachine });
    invoke(app, "openNewSessionComposer");
    const navigate = vi.fn(() => {
      patchAppState(app, {
        selectedMachine: remoteMachine,
        projects: [remoteProject],
        selectedProject: remoteProject,
        workspaces: [remoteWorkspace],
        selectedWorkspace: remoteWorkspace,
      });
      return Promise.resolve(true);
    });
    Reflect.set(app, "navigateToNewSessionDestination", navigate);
    const launchSession = vi.fn((prompt: string) => {
      const pending = { ...session("pending", remoteWorkspace.path), clientPendingStart: true, machineId: remoteMachine.id };
      patchAppState(app, {
        selectedSession: pending,
        sessions: [pending],
        clientQueuedSessionMessages: { [pending.id]: [{ kind: "followUp", text: prompt }] },
      });
      return new Promise<void>(() => undefined);
    });
    const sessions = sessionController(app);
    sessions.launchSession = launchSession;
    const openChat = vi.fn(() => Promise.resolve());
    Reflect.set(app, "openChat", openChat);

    const outcome = await invokeAsync(app, "submitNewSession", { destination, prompt: "Build it" } satisfies NewSessionLaunchIntent);

    expect(navigate).toHaveBeenCalledWith(destination, expect.any(Function));
    expect(launchSession).toHaveBeenCalledWith("Build it");
    expect(composerRequest(app)).toMatchObject({ kind: "closed" });
    expect(openChat).toHaveBeenCalledOnce();
    expect(outcome).toEqual({ kind: "accepted" });
  });

  it("uses the existing machine then project/workspace selection cascade for another machine", async () => {
    const app = new PiWebApp();
    const destination = completeNewSessionDestination(remoteMachine, remoteProject, remoteWorkspace);
    setAppState(app, { machines: [localMachine, remoteMachine], selectedMachine: localMachine });
    const selectMachine = vi.fn(() => {
      patchAppState(app, { selectedMachine: remoteMachine, projects: [remoteProject] });
      return Promise.resolve();
    });
    Reflect.set(app, "selectMachineWithMemory", selectMachine);
    const workspaces: unknown = Reflect.get(app, "workspaces");
    if (!isWorkspaceSelectionController(workspaces)) throw new Error("Expected PiWebApp WorkspaceController");
    const selectProject = vi.spyOn(workspaces, "selectProject").mockImplementation(() => {
      patchAppState(app, { selectedProject: remoteProject, selectedWorkspace: remoteWorkspace });
      return Promise.resolve();
    });

    const navigated = await invokeAsync(app, "navigateToNewSessionDestination", destination, () => true);

    expect(navigated).toBe(true);
    expect(selectMachine).toHaveBeenCalledWith(remoteMachine);
    expect(selectProject).toHaveBeenCalledOnce();
    const projectSelection = selectProject.mock.calls[0];
    expect(projectSelection?.[0]).toBe(remoteProject);
    expect(projectSelection?.[1].workspaceId).toBe(remoteWorkspace.id);
    expect(typeof projectSelection?.[1].isCurrent).toBe("function");
  });

  it.each([
    { name: "returns false", navigate: () => Promise.resolve(false) },
    { name: "throws", navigate: () => Promise.reject(new Error("selection failed")) },
  ])("keeps the composer open and does not launch when post-revalidation navigation $name", async ({ navigate }) => {
    const app = new PiWebApp();
    const destination = completeNewSessionDestination(remoteMachine, remoteProject, remoteWorkspace);
    Reflect.set(app, "newSessionDestinationCatalog", new InMemoryNewSessionDestinationCatalog({
      machines: [remoteMachine],
      projectsByMachine: { [remoteMachine.id]: [remoteProject] },
      workspacesByMachineAndProject: { [`${remoteMachine.id}:${remoteProject.id}`]: [remoteWorkspace] },
    }));
    invoke(app, "openNewSessionComposer");
    Reflect.set(app, "navigateToNewSessionDestination", vi.fn(navigate));
    const launch = vi.spyOn(sessionController(app), "launchSession");

    const outcome = await invokeAsync(app, "submitNewSession", { destination, prompt: "Keep me" } satisfies NewSessionLaunchIntent);

    expect(outcome).toMatchObject({ kind: "rejected", reason: "destination-unavailable" });
    expect(composerRequest(app)).toMatchObject({ kind: "open" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("keeps the composer open and does not navigate when exact Send-time revalidation fails", async () => {
    const app = new PiWebApp();
    const destination = completeNewSessionDestination(remoteMachine, remoteProject, remoteWorkspace);
    Reflect.set(app, "newSessionDestinationCatalog", new InMemoryNewSessionDestinationCatalog({ machines: [remoteMachine], projectsByMachine: { [remoteMachine.id]: [remoteProject] } }));
    invoke(app, "openNewSessionComposer");
    const navigate = vi.fn();
    Reflect.set(app, "navigateToNewSessionDestination", navigate);
    const launch = vi.spyOn(sessionController(app), "launchSession");

    const outcome = await invokeAsync(app, "submitNewSession", { destination, prompt: "Keep me" } satisfies NewSessionLaunchIntent);

    expect(outcome).toMatchObject({ kind: "rejected", reason: "destination-unavailable" });
    expect(composerRequest(app)).toMatchObject({ kind: "open" });
    expect(navigate).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });
});

const localMachine: Machine = { id: "local", name: "Local", kind: "local", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z", status: "online" };
const remoteMachine: Machine = { id: "remote", name: "Remote", kind: "remote", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z", status: "online" };
const project: Project = { id: "project", name: "Forgerie", path: "/repo", createdAt: "2026-08-10T00:00:00.000Z" };
const remoteProject: Project = { id: "remote-project", name: "Remote project", path: "/remote/repo", createdAt: "2026-08-10T00:00:00.000Z" };
const mainWorkspace: Workspace = { id: "main", projectId: project.id, path: project.path, label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} };
const siblingWorkspace: Workspace = { id: "sibling", projectId: project.id, path: "/repo/.worktrees/feature/one", label: "feature/one", isMain: false, isGitRepo: true, isGitWorktree: true, effectiveConfig: {} };
const remoteWorkspace: Workspace = { id: "remote-workspace", projectId: remoteProject.id, path: "/remote/repo", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} };

function session(id: string, cwd: string): SessionInfo {
  return { id, cwd, path: `${cwd}/${id}.jsonl`, created: "2026-08-10T00:00:00.000Z", modified: "2026-08-10T00:00:00.000Z", messageCount: 0, firstMessage: "" };
}

function renderApp(app: PiWebApp): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(app.render(), container);
  return container;
}

function setAppState(app: PiWebApp, patch: Partial<AppState>): void {
  Reflect.set(app, "state", { ...initialAppState(), ...patch });
}

function patchAppState(app: PiWebApp, patch: Partial<AppState>): void {
  Reflect.set(app, "state", { ...appState(app), ...patch });
}

function appState(app: PiWebApp): AppState {
  const value: unknown = Reflect.get(app, "state");
  if (!isAppState(value)) throw new Error("Expected PiWebApp state");
  return value;
}

function isAppState(value: unknown): value is AppState {
  return typeof value === "object" && value !== null && "newSessionComposer" in value && "machines" in value;
}

function isClientPendingSession(value: SessionInfo | undefined): boolean {
  return value !== undefined && "clientPendingStart" in value && value.clientPendingStart === true;
}

function composerRequest(app: PiWebApp): unknown {
  return appState(app).newSessionComposer;
}

interface SessionLaunchController {
  launchSession: (prompt: string) => Promise<void>;
  getSessionLaunchRecovery: (sessionId: string) => SessionLaunchRecovery | undefined;
  retrySessionLaunch: (sessionId: string) => Promise<void>;
  acceptSessionLaunchReplacement: (failedSessionId: string, replacementSessionId: string) => void;
  refreshSessionLaunchRecovery: (sessionId: string) => Promise<void>;
  restoreSessionLaunchPrompt: (sessionId: string) => Promise<void>;
}

interface SessionTransport {
  startSession: (cwd: string, machineId?: string, startupToken?: string) => Promise<SessionInfo>;
}

interface PluginSessionRuntimeContext {
  startSession: () => void | Promise<void>;
  openNewSessionComposer: () => void;
}

interface WorkspaceSelectionController {
  selectProject: (project: Project, options: { workspaceId: string; isCurrent: () => boolean }) => Promise<void>;
}

function sessionController(app: PiWebApp): SessionLaunchController {
  const value: unknown = Reflect.get(app, "sessions");
  if (!isSessionLaunchController(value)) throw new Error("Expected PiWebApp SessionController");
  return value;
}

function isSessionLaunchController(value: unknown): value is SessionLaunchController {
  return typeof value === "object" && value !== null
    && "launchSession" in value && typeof value.launchSession === "function"
    && "getSessionLaunchRecovery" in value && typeof value.getSessionLaunchRecovery === "function"
    && "retrySessionLaunch" in value && typeof value.retrySessionLaunch === "function"
    && "acceptSessionLaunchReplacement" in value && typeof value.acceptSessionLaunchReplacement === "function"
    && "refreshSessionLaunchRecovery" in value && typeof value.refreshSessionLaunchRecovery === "function"
    && "restoreSessionLaunchPrompt" in value && typeof value.restoreSessionLaunchPrompt === "function";
}

function isSessionTransport(value: unknown): value is SessionTransport {
  return typeof value === "object" && value !== null && "startSession" in value && typeof value.startSession === "function";
}

function isPluginSessionRuntimeContext(value: unknown): value is PluginSessionRuntimeContext {
  return typeof value === "object" && value !== null
    && "startSession" in value && typeof value.startSession === "function"
    && "openNewSessionComposer" in value && typeof value.openNewSessionComposer === "function";
}

function isWorkspaceSelectionController(value: unknown): value is WorkspaceSelectionController {
  return typeof value === "object" && value !== null && "selectProject" in value && typeof value.selectProject === "function";
}

type AppMethod = (this: PiWebApp, ...args: unknown[]) => unknown;

function invoke(app: PiWebApp, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(app, name);
  if (!isAppMethod(method)) throw new Error(`Expected PiWebApp.${name}`);
  return Reflect.apply(method, app, args);
}

function isAppMethod(value: unknown): value is AppMethod {
  return typeof value === "function";
}

async function invokeAsync(app: PiWebApp, name: string, ...args: unknown[]): Promise<unknown> {
  const result = invoke(app, name, ...args);
  if (!isUnknownPromise(result)) throw new Error(`Expected PiWebApp.${name} to return a promise`);
  return await result;
}

function isUnknownPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

async function elementUpdateComplete(element: HTMLElement): Promise<void> {
  const updateComplete: unknown = Reflect.get(element, "updateComplete");
  if (!(updateComplete instanceof Promise)) throw new Error("Expected Lit updateComplete");
  await updateComplete;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
