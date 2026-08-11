import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, Project, SessionInfo, SessionUnreadEvent, SessionUnreadSummary, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import type { BrowserRealtimeEvent } from "../sessionSocket";
import type { UnreadPresence } from "../unreadPresence";
import type { AppMobileMainTab } from "./appShell/AppMobileMainTabs";
// Template inspection is proportionate here because this node-environment test
// verifies only PiWebApp's unread-state property wiring into navigation.
import { templateValueAfterMarker } from "../templateInspection.testSupport";
import { PiWebApp } from "./PiWebApp";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp session unread wiring", () => {
  it("shows a server completion for a background chat and acknowledges the exact observed order when viewed", async () => {
    const fetchMock = stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const foreground = session("foreground");
    const background = session("background");
    setAppState(app, { ...initialAppState(), sessions: [foreground, background], selectedSession: foreground, mainView: "chat" });
    exposeSelectedChat(app);

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(background, 1)));
    expect([...navigationUnreadSessionIds(app)]).toEqual([background.id]);
    expect(mobileNavigationTab(app)).toMatchObject({ badge: 1, badgeLabel: "1 unread", badgeTone: "unread" });

    setState(app, { selectedSession: background });
    // Selection alone cannot clear unread before the new transcript is ready
    // and Lit has committed the corresponding chat.
    expect([...navigationUnreadSessionIds(app)]).toEqual([background.id]);
    expect(fetchMock).not.toHaveBeenCalled();
    exposeSelectedChat(app);
    await vi.waitFor(() => { expect(navigationUnreadSessionIds(app).size).toBe(0); });
    expect(mobileNavigationTab(app)).not.toHaveProperty("badge");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://pi.example.test/api/machines/local/sessions/background/unread/acknowledge");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toEqual({
      cwd: "/repo",
      catalogId: "catalog-a",
      throughCompletionOrder: 1,
    });
  });

  it("keeps the selected chat unread until its one-shot reading target is applied", async () => {
    const fetchMock = stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const foreground = session("foreground");
    const background = session("background");
    setAppState(app, { ...initialAppState(), sessions: [foreground, background], selectedSession: foreground, mainView: "chat" });
    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(background, 1)));

    const identity = JSON.stringify(["local", background.id, background.cwd]);
    const target = { kind: "latest-response" as const, id: "reading-target-1" };
    if (!Reflect.set(app, "pendingChatReadingTarget", { seq: 1, identity, target })) throw new Error("Could not install reading target");
    setState(app, { selectedSession: background });
    exposeSelectedChat(app);

    expect(fetchMock).not.toHaveBeenCalled();
    applyInitialReadingTarget(app, target);
    await vi.waitFor(() => { expect(navigationUnreadSessionIds(app).size).toBe(0); });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps the selected chat unread while hidden or unfocused, then acknowledges on a visible focus check", async () => {
    const fetchMock = stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const documentState = { visible: false, focused: false };
    vi.stubGlobal("document", {
      baseURI: "https://pi.example.test/",
      get visibilityState() { return documentState.visible ? "visible" : "hidden"; },
      hasFocus: () => documentState.focused,
    });
    const app = createApp();
    enableUnread(app);
    const selected = session("selected");
    setAppState(app, { ...initialAppState(), sessions: [selected], selectedSession: selected, mainView: "chat" });
    exposeSelectedChat(app);

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(selected, 1)));
    expect([...navigationUnreadSessionIds(app)]).toEqual([selected.id]);
    expect(fetchMock).not.toHaveBeenCalled();

    documentState.visible = true;
    documentState.focused = true;
    setState(app, { error: "refresh" });
    invokeUpdated(app);
    await vi.waitFor(() => { expect(navigationUnreadSessionIds(app).size).toBe(0); });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps a focused mobile chat unread while navigation is stacked over it, then acknowledges on a layout-only reveal", async () => {
    const fetchMock = stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp({}, true);
    enableUnread(app);
    const selected = session("selected");
    setAppState(app, { ...initialAppState(), sessions: [selected], selectedSession: selected, mainView: "navigation" });
    exposeSelectedChat(app);

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(selected, 1)));
    expect([...navigationUnreadSessionIds(app)]).toEqual([selected.id]);
    expect(fetchMock).not.toHaveBeenCalled();

    setMobileNavigationLayout(app, false);
    invokeUpdated(app);
    await vi.waitFor(() => { expect(navigationUnreadSessionIds(app).size).toBe(0); });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not acknowledge a selected chat hidden behind the rendered-modal boundary", async () => {
    const fetchMock = stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    let modalOpen = true;
    if (!Reflect.set(app, "isRenderedModalOpen", () => modalOpen)) throw new Error("Could not control the rendered-modal boundary");
    enableUnread(app);
    const selected = session("selected");
    setAppState(app, { ...initialAppState(), sessions: [selected], selectedSession: selected, mainView: "chat" });
    exposeSelectedChat(app);

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(selected, 1)));
    expect([...navigationUnreadSessionIds(app)]).toEqual([selected.id]);
    expect(fetchMock).not.toHaveBeenCalled();

    modalOpen = false;
    invokeUpdated(app);
    await vi.waitFor(() => { expect(navigationUnreadSessionIds(app).size).toBe(0); });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("applies another client's authoritative clear without issuing a redundant acknowledgement", () => {
    const fetchMock = stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const foreground = session("foreground");
    const background = session("background");
    setAppState(app, { ...initialAppState(), sessions: [foreground, background], selectedSession: foreground, mainView: "chat" });
    exposeSelectedChat(app);

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(background, 1)));
    handleRealtimeEvent(app, unreadEvent(2, null, background));

    expect(navigationUnreadSessionIds(app).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the durable server snapshot when the machine list loads", async () => {
    const background = session("background");
    const durable = { catalogId: "catalog-a", catalogRevision: 1, sessions: [unreadSummary(background, 1)] };
    const fetchMock = stubJsonFetch(durable);
    const app = createApp();
    enableUnread(app);
    const foreground = session("foreground");
    const localMachine = machine("local");
    setAppState(app, {
      ...initialAppState(),
      selectedMachine: localMachine,
      sessions: [foreground, background],
      selectedSession: foreground,
      mainView: "chat",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    setState(app, { machines: [localMachine] });
    await vi.waitFor(() => { expect([...navigationUnreadSessionIds(app)]).toEqual([background.id]); });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://pi.example.test/api/machines/local/sessions/unread");
  });

  it("drops a deferred unread snapshot on disconnect without acknowledging it", async () => {
    const response = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      void input;
      return response.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    const app = createApp();
    enableUnread(app);
    const selected = session("selected");
    setAppState(app, { ...initialAppState(), sessions: [selected], selectedSession: selected, mainView: "chat" });
    exposeSelectedChat(app);

    const refreshing = refreshUnread(app, "local");
    invokeDisconnected(app);
    response.resolve(new Response(JSON.stringify({
      catalogId: "catalog-a",
      catalogRevision: 1,
      sessions: [unreadSummary(selected, 1)],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await refreshing;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://pi.example.test/api/machines/local/sessions/unread");
  });

  it("does not treat the legacy browser-local key as unread authority", () => {
    const app = createApp({ "pi-web-session-unread-v1": JSON.stringify([["local", "background"]]) });
    const foreground = session("foreground");
    const background = session("background");
    setAppState(app, { ...initialAppState(), sessions: [foreground, background], selectedSession: foreground, mainView: "chat" });

    expect(navigationUnreadSessionIds(app).size).toBe(0);
  });

  it("passes unreadSessionIds to the navigation panel so the inbox board classifies unread sessions", () => {
    // The old explicit mark-read buttons in SessionList are replaced by the inbox
    // board. Unread acknowledgement now happens automatically when a session is
    // selected (isSessionSeen gate). This test guards that the unread session ids
    // flow into the navigation panel so the board can colour rows correctly.
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const selected = session("selected");
    const alpha = session("alpha");
    setAppState(app, { ...initialAppState(), sessions: [selected, alpha], selectedSession: selected, mainView: "chat" });

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(alpha, 1)));

    // The unread ids must flow into the navigation panel's inbox.
    const ids = navigationUnreadSessionIds(app);
    expect(ids.has(alpha.id)).toBe(true);
  });

  it("classifies unread sessions from workspaces other than the currently selected one", () => {
    // Gap U6/#1: syncUnreadSessionIds must use globalSessions.sessions, not
    // the workspace-scoped state.sessions. A session in /other-workspace is
    // unread but its cwd is not in state.sessions (which only holds
    // sessions for the selected /repo workspace).
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const selected = session("selected"); // cwd: /repo, in selected workspace
    const background = { ...session("background"), cwd: "/other-workspace" }; // different workspace
    // state.sessions only contains the selected workspace's sessions.
    // globalSessions contains all machine sessions.
    setAppState(app, {
      ...initialAppState(),
      sessions: [selected],
      globalSessions: {
        machineId: "local",
        status: "fresh",
        sessions: [selected, background],
        statuses: {},
        activities: {},
      },
      selectedSession: selected,
      mainView: "chat",
    });

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(background, 1)));

    // background is in a different workspace but must appear as unread.
    const ids = navigationUnreadSessionIds(app);
    expect(ids.has(background.id)).toBe(true);
  });

  it("passes onSelectSession to the navigation panel so inbox row clicks enter the selection cascade", () => {
    // The old onMarkSessionRead/onMarkSessionsRead callbacks are gone because
    // unread is acknowledged implicitly when the session is opened and seen.
    // This guards that the navigation panel receives an onSelectSession callback.
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    const selected = session("selected");
    setAppState(app, { ...initialAppState(), sessions: [selected], selectedSession: selected, mainView: "chat" });

    const onSelectSession = navigationPanelValue(app, ".onSelectSession=");
    expect(typeof onSelectSession).toBe("function");
  });

  it("derives bubble-up unread presence for selected and background machines", () => {
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const selected = session("selected");
    setAppState(app, {
      ...initialAppState(),
      machines: [machine("local"), machine("remote")],
      selectedMachine: machine("local"),
      projects: [project("project-1")],
      workspaces: [workspace("ws-1", "project-1", "/repo")],
      workspacesByProjectId: { "project-1": [workspace("ws-1", "project-1", "/repo")] },
      sessions: [selected],
      selectedSession: selected,
      mainView: "chat",
    });

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(selected, 1)));
    expect([...unreadPresence(app).machines]).toEqual(["local"]);
    expect([...unreadPresence(app).projects]).toEqual(["project-1"]);
    expect([...unreadPresence(app).workspaces]).toEqual(["ws-1"]);

    const remoteSession = { ...session("remote-session"), cwd: "/unmapped" };
    handleMachineActivityEvent(app, "remote", unreadEvent(1, unreadSummary(remoteSession, 1)));
    expect([...unreadPresence(app).machines].sort()).toEqual(["local", "remote"]);
    // Background cwds never leak into the selected machine's workspace/project rows.
    expect([...unreadPresence(app).projects]).toEqual(["project-1"]);
    expect([...unreadPresence(app).workspaces]).toEqual(["ws-1"]);
  });

  it("recomputes bubble-up presence when workspace data loads after the unread event", () => {
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const selected = session("selected");
    setAppState(app, {
      ...initialAppState(),
      machines: [machine("local")],
      selectedMachine: machine("local"),
      sessions: [selected],
      selectedSession: selected,
      mainView: "chat",
    });

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(selected, 1)));
    expect([...unreadPresence(app).machines]).toEqual(["local"]);
    expect(unreadPresence(app).projects.size).toBe(0);
    expect(unreadPresence(app).workspaces.size).toBe(0);

    setState(app, {
      projects: [project("project-1")],
      workspaces: [workspace("ws-1", "project-1", "/repo")],
      workspacesByProjectId: { "project-1": [workspace("ws-1", "project-1", "/repo")] },
    });
    expect([...unreadPresence(app).projects]).toEqual(["project-1"]);
    expect([...unreadPresence(app).workspaces]).toEqual(["ws-1"]);
  });

  it("binds the derived unread presence into the navigation panel", () => {
    stubJsonFetch({ catalogId: "catalog-a", catalogRevision: 2, sessions: [] });
    const app = createApp();
    enableUnread(app);
    const selected = session("selected");
    setAppState(app, {
      ...initialAppState(),
      machines: [machine("local")],
      selectedMachine: machine("local"),
      sessions: [selected],
      selectedSession: selected,
      mainView: "chat",
    });

    handleRealtimeEvent(app, unreadEvent(1, unreadSummary(selected, 1)));

    const bound = navigationPanelValue(app, ".unreadPresence=");
    if (!isUnreadPresence(bound)) throw new Error("Expected unread presence in navigation");
    expect(bound).toBe(unreadPresence(app));
    expect([...bound.machines]).toEqual(["local"]);
  });
});

type RenderNavigationPanel = (this: PiWebApp) => TemplateResult;
type SetAppState = (this: PiWebApp, patch: Partial<AppState>) => void;
type HandleRealtimeEvent = (this: PiWebApp, machineId: string, event: BrowserRealtimeEvent) => void;
type HandleMachineActivityEvent = (this: PiWebApp, machineId: string, event: BrowserRealtimeEvent) => void;
type MobileMainTabs = (this: PiWebApp) => AppMobileMainTab[];
type UpdatedHook = (this: PiWebApp) => void;
type DisconnectedHook = (this: PiWebApp) => void;
type RefreshUnread = (machineId: string) => Promise<void>;

function createApp(storedValues: Record<string, string> = {}, mobileNavigation = false): PiWebApp {
  const values = new Map(Object.entries(storedValues));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const matchMedia = (query: string) => ({
    matches: mobileNavigation && query.includes("max-width: 760px"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  vi.stubGlobal("window", {
    location: { search: "" },
    localStorage: storage,
    matchMedia,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    clearInterval: () => undefined,
    clearTimeout: () => undefined,
  });
  if (typeof document === "undefined") {
    vi.stubGlobal("document", { baseURI: "https://pi.example.test/", visibilityState: "visible", hasFocus: () => true });
  }
  vi.stubGlobal("requestAnimationFrame", () => 1);
  return new PiWebApp();
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function setState(app: PiWebApp, patch: Partial<AppState>): void {
  const method: unknown = Reflect.get(app, "setState");
  if (!isSetAppState(method)) throw new Error("PiWebApp.setState is not callable");
  method.call(app, patch);
}

function handleRealtimeEvent(app: PiWebApp, event: BrowserRealtimeEvent): void {
  const method: unknown = Reflect.get(app, "handleRealtimeEvent");
  if (!isHandleRealtimeEvent(method)) throw new Error("PiWebApp.handleRealtimeEvent is not callable");
  method.call(app, "local", event);
}

function handleMachineActivityEvent(app: PiWebApp, machineId: string, event: BrowserRealtimeEvent): void {
  const method: unknown = Reflect.get(app, "handleMachineActivityEvent");
  if (!isHandleMachineActivityEvent(method)) throw new Error("PiWebApp.handleMachineActivityEvent is not callable");
  method.call(app, machineId, event);
}

function enableUnread(app: PiWebApp): void {
  if (!Reflect.set(app, "unreadConnected", true)) throw new Error("Could not connect PiWebApp unread state");
}

function exposeSelectedChat(app: PiWebApp): void {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("PiWebApp state is unavailable");
  const selectedSession: unknown = Reflect.get(state, "selectedSession");
  if (typeof selectedSession !== "object" || selectedSession === null) throw new Error("Expected a selected chat");
  const sessionId: unknown = Reflect.get(selectedSession, "id");
  const cwd: unknown = Reflect.get(selectedSession, "cwd");
  if (typeof sessionId !== "string" || typeof cwd !== "string") throw new Error("Selected chat identity is invalid");
  const selectedMachine: unknown = Reflect.get(state, "selectedMachine");
  const machineId = typeof selectedMachine === "object" && selectedMachine !== null && typeof Reflect.get(selectedMachine, "id") === "string"
    ? String(Reflect.get(selectedMachine, "id"))
    : "local";
  if (!Reflect.set(app, "readyChatIdentity", JSON.stringify([machineId, sessionId, cwd]))) {
    throw new Error("Could not mark selected chat ready");
  }
  invokeUpdated(app);
}

function applyInitialReadingTarget(app: PiWebApp, target: { readonly kind: "latest-response"; readonly id: string }): void {
  const handler: unknown = Reflect.get(app, "handleInitialReadingTargetApplied");
  if (typeof handler !== "function") throw new Error("Initial reading target handler is unavailable");
  Reflect.apply(handler, app, [target]);
}

function setMobileNavigationLayout(app: PiWebApp, mobile: boolean): void {
  const appShell: unknown = Reflect.get(app, "appShell");
  if (typeof appShell !== "object" || appShell === null || !Reflect.set(appShell, "layoutMode", mobile ? "overlay" : "docked")) {
    throw new Error("Could not update the app-shell layout");
  }
}

function invokeUpdated(app: PiWebApp): void {
  const method: unknown = Reflect.get(app, "updated");
  if (!isUpdatedHook(method)) throw new Error("PiWebApp.updated is not callable");
  method.call(app);
}

function invokeDisconnected(app: PiWebApp): void {
  const method: unknown = Reflect.get(app, "disconnectedCallback");
  if (!isDisconnectedHook(method)) throw new Error("PiWebApp.disconnectedCallback is not callable");
  method.call(app);
}

function refreshUnread(app: PiWebApp, machineId: string): Promise<void> {
  const controller: unknown = Reflect.get(app, "sessionUnread");
  if (typeof controller !== "object" || controller === null) throw new Error("PiWebApp unread controller is unavailable");
  const refresh: unknown = Reflect.get(controller, "refresh");
  if (!isRefreshUnread(refresh)) throw new Error("PiWebApp unread refresh is not callable");
  return refresh.call(controller, machineId);
}

function mobileNavigationTab(app: PiWebApp): AppMobileMainTab {
  const method: unknown = Reflect.get(app, "mobileMainTabs");
  if (!isMobileMainTabs(method)) throw new Error("PiWebApp.mobileMainTabs is not callable");
  const tab = method.call(app).find((candidate) => candidate.id === "navigation");
  if (tab === undefined) throw new Error("Expected the mobile Sessions tab");
  return tab;
}

function navigationUnreadSessionIds(app: PiWebApp): ReadonlySet<string> {
  const value = navigationPanelValue(app, ".unreadSessionIds=");
  if (!(value instanceof Set) || ![...value].every((entry: unknown) => typeof entry === "string")) {
    throw new Error("Expected unread session ids in navigation");
  }
  return value;
}

// navigationMarkSessionRead and navigationMarkSessionsRead removed:
// the inbox board acknowledges unread implicitly via session selection,
// so explicit mark-read callbacks are no longer wired to the nav panel.

function navigationPanelValue(app: PiWebApp, marker: string): unknown {
  const method: unknown = Reflect.get(app, "renderNavigationPanel");
  if (!isRenderNavigationPanel(method)) throw new Error("PiWebApp.renderNavigationPanel is not callable");
  return templateValueAfterMarker(method.call(app), marker);
}

function unreadPresence(app: PiWebApp): UnreadPresence {
  const value: unknown = Reflect.get(app, "unreadPresence");
  if (!isUnreadPresence(value)) throw new Error("Expected derived unread presence on PiWebApp");
  return value;
}

function isUnreadPresence(value: unknown): value is UnreadPresence {
  if (typeof value !== "object" || value === null) return false;
  return Reflect.get(value, "machines") instanceof Set
    && Reflect.get(value, "projects") instanceof Set
    && Reflect.get(value, "workspaces") instanceof Set;
}

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  };
}

function project(id: string): Project {
  return { id, name: id, path: "/repo", createdAt: "2026-07-20T00:00:00.000Z" };
}

function workspace(id: string, projectId: string, path: string): Workspace {
  return { id, projectId, path, label: id, isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} };
}

function session(id: string): SessionInfo {
  return {
    id,
    cwd: "/repo",
    path: `/repo/${id}.jsonl`,
    created: "2026-07-20T00:00:00.000Z",
    modified: "2026-07-20T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
  };
}

function unreadSummary(target: SessionInfo, completionOrder: number): SessionUnreadSummary {
  return {
    sessionId: target.id,
    cwd: target.cwd,
    completionOrder,
    completedAt: `2026-07-20T00:00:0${String(completionOrder)}.000Z`,
  };
}

function unreadEvent(
  catalogRevision: number,
  unread: SessionUnreadSummary | null,
  target: SessionInfo = unread === null ? session("selected") : session(unread.sessionId),
): SessionUnreadEvent {
  return {
    type: "sessions.unread",
    catalogId: "catalog-a",
    catalogRevision,
    sessionId: unread?.sessionId ?? target.id,
    cwd: unread?.cwd ?? target.cwd,
    unread,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) throw new Error("Deferred promise is unavailable");
      resolvePromise(value);
    },
  };
}

function stubJsonFetch(body: unknown) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function isRenderNavigationPanel(value: unknown): value is RenderNavigationPanel {
  return typeof value === "function";
}

function isSetAppState(value: unknown): value is SetAppState {
  return typeof value === "function";
}

function isHandleRealtimeEvent(value: unknown): value is HandleRealtimeEvent {
  return typeof value === "function";
}

function isHandleMachineActivityEvent(value: unknown): value is HandleMachineActivityEvent {
  return typeof value === "function";
}

function isMobileMainTabs(value: unknown): value is MobileMainTabs {
  return typeof value === "function";
}

function isUpdatedHook(value: unknown): value is UpdatedHook {
  return typeof value === "function";
}

function isDisconnectedHook(value: unknown): value is DisconnectedHook {
  return typeof value === "function";
}

function isRefreshUnread(value: unknown): value is RefreshUnread {
  return typeof value === "function";
}
