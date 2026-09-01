import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityApi, sessionsApi, terminalsApi, type Machine, type SessionTreeForkResult, type SessionTreeNavigateResult, type SessionTreeSnapshot, type SessionTreeSummaryChoice, type Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { ActivityController } from "../controllers/activityController";
import { SessionController } from "../controllers/sessionController";
import { SessionInboxController } from "../controllers/sessionInboxController";
import { SessionUnreadController } from "../sessionUnread";
// This node-environment test uses the shared, type-guarded template inspection
// escape hatch only to verify PiWebApp's navigator callback boundary.
import { templateValueAfterMarker } from "../templateInspection.testSupport";
import { PiWebApp } from "./PiWebApp";

type NavigateHandler = (targetId: string, summaryChoice: SessionTreeSummaryChoice) => Promise<SessionTreeNavigateResult>;
type ForkHandler = (entryId: string) => Promise<SessionTreeForkResult>;
type AbortHandler = () => Promise<void>;
type CancelHandler = () => void;
type RenderSessionTreeNavigator = (this: PiWebApp, state: AppState) => TemplateResult | null;
type AppMethod = (this: PiWebApp, ...args: unknown[]) => unknown;

const reconnectTimers: (() => void)[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

class RecordingWebSocket {
  static readonly CONNECTING = 0;
  static readonly instances: RecordingWebSocket[] = [];

  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: MessageEvent["data"] }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    RecordingWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = 3;
  }
}

describe("PiWebApp session tree wiring", () => {
  it("routes navigation, cancellation, abort, and chat reveal through SessionController", async () => {
    const app = createApp();
    const state = setAppTree(app, tree());
    const controller = appSessionController(app);
    const navigateTree = vi.spyOn(controller, "navigateTree")
      .mockResolvedValueOnce({ cancelled: false, editorText: "edit" })
      .mockResolvedValueOnce({ cancelled: true, aborted: true });
    const abortTreeNavigation = vi.spyOn(controller, "abortTreeNavigation").mockResolvedValue(undefined);
    const closeTreeDialog = vi.spyOn(controller, "closeTreeDialog").mockReturnValue(undefined);
    const openChat = vi.fn(() => Promise.resolve());
    const focusChatComposer = vi.fn(() => Promise.resolve());
    if (!Reflect.set(app, "openChat", openChat)) throw new Error("Could not replace chat reveal boundary");
    if (!Reflect.set(app, "focusChatComposer", focusChatComposer)) throw new Error("Could not replace prompt focus boundary");

    const rendered = renderSessionTreeNavigator(app, state);
    const onNavigate = navigatorNavigateHandler(rendered);
    const onAbort = navigatorAbortHandler(rendered);
    const onCancel = navigatorCancelHandler(rendered);

    await expect(onNavigate("side", { mode: "none" })).resolves.toEqual({ cancelled: false, editorText: "edit" });
    expect(navigateTree).toHaveBeenNthCalledWith(1, "side", { mode: "none" });
    expect(openChat).toHaveBeenCalledOnce();
    expect(Reflect.get(app, "chatOpeningAttempt")).toBe(1);

    await expect(onNavigate("root", { mode: "default" })).resolves.toEqual({ cancelled: true, aborted: true });
    expect(openChat).toHaveBeenCalledOnce();
    expect(Reflect.get(app, "chatOpeningAttempt")).toBe(1);

    await onAbort();
    expect(abortTreeNavigation).toHaveBeenCalledOnce();

    onCancel();
    expect(closeTreeDialog).toHaveBeenCalledOnce();
    expect(openChat).toHaveBeenCalledTimes(2);

    // Revealing chat must never raise the on-screen keyboard.
    expect(focusChatComposer).not.toHaveBeenCalled();
  });

  it("routes fork requests through SessionController and propagates results and failures", async () => {
    const app = createApp();
    const state = setAppTree(app, tree());
    const controller = appSessionController(app);
    const forkFromTree = vi.spyOn(controller, "forkFromTree")
      .mockResolvedValueOnce({ cancelled: true })
      .mockResolvedValueOnce({ cancelled: false, session: { ...session(), id: "session-fork" } })
      .mockRejectedValueOnce(new Error("Stop current activity before forking."));
    const onFork = navigatorForkHandler(renderSessionTreeNavigator(app, state));

    await expect(onFork("side")).resolves.toEqual({ cancelled: true });
    expect(forkFromTree).toHaveBeenNthCalledWith(1, "side");

    await expect(onFork("root")).resolves.toMatchObject({ cancelled: false, session: { id: "session-fork" } });
    expect(forkFromTree).toHaveBeenNthCalledWith(2, "root");

    await expect(onFork("failure")).rejects.toThrow("Stop current activity before forking.");
    expect(forkFromTree).toHaveBeenNthCalledWith(3, "failure");
  });

  it("does not steal focus after the user selects another session during navigation", async () => {
    const app = createApp();
    const state = setAppTree(app, tree());
    const controller = appSessionController(app);
    const result = deferred<SessionTreeNavigateResult>();
    vi.spyOn(controller, "navigateTree").mockReturnValue(result.promise);
    const openChat = vi.fn(() => Promise.resolve());
    if (!Reflect.set(app, "openChat", openChat)) throw new Error("Could not replace chat reveal boundary");
    const onNavigate = navigatorNavigateHandler(renderSessionTreeNavigator(app, state));

    const navigation = onNavigate("side", { mode: "none" });
    const otherSession = state.selectedSession === undefined ? undefined : { ...state.selectedSession, id: "session-2" };
    if (!Reflect.set(app, "state", { ...state, selectedSession: otherSession })) throw new Error("Could not change selected session");
    result.resolve({ cancelled: false });
    await navigation;

    expect(openChat).not.toHaveBeenCalled();
  });
});

describe("PiWebApp realtime snapshot wiring", () => {
  it("leaves initial selected-machine snapshots to the explicit loaders and corrects them on reconnect", async () => {
    const app = createApp();
    const selectedWorkspace = workspace();
    setAppMachineState(app, [machine("local", "local")], machine("local", "local"), selectedWorkspace);
    const requests = recordSnapshotRequests();

    await Promise.all([
      appInboxController(app).refresh("local"),
      appUnreadController(app).refresh("local"),
      appActivityController(app).refresh("local"),
      refreshActiveTerminals(app, selectedWorkspace),
    ]);
    connectRealtime(app);

    expectSnapshotRequestCounts(requests, 1);
    const initialSocket = RecordingWebSocket.instances[0];
    if (initialSocket === undefined) throw new Error("Expected selected-machine realtime socket");
    initialSocket.onopen?.();
    await settlePromises();

    expectSnapshotRequestCounts(requests, 1);

    initialSocket.onclose?.();
    runNextReconnectTimer();
    const reconnectedSocket = RecordingWebSocket.instances[1];
    if (reconnectedSocket === undefined) throw new Error("Expected selected-machine reconnect socket");
    reconnectedSocket.onopen?.();
    await settlePromises();

    expectSnapshotRequestCounts(requests, 2);
  });

  it("refreshes machine-switch snapshots once without first-open duplication", async () => {
    const app = createApp();
    const firstMachine = machine("machine-a", "remote");
    const nextMachine = machine("machine-b", "remote");
    setAppMachineState(app, [], firstMachine);
    const requests = recordSnapshotRequests();

    await Promise.all([
      appInboxController(app).refresh(firstMachine.id),
      appActivityController(app).refresh(firstMachine.id),
    ]);
    connectRealtime(app);
    RecordingWebSocket.instances[0]?.onopen?.();
    await settlePromises();
    expect(requests.machineListing).toHaveBeenCalledTimes(1);
    expect(requests.workspaceActivity).toHaveBeenCalledTimes(1);

    callAppMethod(app, "setState", { selectedMachine: nextMachine });
    await settlePromises();
    expect(requests.machineListing).toHaveBeenCalledTimes(2);
    expect(requests.machineListing).toHaveBeenLastCalledWith(nextMachine.id);
    expect(requests.workspaceActivity).toHaveBeenCalledTimes(2);
    expect(requests.workspaceActivity).toHaveBeenLastCalledWith(nextMachine.id);

    const nextMachineSocket = RecordingWebSocket.instances[1];
    if (nextMachineSocket === undefined) throw new Error("Expected new-machine realtime socket");
    nextMachineSocket.onopen?.();
    await settlePromises();

    expect(requests.machineListing).toHaveBeenCalledTimes(2);
    expect(requests.workspaceActivity).toHaveBeenCalledTimes(2);
  });

  it("refreshes background-machine unread and activity snapshots on first open and reconnect", async () => {
    const app = createApp();
    const local = machine("local", "local");
    const remote = machine("remote-a", "remote");
    setAppMachineState(app, [local, remote], local);
    const requests = recordSnapshotRequests();

    syncMachineActivitySubscriptions(app);
    const initialSocket = RecordingWebSocket.instances[0];
    if (initialSocket === undefined) throw new Error("Expected background-machine realtime socket");
    initialSocket.onopen?.();
    await settlePromises();

    expect(requests.unreadCatalog).toHaveBeenCalledTimes(1);
    expect(requests.unreadCatalog).toHaveBeenLastCalledWith("remote-a");
    expect(requests.workspaceActivity).toHaveBeenCalledTimes(1);
    expect(requests.workspaceActivity).toHaveBeenLastCalledWith("remote-a");

    initialSocket.onclose?.();
    runNextReconnectTimer();
    const reconnectedSocket = RecordingWebSocket.instances[1];
    if (reconnectedSocket === undefined) throw new Error("Expected background-machine reconnect socket");
    reconnectedSocket.onopen?.();
    await settlePromises();

    expect(requests.unreadCatalog).toHaveBeenCalledTimes(2);
    expect(requests.workspaceActivity).toHaveBeenCalledTimes(2);
    expect(requests.machineListing).not.toHaveBeenCalled();
    expect(requests.terminals).not.toHaveBeenCalled();
  });
});

function createApp(): PiWebApp {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  RecordingWebSocket.instances.length = 0;
  reconnectTimers.length = 0;
  vi.stubGlobal("WebSocket", RecordingWebSocket);
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: storage,
    clearTimeout: vi.fn(),
    setTimeout: vi.fn((callback: () => void) => {
      reconnectTimers.push(callback);
      return reconnectTimers.length;
    }),
  });
  return new PiWebApp();
}

function setAppMachineState(app: PiWebApp, machines: Machine[], selectedMachine: Machine, selectedWorkspace?: Workspace): void {
  const state = {
    ...initialAppState(),
    machines,
    selectedMachine,
    selectedWorkspace,
    workspaces: selectedWorkspace === undefined ? [] : [selectedWorkspace],
  };
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp machine state");
}

function recordSnapshotRequests() {
  return {
    machineListing: vi.spyOn(sessionsApi, "machineListing").mockResolvedValue({ sessions: [], statuses: [], activities: [] }),
    asksCatalog: vi.spyOn(sessionsApi, "asksCatalog").mockResolvedValue({ sessions: [] }),
    unreadCatalog: vi.spyOn(sessionsApi, "unreadCatalog").mockResolvedValue({ catalogId: "catalog-a", catalogRevision: 0, sessions: [] }),
    workspaceActivity: vi.spyOn(activityApi, "workspaceActivity").mockResolvedValue({ workspaces: [], generatedAt: "2026-08-09T00:00:00.000Z" }),
    terminals: vi.spyOn(terminalsApi, "terminals").mockResolvedValue([]),
  };
}

function expectSnapshotRequestCounts(requests: ReturnType<typeof recordSnapshotRequests>, count: number): void {
  expect(requests.machineListing).toHaveBeenCalledTimes(count);
  expect(requests.asksCatalog).toHaveBeenCalledTimes(count);
  expect(requests.unreadCatalog).toHaveBeenCalledTimes(count);
  expect(requests.workspaceActivity).toHaveBeenCalledTimes(count);
  expect(requests.terminals).toHaveBeenCalledTimes(count);
}

function appInboxController(app: PiWebApp): SessionInboxController {
  const controller: unknown = Reflect.get(app, "inbox");
  if (!(controller instanceof SessionInboxController)) throw new Error("PiWebApp SessionInboxController was unavailable");
  return controller;
}

function appUnreadController(app: PiWebApp): SessionUnreadController {
  const controller: unknown = Reflect.get(app, "sessionUnread");
  if (!(controller instanceof SessionUnreadController)) throw new Error("PiWebApp SessionUnreadController was unavailable");
  return controller;
}

function appActivityController(app: PiWebApp): ActivityController {
  const controller: unknown = Reflect.get(app, "activity");
  if (!(controller instanceof ActivityController)) throw new Error("PiWebApp ActivityController was unavailable");
  return controller;
}

function connectRealtime(app: PiWebApp): void {
  callAppMethod(app, "connectRealtime");
}

function syncMachineActivitySubscriptions(app: PiWebApp): void {
  callAppMethod(app, "syncMachineActivitySubscriptions");
}

async function refreshActiveTerminals(app: PiWebApp, selectedWorkspace: Workspace): Promise<void> {
  await callAppMethod(app, "refreshActiveTerminals", selectedWorkspace);
}

function callAppMethod(app: PiWebApp, name: string, ...args: unknown[]): ReturnType<AppMethod> {
  const method: unknown = Reflect.get(app, name);
  if (!isAppMethod(method)) throw new Error(`PiWebApp.${name} was unavailable`);
  return method.call(app, ...args);
}

function isAppMethod(value: unknown): value is AppMethod {
  return typeof value === "function";
}

function runNextReconnectTimer(): void {
  const timer = reconnectTimers.shift();
  if (timer === undefined) throw new Error("Expected a scheduled realtime reconnect");
  timer();
}

async function settlePromises(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}

function machine(id: string, kind: Machine["kind"]): Machine {
  return {
    id,
    name: id,
    kind,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

function workspace(): Workspace {
  return {
    id: "workspace-1",
    projectId: "project-1",
    path: "/repo",
    label: "repo",
    isMain: true,
    isGitRepo: true,
    isGitWorktree: false,
    effectiveConfig: {},
  };
}

function setAppTree(app: PiWebApp, treeSnapshot: SessionTreeSnapshot): AppState {
  const selectedSession = {
    ...session(),
    id: "session-1",
  };
  const state = { ...initialAppState(), selectedSession, sessions: [selectedSession], treeDialog: treeSnapshot };
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp tree state");
  return state;
}

function session() {
  return {
    path: "/tmp/session-1.jsonl",
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 2,
    firstMessage: "Initial prompt",
  };
}

function renderSessionTreeNavigator(app: PiWebApp, state: AppState): TemplateResult {
  const method: unknown = Reflect.get(app, "renderSessionTreeNavigator");
  if (!isRenderSessionTreeNavigator(method)) throw new Error("PiWebApp.renderSessionTreeNavigator was unavailable");
  const rendered = method.call(app, state);
  if (rendered === null) throw new Error("Expected a rendered session tree navigator");
  return rendered;
}

function appSessionController(app: PiWebApp): SessionController {
  const controller: unknown = Reflect.get(app, "sessions");
  if (!(controller instanceof SessionController)) throw new Error("PiWebApp SessionController was unavailable");
  return controller;
}

function navigatorNavigateHandler(template: TemplateResult): NavigateHandler {
  const value = templateValueAfterMarker(template, ".onNavigate=");
  if (!isNavigateHandler(value)) throw new Error("Session tree navigate callback was unavailable");
  return value;
}

function navigatorForkHandler(template: TemplateResult): ForkHandler {
  const value = templateValueAfterMarker(template, ".onFork=");
  if (!isForkHandler(value)) throw new Error("Session tree fork callback was unavailable");
  return value;
}

function navigatorAbortHandler(template: TemplateResult): AbortHandler {
  const value = templateValueAfterMarker(template, ".onAbort=");
  if (!isAbortHandler(value)) throw new Error("Session tree abort callback was unavailable");
  return value;
}

function navigatorCancelHandler(template: TemplateResult): CancelHandler {
  const value = templateValueAfterMarker(template, ".onCancel=");
  if (!isCancelHandler(value)) throw new Error("Session tree cancel callback was unavailable");
  return value;
}

function isRenderSessionTreeNavigator(value: unknown): value is RenderSessionTreeNavigator {
  return typeof value === "function";
}

function isNavigateHandler(value: unknown): value is NavigateHandler {
  return typeof value === "function";
}

function isForkHandler(value: unknown): value is ForkHandler {
  return typeof value === "function";
}

function isAbortHandler(value: unknown): value is AbortHandler {
  return typeof value === "function";
}

function isCancelHandler(value: unknown): value is CancelHandler {
  return typeof value === "function";
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function tree(): SessionTreeSnapshot {
  return {
    nodes: [
      { id: "root", parentId: null, kind: "user", summary: "Initial prompt" },
      { id: "side", parentId: "root", kind: "assistant", summary: "Side branch" },
    ],
    activeLeafId: "side",
    activePathIds: ["root", "side"],
  };
}
