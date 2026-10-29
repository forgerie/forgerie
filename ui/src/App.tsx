import { createSessionRegistry, type SessionRegistry } from "./sessionRegistry";
import { createSessionPrefetch } from "./sessionPrefetch";
import { browserTransport } from "./sessionStore";
import { Activity, lazy, Suspense, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { RelatedWorkRenderer } from "./projectGroups/relatedWork";
import type { ResourceLensRenderer } from "./resources/resourceLens";
import type { SettingsPageRenderer } from "./ui/settings/SettingsView";
import type { ModelChainsRenderer } from "./ui/settings/ModelsView";
import { ForgerieSession } from "./ForgerieSession";
import { usePicker, type StartingSession } from "./usePicker";
import type { Row } from "./picker/board";
import type { Session } from "./contracts";
import { AppShell } from "./ui/AppShell";
import { useFullscreen } from "./ui/useFullscreen";
import { Picker, PickerToast, type PickerFilter, type PickerSearch } from "./ui/Picker";
import { SessionFrame } from "./ui/SessionFrame";
import { StatusChip } from "./ui/StatusChip";
import { StatusDetail } from "./session/StatusDetail";
import { browserStorage, createDraftStore } from "./draftStore";
import type { PendingSessionRecovery } from "./app/PendingSession.binding";
import { NewSession, type LaunchDraft, type LaunchMode, type Placement } from "./NewSession";
import { createWorktreeApi, type WorktreeApi, type WorktreeRecord } from "./worktrees/worktreeApi";
import { createDeferredFiles, createNewSessionApi, defaultDestinationCwd, newStartupToken, type NewSessionApi, type Project } from "./newSession";
import { Toast } from "./ui/Toast";
import { createLaunchStore, type Launch, type StartupListener, type WorktreeListener } from "./launches";
import { newSessionShortcut, searchShortcut } from "./shortcuts";
import type { SessionSearch } from "./search/useSessionSearch";
import type { SearchHit } from "./search/searchApi";
import { queryMode, resultsView } from "./search/searchModel";
import { foundBinding } from "./search/found";
import { SEARCH_KEYS, SearchBox, searchHint } from "./search/SearchBox";
import { SearchResults } from "./search/SearchResults";
import { readTarget, targetParam, type SettingsPlace } from "./agents/agentPlace";
import { createBacklogApi, type BacklogItem } from "./backlog/backlogApi";
import { createSuggestionsApi, type Suggestion } from "./backlog/suggestions/suggestionsApi";
import { createSuggestionsStore } from "./backlog/suggestions/suggestionsStore";
import { filedItemOf, isOpen as suggestionWaits } from "./backlog/suggestions/suggestionsModel";
import { SuggestedInChats } from "./backlog/suggestions/SuggestedInChats";
import { heldSessions, itemParam, launchFolder, listOf, openCount, readBacklogPlace, readItemParam, refOf, type BacklogPlace } from "./backlog/backlogModel";
import { createGitHubApi, readSetupReturn, submitToGitHub } from "./backlog/githubApi";
import type { GitHubAppPage } from "./backlog/useGitHubApp";
import { useBacklogList } from "./backlog/useBacklogList";
import { appPluginStore } from "./plugins/appPluginStates";
import { readTriggersPlace, TRIGGER_PARAMS, writeTriggersPlace, type TriggerPlace, type TriggersSlot } from "./triggers/triggersModel";
// Settings carry the prompt editor; the chat never pays for it.
const SettingsView = lazy(() => import("./ui/settings/SettingsView").then((module) => ({ default: module.SettingsView })));
// The backlog renders item files as documents; the chat never pays for it either.
const BacklogView = lazy(() => import("./ui/backlog/BacklogView").then((module) => ({ default: module.BacklogView })));

const readSelected = () => new URLSearchParams(window.location.search).get("session")?.trim() || undefined;
// A browser-local launch token is never a server session ID.
const readLaunch = () => new URLSearchParams(window.location.search).get("launch") || undefined;
/**
 * `?new=<folder>` keeps the new-session dialog open across a reload, over whatever is open. `?new=&item=…` is a
 * backlog item with no destination yet: the dialog opens with no folder, and the author picks one.
 */
const readNew = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get("new")?.trim() || (params.has("new") && params.has("item") ? "" : undefined);
};
/** `&place=existing` keeps an explicit "this folder, not a new worktree" across a reload. Absent: the default. */
const readPlace = (): Placement | undefined => { const place = new URLSearchParams(window.location.search).get("place"); return place === "existing" || place === "fresh" ? place : undefined; };
/** `?settings=<section>&agent=<target>` keeps a settings page open across a reload. */
const readSettings = (): SettingsPlace | undefined => {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("settings");
  if (section === null) return undefined;
  if (section === "agents") return { section, agent: readTarget(params.get("agent") ?? undefined) };
  if (section === "backlog") return { section, project: params.get("project") ?? undefined };
  if (section === "models") return { section };
  if (section === "projects") return { section, group: params.get("group") ?? undefined };
  if (section === "resources") return { section, resource: params.get("resource") ?? undefined };
  return section === "plugins" ? { section, plugin: params.get("plugin") ?? undefined } : { section: "root" };
};
/** `?backlog` keeps the backlog open across a reload; `?backlog=<projectId>/<itemId>` keeps one item open. */
const readBacklog = () => readBacklogPlace(new URLSearchParams(window.location.search));
/** `?triggers` keeps the triggers open across a reload; `?triggers=<id>` one trigger, `?triggers&create` a new one. */
const readTriggers = () => readTriggersPlace(new URLSearchParams(window.location.search));
/** `&item=<projectId>/<itemId>` or `&item=source:<sourceId>/<itemId>` keeps a backlog item riding with the new-session dialog across a reload. */
const readItem = () => { const ref = readItemParam(new URLSearchParams(window.location.search).get("item")); return ref ? { ...ref, scope: new URLSearchParams(window.location.search).get("itemScope") === "everyone" ? "everyone" as const : "mine" as const } : undefined; };
/** Settings, the backlog, and the triggers all take the thread's place, so opening one closes the others. */
const clearSettings = (url: URL) => {
  url.searchParams.delete("settings"); url.searchParams.delete("agent"); url.searchParams.delete("plugin"); url.searchParams.delete("group"); url.searchParams.delete("backlog"); url.searchParams.delete("project");
  for (const param of TRIGGER_PARAMS) url.searchParams.delete(param);
};
const defaultNewSessionApi = createNewSessionApi((path, init) => fetch(path, init));
const defaultWorktreeApi = createWorktreeApi((path, init) => fetch(path, init));
const backlogApi = createBacklogApi((path, init) => fetch(path, init));
const suggestionsApi = createSuggestionsApi((path, init) => fetch(path, init));
const githubApi = createGitHubApi((path, init) => fetch(path, init));
/** GitHub returns from creating the app to this page's root; the backlog finishes the setup. */
const githubPage: GitHubAppPage = {
  origin: window.location.origin,
  setupReturn: () => readSetupReturn(window.location.search),
  clearSetupReturn: () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("code"); url.searchParams.delete("state");
    window.history.replaceState(window.history.state, "", url);
  },
  submit: (setup) => submitToGitHub(setup),
};
/** The backlog opens on GitHub's return, because that is where the setup finishes. */
const readBacklogOrSetup = () => readBacklog() ?? (readSetupReturn(window.location.search) ? {} : undefined);
/**
 * Marks the history entry this page load pushed for the dialog, so closing it
 * steps back instead of piling up entries. Per load: after a reload the browser
 * keeps the old mark, and stepping back to it would reload the page again.
 */
const DIALOG_ENTRY = { newSession: newStartupToken() };

/** Composition root: owns the selected session (in the URL), the sheet, and sessions being started. */
/**
 * `shelves`: plugin shelves for the foot of the session list. The entry passes their binding in.
 * `projectFilter` offers project groups and ungrouped projects in the session list's ⋯ menu; the app adds the way to Settings → Project groups.
 * `projectSettings` draws Settings → Project groups.
 * `resourceSettings` draws Settings → Skills and prompts; `resourceLens` draws a session's own.
 * `search` is session search, held by the binding above this app so its query and hits outlive every layout.
 * `triggers` is the triggers screen and its entry at the foot of the session list, held by the binding above this app.
 */
export function App({ shelves, projectScope, projectCatalog, projectFilter, projectSettings, relatedWork, resourceSettings, resourceLens, search, triggers, backlogSettings, modelChains, newSessions, pendingSession }: {
  /** The launch's read-only transcript, supplied by the app binding, never a server session transport. */
  pendingSession?: ((launch: Launch<LaunchDraft>, recovery: PendingSessionRecovery) => ReactNode) | undefined;
  /** Production and fixture launches use the same app-owned lifecycle. */
  newSessions?: { api: NewSessionApi; worktrees: WorktreeApi };
  search?: SessionSearch | undefined; triggers?: TriggersSlot | undefined;
  shelves?: ReactNode; projectCatalog?: readonly Project[] | undefined; projectScope?: readonly string[] | undefined;
  backlogSettings?: SettingsPageRenderer | undefined;
  /** Settings → Models → Model chains. */
  modelChains?: ModelChainsRenderer | undefined;
  projectFilter?: Omit<PickerFilter, "onManage"> | undefined; projectSettings?: SettingsPageRenderer | undefined; relatedWork?: RelatedWorkRenderer | undefined;
  resourceSettings?: SettingsPageRenderer | undefined; resourceLens?: ResourceLensRenderer | undefined;
} = {}) {
  const newSessionApi = newSessions?.api ?? defaultNewSessionApi;
  const worktreeApi = newSessions?.worktrees ?? defaultWorktreeApi;
  const registryRef = useRef<SessionRegistry | undefined>(undefined);
  const [selectedId, setSelectedId] = useState(readSelected);
  const [selectedLaunch, setSelectedLaunch] = useState(readLaunch);
  const [commandSelection, setCommandSelection] = useState<{ session: Session; draft?: string; error?: string }>();
  // The new-session dialog: the folder it starts in, over the open session.
  const [composing, setComposing] = useState(readNew);
  const [composeRestore, setComposeRestore] = useState<Launch<LaunchDraft>>();
  const [composeMode, setComposeMode] = useState<LaunchMode>("switch");
  const [settings, setSettings] = useState(readSettings);
  const [backlog, setBacklog] = useState(readBacklogOrSetup);
  const [triggerPlace, setTriggerPlace] = useState<TriggerPlace | undefined>(readTriggers);
  // The backlog item riding with the new-session dialog.
  const [composeItem, setComposeItem] = useState(readItem);
  const backlogList = useBacklogList(backlogApi);
  const { scope: backlogScope, setScope: setBacklogScope } = backlogList;
  const backlogItems = listOf(backlogList.load)?.items;
  // Bumped when the dialog opens, so moving its destination never remounts it.
  const [composeKey, setComposeKey] = useState(0);
  // Unsent drafts outlive a session switch and a reload, in this browser only.
  const [drafts] = useState(() => createDraftStore(browserStorage()));
  const fullscreen = useFullscreen();
  // Starts outlive the dialog. Their progress arrives on the picker's event socket.
  const [startup] = useState(() => {
    const listeners = new Set<StartupListener>();
    return { emit: ((event) => { for (const listener of listeners) listener(event); }) as StartupListener,
      on: (listener: StartupListener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  });
  // Worktree setup progress arrives on the same socket, labelled with the same startup token.
  const [worktreeEvents] = useState(() => {
    const listeners = new Set<WorktreeListener>();
    return { emit: (record: WorktreeRecord) => { for (const listener of listeners) listener(record); },
      on: (listener: WorktreeListener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  });
  const [launches] = useState(() => createLaunchStore<LaunchDraft>(newSessionApi, { onStartup: startup.on, onWorktree: worktreeEvents.on, setupDraft: () => ({ text: "", attachments: [] }),
    findWorktree: async (token, cwd) => (await worktreeApi.list(cwd)).find((record) => record.startupToken === token) }));
  // Files wait here until their session exists, for every window, so "Put back" always finds them.
  const [deferred] = useState(() => createDeferredFiles());
  const launchList = useSyncExternalStore(launches.subscribe, launches.getSnapshot);
  const starting = useMemo<StartingSession[]>(() => launchList.filter((launch) => launch.state.type === "starting" || launch.state.type === "failed")
    .map((launch) => ({ id: launch.id, cwd: launch.cwd, title: launch.title, startedAt: launch.startedAt,
      sessionId: launch.state.type === "starting" ? launch.state.sessionId : undefined, failed: launch.state.type === "failed" })), [launchList]);
  // A reload during any start could leave a session without its first message.
  const inFlight = starting.some((item) => !item.failed);
  useEffect(() => {
    if (!inFlight) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inFlight]);
  // With nothing selected there is nothing to cover, so the sheet starts open.
  const [open, setOpen] = useState(() => readSelected() === undefined && readNew() === undefined && readSettings() === undefined && readBacklogOrSetup() === undefined
    && readTriggers() === undefined);
  // A deleted session cannot stay open: its thread has nothing left to load.
  // The URL is the source of truth for the selection, so read it there.
  const closeSession = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    window.history.replaceState({}, "", url);
    setSelectedId(undefined);
    setCommandSelection(undefined);
  }, []);
  const onDeleted = useCallback((id: string) => {
    drafts.forget(id); registryRef.current?.forget(id);
    if (readSelected() === id) closeSession();
  }, [drafts, closeSession]);
  const query = search?.state.query ?? "";
  const mode = queryMode(query);
  const picker = usePicker(selectedId, { onDeleted, starting, projectScope, projectCatalog, titleFilter: mode === "title" ? query : undefined });
  const { onStartup, onWorktree, onTriggersChanged, onSuggestionsChanged } = picker;
  const [registry] = useState(() => createSessionRegistry(browserTransport, { onUnread: picker.onUnread }));
  registryRef.current = registry;
  const kept = useSyncExternalStore(registry.subscribe, registry.getSnapshot);
  const [prefetch] = useState(() => createSessionPrefetch(registry));
  useEffect(() => () => { prefetch.dispose(); registry.dispose(); }, [registry, prefetch]);
  useEffect(() => {
    prefetch.idle(picker.view.sections.flatMap(section => section.rows));
    const pause = () => { if (document.visibilityState !== "visible" || !navigator.onLine) prefetch.pause(); };
    document.addEventListener("visibilitychange", pause); window.addEventListener("offline", pause);
    return () => { prefetch.pause(); document.removeEventListener("visibilitychange", pause); window.removeEventListener("offline", pause); };
  }, [prefetch, picker.view.sections]);
  useEffect(() => onStartup(startup.emit), [onStartup, startup]);
  const triggersChanged = triggers?.onChanged;
  useEffect(() => triggersChanged ? onTriggersChanged(triggersChanged) : undefined, [onTriggersChanged, triggersChanged]);
  useEffect(() => onWorktree(worktreeEvents.emit), [onWorktree, worktreeEvents]);
  // Every chat's suggestions, for the Backlog view's "Suggested in chats". Each open chat keeps its own.
  const [everySuggestion] = useState(() => createSuggestionsStore(suggestionsApi, () => ({})));
  useEffect(() => () => everySuggestion.dispose(), [everySuggestion]);
  const suggested = useSyncExternalStore(everySuggestion.subscribe, everySuggestion.getSnapshot);
  // A suggestion changed: the chat it belongs to reads its own again (every chat after a rejoin), and so does the Backlog view.
  useEffect(() => onSuggestionsChanged((change) => {
    for (const record of registry.getSnapshot()) if (change.sessionId === undefined || record.entry.session.id === change.sessionId) record.entry.suggestionsChanged();
    if (readBacklog() !== undefined) void everySuggestion.refresh();
  }), [onSuggestionsChanged, registry, everySuggestion]);
  /** Show in chat: the chat opens with the card in view. A new key asks again for the same card. */
  const [shownSuggestion, setShownSuggestion] = useState<{ sessionId: string; suggestionId: string; key: number }>();
  useEffect(() => () => launches.dispose(), [launches]);
  useEffect(() => {
    const onPop = () => { setCommandSelection(undefined); setSelectedId(readSelected()); setSelectedLaunch(readLaunch()); setComposing(readNew()); setComposeItem(readItem()); setSettings(readSettings()); setBacklog(readBacklog()); setTriggerPlace(readTriggers()); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  /** Close the dialog. Back would do the same when this app opened it. */
  const closeComposer = useCallback(() => {
    if (readNew() === undefined) { setComposing(undefined); return; }
    const pushed = (window.history.state as Partial<typeof DIALOG_ENTRY> | null)?.newSession === DIALOG_ENTRY.newSession;
    if (pushed) { window.history.back(); return; }
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    url.searchParams.delete("item");
    url.searchParams.delete("itemScope");
    window.history.replaceState({}, "", url);
    setComposing(undefined);
    setComposeItem(undefined);
  }, []);
  /** The author took the item off the new session. The dialog stays. */
  const dropComposeItem = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("item");
    url.searchParams.delete("itemScope");
    window.history.replaceState(window.history.state, "", url);
    setComposeItem(undefined);
  }, []);
  const switchSession = useCallback((session: Session, draft?: string, error?: string) => {
    registryRef.current?.select(session);
    setOpen(false);
    const fromComposer = readNew() !== undefined || readLaunch() !== undefined;
    setSelectedLaunch(undefined);
    setComposing(undefined);
    setComposeItem(undefined);
    setCommandSelection({ session, draft, ...(error ? { error } : {}) });
    const inSettings = readSettings() !== undefined || readBacklog() !== undefined || readTriggers() !== undefined;
    setSettings(undefined);
    setBacklog(undefined);
    setTriggerPlace(undefined);
    if (session.id === selectedId && !fromComposer && !inSettings) return;
    const url = new URL(window.location.href);
    clearSettings(url);
    url.searchParams.delete("new");
    url.searchParams.delete("item");
    url.searchParams.delete("itemScope");
    url.searchParams.delete("launch");
    url.searchParams.set("session", session.id);
    // A started session replaces the dialog's entry: Back must not reopen an emptied dialog.
    if (fromComposer) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    setSelectedId(session.id);
  }, [selectedId]);
  // The launch store owns progress and failure after the dialog unmounts.
  const launchOptimistically = useCallback((id: string) => {
    const url = new URL(window.location.href);
    clearSettings(url);
    for (const param of ["session", "new", "item", "itemScope", "place"]) url.searchParams.delete(param);
    url.searchParams.set("launch", id);
    window.history.replaceState({}, "", url);
    setComposing(undefined); setComposeRestore(undefined); setComposeItem(undefined);
    setSelectedId(undefined); setCommandSelection(undefined); setSelectedLaunch(id);
    setSettings(undefined); setBacklog(undefined); setTriggerPlace(undefined); setOpen(false);
  }, []);
  const restoreLaunch = (launch: Launch<LaunchDraft>) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("launch");
    const place = launch.placement.destination?.kind;
    if (place) url.searchParams.set("place", place === "fresh-worktree" ? "fresh" : "existing"); else url.searchParams.delete("place");
    const item = launch.placement.item;
    if (item) url.searchParams.set("item", itemParam(item)); else url.searchParams.delete("item");
    if (item?.scope) url.searchParams.set("itemScope", item.scope); else url.searchParams.delete("itemScope");
    url.searchParams.set("new", launch.cwd);
    window.history.replaceState(DIALOG_ENTRY, "", url);
    setComposeItem(item ? { ...item, scope: item.scope ?? "mine" } : undefined); setComposeRestore(launch); setComposeKey((key) => key + 1);
    setComposing(launch.cwd); setSelectedLaunch(undefined);
  };
  // Returning to a pending history entry after its dialog unmounted resolves that same entry, not a new one.
  useEffect(() => {
    if (!selectedLaunch || composing !== undefined || settings || backlog || triggerPlace) return;
    const launch = launchList.find((item) => item.id === selectedLaunch);
    if (launch?.state.type !== "started" && launch?.state.type !== "unsent") return;
    switchSession(launch.state.session, launch.state.type === "unsent" ? launch.draft.text : undefined,
      launch.state.type === "unsent" ? launch.state.error : undefined);
    launches.take(launch.id);
  }, [selectedLaunch, composing, settings, backlog, triggerPlace, launchList, launches, switchSession]);
  // New session: the dialog starts where the reader is, over whatever is open, and the URL remembers it.
  const { find, recent } = picker;
  // Two quick presses must open one window, not push two history entries.
  const opening = useRef(false);
  const startNew = useCallback(async (mode: LaunchMode = "switch", item?: BacklogItem) => {
    setOpen(false);
    setComposeRestore(undefined);
    if (opening.current) return;
    // A backlog item starts at its destination: its own project, or its source's destination project. A source with
    // no destination opens the dialog with no folder. Over an open dialog, it replaces that dialog's destination and item.
    if (item) {
      const ref = { ...refOf(item), scope: backlogScope };
      opening.current = true;
      const projects = await newSessionApi.projects().catch(() => []).finally(() => { opening.current = false; });
      const cwd = launchFolder(item, projects) ?? "";
      const url = new URL(window.location.href);
      url.searchParams.delete("launch"); setSelectedLaunch(undefined);
      const reopen = readNew() !== undefined;
      url.searchParams.set("new", cwd);
      url.searchParams.delete("place");
      url.searchParams.set("item", itemParam(ref));
      url.searchParams.set("itemScope", ref.scope);
      if (reopen) window.history.replaceState(window.history.state, "", url); else window.history.pushState(DIALOG_ENTRY, "", url);
      setComposeKey((key) => key + 1);
      setComposeMode(mode);
      setComposeItem(ref);
      setComposing(cwd);
      return;
    }
    if (readNew() !== undefined) {
      setComposeMode(mode);
      document.querySelector<HTMLElement>(".ns-dialog [data-composer-input]")?.focus();
      return;
    }
    const current = readSelected();
    // Before the session list loads, or with no sessions yet, Forgerie's projects decide.
    opening.current = true;
    const projects = await newSessionApi.projects().catch(() => []).finally(() => { opening.current = false; });
    const cwd = defaultDestinationCwd(current ? find(current) : undefined, recent, projects);
    setComposeKey((key) => key + 1);
    setComposeMode(mode);
    if (!cwd) { setComposing(""); return; }
    const url = new URL(window.location.href);
    url.searchParams.delete("launch"); setSelectedLaunch(undefined);
    url.searchParams.set("new", cwd);
    url.searchParams.delete("place");
    window.history.pushState(DIALOG_ENTRY, "", url);
    setComposing(cwd);
  }, [find, recent, backlogScope, newSessionApi]);
  // Ctrl+Enter opens the dialog, Ctrl+Shift+Enter opens it in Rapidfire, as in the legacy client.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mode = newSessionShortcut(event);
      if (!mode || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      void startNew(mode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startNew]);
  // A start still in flight: once Pi created the session it opens; before that, the window shows how it goes.
  const found = search?.state.found;
  const closeFound = search?.actions.closeFound;
  const select = useCallback((row: Row) => {
    // A match bar belongs to the hit's session. Opening another session from the list ends it.
    if (found && found.hit.sessionId !== row.session.id) closeFound?.();
    const pending = starting.find((item) => item.id === row.session.id);
    if (pending && pending.id === selectedLaunch) { setOpen(false); return; }
    if (!pending) { switchSession(row.session); return; }
    if (pending.sessionId) switchSession({ id: pending.sessionId, cwd: pending.cwd, name: pending.title });
    else launchOptimistically(pending.id);
  }, [starting, selectedLaunch, launchOptimistically, switchSession, found, closeFound]);
  // A hit opens its session at the matched passage. The query and its hits stay for the next look.
  const openSearch = search?.actions.open;
  const openHit = useCallback((hit: SearchHit) => {
    openSearch?.(hit);
    switchSession({ id: hit.sessionId, cwd: hit.cwd, ...(hit.title ? { name: hit.title } : {}) });
  }, [openSearch, switchSession]);
  // Ctrl+K reaches the search box from anywhere, and `/` from anywhere but a text field. The list opens first,
  // then the box opens in the list's header. Held here, so an open box survives the switch between layouts.
  const searchInput = useRef<HTMLInputElement>(null);
  const resultsList = useRef<HTMLDivElement>(null);
  const [searchFocus, setSearchFocus] = useState(0);
  const [searchAsked, setSearchAsked] = useState(false);
  const searchHintId = useId();
  const searching = search !== undefined;
  useEffect(() => {
    if (!searching) return;
    const onKey = (event: KeyboardEvent) => {
      if (!searchShortcut(event) || document.querySelector("dialog[open]")) return;
      // Capture phase, before the composer's editor: on a Mac, CodeMirror reads Ctrl+K as "delete to the line end".
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      setSearchAsked(true);
      setSearchFocus((count) => count + 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [searching]);
  useEffect(() => {
    if (searchFocus === 0) return;
    // The sheet stops being inert in the render that opened it, so the box can take focus now.
    const input = searchInput.current;
    input?.focus({ preventScroll: true });
    input?.select();
  }, [searchFocus]);
  // Archive and next. With nothing left waiting, the list is the next thing to read.
  const { archiveAndNext } = picker;
  const archiveNext = useCallback(async (id: string) => {
    const outcome = await archiveAndNext(id);
    if (readSelected() !== id) return; // The reader moved on while the archive ran.
    if (outcome.type === "next") switchSession(outcome.session);
    else if (outcome.type === "allClear") { closeSession(); setOpen(true); }
  }, [archiveAndNext, switchSession, closeSession]);
  // Settings take the thread's place; the session stays in the URL underneath.
  const placeSettings = useCallback((place: SettingsPlace | undefined, replace = false) => {
    const url = new URL(window.location.href);
    clearSettings(url);
    if (place && readLaunch()) { url.searchParams.delete("launch"); setSelectedLaunch(undefined); setComposing(undefined); }
    if (place) {
      url.searchParams.set("settings", place.section);
      if (place.section === "backlog" && place.project) url.searchParams.set("project", place.project);
      if (place.section === "agents" && place.agent) url.searchParams.set("agent", targetParam(place.agent));
      if (place.section === "plugins" && place.plugin) url.searchParams.set("plugin", place.plugin);
      if (place.section === "projects" && place.group) url.searchParams.set("group", place.group);
      if (place.section === "resources" && place.resource) url.searchParams.set("resource", place.resource);
    }
    if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    setSettings(place);
    setBacklog(undefined);
    setTriggerPlace(undefined);
    if (place) setOpen(false);
    else if (!readSelected()) setOpen(true);
  }, []);
  // The backlog takes the thread's place the same way; the session stays in the URL underneath.
  const { refresh: refreshBacklog } = backlogList;
  // A suggestion filed or started from the Backlog view, or moved there by an event, is now an item (or an item held by
  // a session): read the backlog again so it shows where it went as it leaves "Suggested in chats".
  useEffect(() => everySuggestion.onFiled(() => refreshBacklog()), [everySuggestion, refreshBacklog]);
  const placeBacklog = useCallback((place: BacklogPlace | undefined, replace = false) => {
    const url = new URL(window.location.href);
    clearSettings(url);
    if (place && readLaunch()) { url.searchParams.delete("launch"); setSelectedLaunch(undefined); setComposing(undefined); }
    if (place) url.searchParams.set("backlog", place.item ? itemParam(place.item) : "");
    if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    // Opening the list reads the folders again: an agent may have written an item since.
    if (place && !place.item) { refreshBacklog(); void everySuggestion.refresh(); }
    setBacklog(place);
    setSettings(undefined);
    setTriggerPlace(undefined);
    if (place) setOpen(false);
    else if (!readSelected()) setOpen(true);
  }, [refreshBacklog, everySuggestion]);
  // The triggers take the thread's place the same way; the session stays in the URL underneath.
  const placeTriggers = useCallback((place: TriggerPlace | undefined, options: { replace?: boolean } = {}) => {
    const url = new URL(window.location.href);
    clearSettings(url);
    if (place && readLaunch()) { url.searchParams.delete("launch"); setSelectedLaunch(undefined); setComposing(undefined); }
    if (place) writeTriggersPlace(url, place);
    if (options.replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    setTriggerPlace(place);
    setSettings(undefined);
    setBacklog(undefined);
    if (place) setOpen(false);
    else if (!readSelected()) setOpen(true);
  }, []);
  // A start, a failed start, or an archive can claim or free an item. Read the list again when one settles.
  const settled = launchList.filter((launch) => launch.state.type !== "starting").length;
  const archived = picker.view.archivedCount;
  const firstSettle = useRef(true);
  useEffect(() => {
    if (firstSettle.current) { firstSettle.current = false; return; }
    refreshBacklog();
  }, [settled, archived, refreshBacklog]);
  const held = useMemo(() => backlogItems ? heldSessions(backlogItems) : undefined, [backlogItems]);
  // A source's destination reads as a project name. The list holds ids, so the open backlog reads the projects too.
  const [backlogProjects, setBacklogProjects] = useState<readonly Project[]>();
  const backlogOpen = backlog !== undefined;
  // The Backlog view reads every chat's suggestions when it opens, including straight from its address.
  useEffect(() => { if (backlogOpen) void everySuggestion.refresh(); }, [backlogOpen, everySuggestion]);
  useEffect(() => {
    if (!backlogOpen) return;
    const controller = new AbortController();
    newSessionApi.projects(controller.signal).then(setBacklogProjects, () => { /* Names fall back to the list's own project items. */ });
    return () => controller.abort();
  }, [backlogOpen]);
  const pickerView = useMemo(() => held ? { ...picker.view, held } : picker.view, [picker.view, held]);
  // A handoff door knows only the id and workspace. The catalog may also know the title.
  const known = !selectedId ? undefined : commandSelection?.session.id === selectedId
    ? { ...picker.find(selectedId), ...commandSelection.session } : picker.find(selectedId);

  // A background failure still needs review. The launch store holds its draft.
  const orphan = composing === undefined ? launchList.find((launch) => (launch.state.type === "failed" || launch.state.type === "unsent") && launch.id !== selectedLaunch) : undefined;
  const orphanNotice = orphan ? <Toast tone="alert" onDismiss={() => launches.dismiss(orphan.id)}
    message={`“${orphan.title}” ${orphan.state.type === "unsent" ? "started, but its first message may not have reached Pi." : "did not start."}`}
    action={{ label: "Review", onPress: () => { launchOptimistically(orphan.id); } }} /> : undefined;
  // One message at a time. It shows in the page's toast region, whether the list is open or not.
  const toast = picker.view.toast
    ? <PickerToast toast={picker.view.toast} onUndo={picker.actions.onUndo} onDismiss={picker.actions.onDismissToast} /> : orphanNotice;
  const searchBox = search ? <SearchBox query={query} busy={mode === "messages" && search.state.results.loading}
    onQuery={search.actions.setQuery} inputRef={searchInput} variant="bare" hintId={searchHintId}
    // The ✕ leaves the caret in the box, so the box stays where the reader is typing.
    onClear={() => { search.actions.clear(); searchInput.current?.focus({ preventScroll: true }); }}
    onKeyDown={(event) => {
      // Down from the box goes to the first hit.
      if (event.key !== "ArrowDown" || mode !== "messages") return;
      const first = resultsList.current?.querySelector<HTMLElement>("li button");
      if (first) { event.preventDefault(); first.focus(); }
    }} /> : undefined;
  const searchResults = !search ? undefined
    : mode === "messages" ? <SearchResults view={resultsView(query, search.state.results)} now={Date.now()} where={picker.where}
      onOpen={openHit} onRetry={search.actions.retry} onMore={search.actions.more} listRef={resultsList} />
    : mode === "title" && pickerView.sections.length === 0 && picker.view.connection.type === "ready"
      ? <SearchResults view={{ type: "titles-none", query: query.trim() }} now={Date.now()} where={picker.where}
        onOpen={openHit} onRetry={search.actions.retry} onMore={search.actions.more} /> : undefined;
  // Escape on the search box or its hits clears a typed query first, and puts the caret back in the box.
  // Escape on an empty query closes the box, and only the next one closes the list (see Picker).
  const clearSearch = () => {
    if (!search || query === "") return false;
    search.actions.clear();
    searchInput.current?.focus({ preventScroll: true });
    return true;
  };
  const hint = searchHint(query);
  const pickerSearch: PickerSearch | undefined = search && searchBox ? {
    field: searchBox, query, open: searchAsked, keys: SEARCH_KEYS,
    onOpen: () => { setSearchAsked(true); setSearchFocus((count) => count + 1); },
    onClose: () => { if (query !== "") search.actions.clear(); setSearchAsked(false); },
    hint: hint ? { id: searchHintId, text: hint } : undefined,
  } : undefined;
  const sessionFound = search && found && found.hit.sessionId === selectedId ? foundBinding(found, search.actions) : undefined;
  const dialog = composing === undefined ? null : composing || composeItem
    ? <NewSession key={composeKey} hidden={selectedLaunch !== undefined} onLaunching={launchOptimistically} cwd={composing} initialLaunch={composeRestore} initialPlacement={readPlace()} initialMode={composeMode} api={newSessionApi} worktrees={worktreeApi}
      item={composeItem} backlog={backlogApi} lookSession={picker.look} onItemRemoved={dropComposeItem}
      launches={launches} deferred={deferred} drafts={drafts}
      onDestination={(next, place) => {
        const url = new URL(window.location.href);
        url.searchParams.set("new", next);
        if (place === "existing") url.searchParams.set("place", place); else url.searchParams.delete("place");
        window.history.replaceState(window.history.state, "", url);
      }}
      onStarted={(session, unsent) => switchSession(session, unsent?.draft, unsent?.error)} onClose={closeComposer} />
    : null;
  const transcriptVisible = settings === undefined && backlog === undefined && triggerPlace === undefined && composing === undefined;
  const selectedChat = kept.find(record => record.visited && record.entry.session.id === selectedId);
  const selectedSession = known ?? selectedChat?.entry.session;
  const hasSelectedChat = selectedChat !== undefined;
  useEffect(() => { if (selectedSession) registry.select(selectedSession); }, [registry, selectedSession?.id, selectedSession?.cwd]);
  // An unresolved URL must not leave the previous, now hidden store eligible to acknowledge.
  useEffect(() => { registry.setVisible(transcriptVisible && hasSelectedChat); }, [registry, transcriptVisible, selectedId, hasSelectedChat]);
  const selectionFailure = known ? undefined : picker.view.connection.type === "failed" ? picker.view.connection.message
    : picker.view.connection.type === "ready" ? `Session ${selectedId ?? ""} was not found. Check the session ID in the URL.` : undefined;
  const pendingChat = selectedId && !hasSelectedChat ? <SessionFrame name={known?.name ?? "Session"}
    status={<StatusChip label={selectionFailure ? "Disconnected" : "Connecting"} tone={selectionFailure ? "bad" : "neutral"}
      panel={selectionFailure ? { title: "Disconnected", children: <StatusDetail connection={{ type: "failed", reason: selectionFailure }}
        problems={[]} draftSaved={false} onTryNow={picker.actions.onRetry} onReload={() => window.location.reload()}
        onDismiss={() => { /* No transcript problems exist before resolution. */ }} /> } : undefined} />}>
    <div className="thread-empty" />
  </SessionFrame> : null;
  // A suggestion's background session opens only on the reader's press; the Backlog opens from the chat's list.
  const lookSession = picker.look;
  const knownProjects = projectCatalog ?? backlogProjects;
  const projectPath = useCallback((projectId: string) => knownProjects?.find((project) => project.id === projectId)?.path, [knownProjects]);
  // A filed Markdown item, shown as the Backlog view shows it: found by its project and its path in the project's main
  // checkout, in the list already read or, failing that, in a fresh read. Without a match, the Backlog list opens.
  const openBacklogItem = useCallback((projectId: string, path: string) => {
    const shown = filedItemOf(backlogItems, projectId, path);
    if (shown) { placeBacklog({ item: { ...refOf(shown), scope: backlogScope } }); return; }
    void backlogApi.list(undefined, backlogScope).then((list) => filedItemOf(list.items, projectId, path), () => undefined)
      .then((item) => placeBacklog(item ? { item: { ...refOf(item), scope: backlogScope } } : {}));
  }, [backlogItems, backlogScope, placeBacklog]);
  const suggestionLinks = useMemo(() => ({ look: lookSession, openSession: (sessionId: string) => switchSession(find(sessionId) ?? { id: sessionId, cwd: "" }),
    openBacklog: () => placeBacklog({}), projectPath, openBacklogItem }), [lookSession, find, switchSession, placeBacklog, projectPath, openBacklogItem]);
  const chats = kept.filter(record => record.visited).map(record => {
    const entry = record.entry;
    const id = entry.session.id;
    const visible = transcriptVisible && selectedId === id;
    return <Activity key={record.key} mode={visible ? "visible" : "hidden"}>
      <ForgerieSession entry={entry} visible={visible} id={id} known={entry.session} found={id === selectedId ? sessionFound : undefined}
        relatedWork={relatedWork} resourceLens={resourceLens}
        initialDraft={commandSelection?.session.id === id ? commandSelection.draft : undefined}
        initialError={commandSelection?.session.id === id ? commandSelection.error : undefined}
        drafts={drafts} onSwitchSession={switchSession}
        worktree={picker.find(id)?.worktree} pullRequests={picker.find(id)?.pullRequests} actionRuns={picker.find(id)?.actionRuns} worktrees={worktreeApi} onNewSession={() => { void startNew(); }}
        archive={{ availability: picker.archiveState(id), onArchive: () => { void archiveNext(id); } }}
        suggestionLinks={suggestionLinks} revealSuggestion={shownSuggestion?.sessionId === id ? shownSuggestion : undefined} />
    </Activity>;
  });
  const thread = settings ? <Suspense fallback={<SessionFrame name="Settings" status={<StatusChip label="Opening…" tone="neutral" />}><div className="thread-empty" /></SessionFrame>}>
    <SettingsView place={settings} onPlace={placeSettings} onClose={() => placeSettings(undefined)} onPluginCatalog={appPluginStore.apply} projects={projectSettings} resources={resourceSettings} backlog={backlogSettings} modelChains={modelChains} /></Suspense>
    : backlog ? <Suspense fallback={<SessionFrame name="Backlog" status={<StatusChip label="Opening…" tone="neutral" />}><div className="thread-empty" /></SessionFrame>}>
      <BacklogView place={backlog} binding={{ scope: backlogScope, onScope: setBacklogScope, load: backlogList.load, onRefresh: refreshBacklog, api: backlogApi, look: picker.look,
        projects: projectCatalog ?? backlogProjects,
        onPlace: placeBacklog, onClose: () => placeBacklog(undefined),
        onLaunch: (item) => { void startNew("switch", item); },
        onOpenSession: (claim) => switchSession({ id: claim.sessionId, cwd: claim.cwd }), github: githubApi, githubPage,
        before: <SuggestedInChats suggestions={suggested.suggestions?.filter((record: Suggestion) => suggestionWaits(record.state))} readError={suggested.readError}
          pending={suggested.pending} problems={suggested.problems} drafts={suggested.drafts} now={Date.now()} actions={{
            onFile: (id) => { void everySuggestion.file(id); }, onFileAndAct: (id) => { void everySuggestion.fileAndAct(id); },
            onRetry: () => { void everySuggestion.refresh(); },
            onShow: (record) => { switchSession(picker.find(record.sessionId) ?? { id: record.sessionId, cwd: "" });
              setShownSuggestion((current) => ({ sessionId: record.sessionId, suggestionId: record.id, key: (current?.key ?? 0) + 1 })); } }} /> }} /></Suspense>
    : triggerPlace && triggers ? triggers.render({ place: triggerPlace, onPlace: placeTriggers,
      onOpenSession: (session) => switchSession(session), sessionName: (id) => picker.find(id)?.name })
    : composing === "" && !composeItem && !selectedId
      ? <SessionFrame name="New session" status={<StatusChip label="No project" tone="bad" panel={{ title: "No project", children: <p>Forgerie knows no project yet, and this app cannot add one yet.</p> }} />}><div className="thread-empty" /></SessionFrame>
    : selectedLaunch ? (() => {
      const launch = launchList.find((item) => item.id === selectedLaunch);
      return launch && pendingSession ? pendingSession(launch, {
        onRestore: () => restoreLaunch(launch),
        onRetrySetup: () => { const next = launches.retrySetup(launch.id); if (next) launchOptimistically(next.id); },
        worktrees: worktreeApi,
        onDiscarded: () => launches.forgetSetup(launch.id),
      }) : <SessionFrame name={launch?.title ?? "New session"}
        status={<StatusChip label={launch ? "Starting…" : "Launch unavailable"} tone={launch ? "neutral" : "bad"} />}>
        <div className="thread-empty">{launch?.draft.text}</div></SessionFrame>;
    })()
    : selectedId ? pendingChat
    // The picker covers this area whenever nothing is selected, so it holds no
    // message of its own: the picker is the instruction.
    : <SessionFrame name="No session open"><div className="thread-empty" /></SessionFrame>;
  // A trigger that needs a look lights the opener's dot too, when no session already does.
  return <><AppShell open={open} onOpenChange={setOpen} attention={picker.attention ?? (triggers?.entry.attention ? "blocked" : undefined)}
    picker={(layout) => <Picker view={pickerView} prefs={picker.prefs} onPrefs={picker.setPrefs}
      shelves={shelves} filter={projectFilter ? { ...projectFilter, onManage: () => placeSettings({ section: "projects" }) } : undefined}
      search={pickerSearch} results={searchResults} narrowed={mode === "title"} onEscape={clearSearch}
      actions={{ ...picker.actions, onPrefetch: prefetch.intent, onCancelPrefetch: prefetch.cancel, onSelect: select, onNew: () => { void startNew(); },
        onSettings: () => placeSettings(settings ?? { section: "root" }), settingsOpen: settings !== undefined,
        onBacklog: () => placeBacklog(backlog ?? {}), backlogOpen: backlog !== undefined,
        backlogCount: backlogItems ? openCount(backlogItems) : undefined,
        onTriggers: triggers ? () => placeTriggers(triggerPlace ?? { view: "list" }) : undefined, triggersOpen: triggerPlace !== undefined,
        triggers: triggers ? { title: triggers.entry.title, chip: triggers.entry.chip } : undefined,
        onFullscreen: fullscreen.state.type === "unsupported" ? undefined : fullscreen.toggle, fullscreen: fullscreen.state.type === "fullscreen",
        onClose: layout === "overlay" && (selectedId || selectedLaunch || settings || backlog || triggerPlace) ? () => setOpen(false) : undefined }} />}
    // Direct URLs retain the frame while the catalog resolves; only resolved sessions join the registry.
    thread={<>{chats}{thread}{dialog}</>} />{toast}</>;
}
