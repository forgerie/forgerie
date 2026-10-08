import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ForgerieSession } from "./ForgerieSession";
import { usePicker, type StartingSession } from "./usePicker";
import type { Row } from "./picker/board";
import type { Session } from "./contracts";
import { AppShell } from "./ui/AppShell";
import { Picker, PickerToast } from "./ui/Picker";
import { SessionFrame } from "./ui/SessionFrame";
import { browserStorage, createDraftStore } from "./draftStore";
import { NewSession, type LaunchDraft, type LaunchMode, type Placement } from "./NewSession";
import { createWorktreeApi, type WorktreeRecord } from "./worktrees/worktreeApi";
import { createDeferredFiles, createNewSessionApi, defaultDestinationCwd, newStartupToken } from "./newSession";
import { XIcon } from "lucide-react";
import { createLaunchStore, type StartupListener, type WorktreeListener } from "./launches";
import { newSessionShortcut } from "./shortcuts";
import { readTarget, targetParam, type SettingsPlace } from "./agents/agentPlace";
import { createBacklogApi, type BacklogItem } from "./backlog/backlogApi";
import { heldSessions, itemParam, listOf, openCount, readBacklogPlace, readItemParam, refOf, type BacklogPlace } from "./backlog/backlogModel";
import { createGitHubApi, readSetupReturn, submitToGitHub } from "./backlog/githubApi";
import type { GitHubAppPage } from "./backlog/useGitHubApp";
import { useBacklogList } from "./backlog/useBacklogList";
// Settings carry the prompt editor; the chat never pays for it.
const SettingsView = lazy(() => import("./ui/settings/SettingsView").then((module) => ({ default: module.SettingsView })));
// The backlog renders item files as documents; the chat never pays for it either.
const BacklogView = lazy(() => import("./ui/backlog/BacklogView").then((module) => ({ default: module.BacklogView })));

const readSelected = () => new URLSearchParams(window.location.search).get("session")?.trim() || undefined;
/** `?new=<folder>` keeps the new-session dialog open across a reload, over whatever is open. */
const readNew = () => new URLSearchParams(window.location.search).get("new")?.trim() || undefined;
/** `&place=existing` keeps an explicit "this folder, not a new worktree" across a reload. Absent: the default. */
const readPlace = (): Placement | undefined => { const place = new URLSearchParams(window.location.search).get("place"); return place === "existing" || place === "fresh" ? place : undefined; };
/** `?settings=<section>&agent=<target>` keeps a settings page open across a reload. */
const readSettings = (): SettingsPlace | undefined => {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("settings");
  if (section === null) return undefined;
  if (section === "agents") return { section, agent: readTarget(params.get("agent") ?? undefined) };
  if (section === "models") return { section };
  return section === "plugins" ? { section, plugin: params.get("plugin") ?? undefined } : { section: "root" };
};
/** `?backlog` keeps the backlog open across a reload; `?backlog=<projectId>/<itemId>` keeps one item open. */
const readBacklog = () => readBacklogPlace(new URLSearchParams(window.location.search));
/** `&item=<projectId>/<itemId>` keeps a backlog item riding with the new-session dialog across a reload. */
const readItem = () => readItemParam(new URLSearchParams(window.location.search).get("item"));
/** Settings and the backlog both take the thread's place, so opening one closes the other. */
const clearSettings = (url: URL) => { url.searchParams.delete("settings"); url.searchParams.delete("agent"); url.searchParams.delete("plugin"); url.searchParams.delete("backlog"); };
const newSessionApi = createNewSessionApi((path, init) => fetch(path, init));
const worktreeApi = createWorktreeApi((path, init) => fetch(path, init));
const backlogApi = createBacklogApi((path, init) => fetch(path, init));
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
export function App() {
  const [selectedId, setSelectedId] = useState(readSelected);
  const [commandSelection, setCommandSelection] = useState<{ session: Session; draft?: string; error?: string }>();
  // The new-session dialog: the folder it starts in, over the open session.
  const [composing, setComposing] = useState(readNew);
  const [composeMode, setComposeMode] = useState<LaunchMode>("switch");
  const [settings, setSettings] = useState(readSettings);
  const [backlog, setBacklog] = useState(readBacklogOrSetup);
  // The backlog item riding with the new-session dialog.
  const [composeItem, setComposeItem] = useState(readItem);
  const backlogList = useBacklogList(backlogApi);
  const backlogItems = listOf(backlogList.load)?.items;
  // Bumped when the dialog opens, so moving its destination never remounts it.
  const [composeKey, setComposeKey] = useState(0);
  // Unsent drafts outlive a session switch and a reload, in this browser only.
  const [drafts] = useState(() => createDraftStore(browserStorage()));
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
  const [launches] = useState(() => createLaunchStore<LaunchDraft>(newSessionApi, { onStartup: startup.on, onWorktree: worktreeEvents.on,
    findWorktree: async (token, cwd) => (await worktreeApi.list(cwd)).find((record) => record.startupToken === token) }));
  // Files wait here until their session exists, for every window, so "Put back" always finds them.
  const [deferred] = useState(() => createDeferredFiles());
  const launchList = useSyncExternalStore(launches.subscribe, launches.getSnapshot);
  const starting = useMemo<StartingSession[]>(() => launchList.filter((launch) => launch.state.type === "starting")
    .map((launch) => ({ id: launch.id, cwd: launch.cwd, title: launch.title, startedAt: launch.startedAt,
      sessionId: launch.state.type === "starting" ? launch.state.sessionId : undefined })), [launchList]);
  // A reload during any start could leave a session without its first message.
  const inFlight = starting.length > 0;
  useEffect(() => {
    if (!inFlight) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inFlight]);
  // With nothing selected there is nothing to cover, so the sheet starts open.
  const [open, setOpen] = useState(() => readSelected() === undefined && readNew() === undefined && readSettings() === undefined && readBacklogOrSetup() === undefined);
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
    drafts.forget(id);
    if (readSelected() === id) closeSession();
  }, [drafts, closeSession]);
  const picker = usePicker(selectedId, { onDeleted, starting });
  const { onStartup, onWorktree } = picker;
  useEffect(() => onStartup(startup.emit), [onStartup, startup]);
  useEffect(() => onWorktree(worktreeEvents.emit), [onWorktree, worktreeEvents]);
  useEffect(() => () => launches.dispose(), [launches]);
  useEffect(() => {
    const onPop = () => { setCommandSelection(undefined); setSelectedId(readSelected()); setComposing(readNew()); setComposeItem(readItem()); setSettings(readSettings()); setBacklog(readBacklog()); };
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
    window.history.replaceState({}, "", url);
    setComposing(undefined);
    setComposeItem(undefined);
  }, []);
  /** The author took the item off the new session. The dialog stays. */
  const dropComposeItem = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("item");
    window.history.replaceState(window.history.state, "", url);
    setComposeItem(undefined);
  }, []);
  const switchSession = useCallback((session: Session, draft?: string, error?: string) => {
    setOpen(false);
    const fromComposer = readNew() !== undefined;
    setComposing(undefined);
    setComposeItem(undefined);
    setCommandSelection({ session, draft, ...(error ? { error } : {}) });
    const inSettings = readSettings() !== undefined || readBacklog() !== undefined;
    setSettings(undefined);
    setBacklog(undefined);
    if (session.id === selectedId && !fromComposer && !inSettings) return;
    const url = new URL(window.location.href);
    clearSettings(url);
    url.searchParams.delete("new");
    url.searchParams.delete("item");
    url.searchParams.set("session", session.id);
    // A started session replaces the dialog's entry: Back must not reopen an emptied dialog.
    if (fromComposer) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    setSelectedId(session.id);
  }, [selectedId]);
  // New session: the dialog starts where the reader is, over whatever is open, and the URL remembers it.
  const { find, recent } = picker;
  // Two quick presses must open one window, not push two history entries.
  const opening = useRef(false);
  const startNew = useCallback(async (mode: LaunchMode = "switch", item?: BacklogItem) => {
    setOpen(false);
    if (opening.current) return;
    // A backlog item starts in its own project. Over an open dialog, it replaces that dialog's destination and item.
    if (item) {
      const ref = refOf(item);
      const url = new URL(window.location.href);
      const reopen = readNew() !== undefined;
      url.searchParams.set("new", item.repo);
      url.searchParams.delete("place");
      url.searchParams.set("item", itemParam(ref));
      if (reopen) window.history.replaceState(window.history.state, "", url); else window.history.pushState(DIALOG_ENTRY, "", url);
      setComposeKey((key) => key + 1);
      setComposeMode(mode);
      setComposeItem(ref);
      setComposing(item.repo);
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
    url.searchParams.set("new", cwd);
    window.history.pushState(DIALOG_ENTRY, "", url);
    setComposing(cwd);
  }, [find, recent]);
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
  const select = useCallback((row: Row) => {
    const pending = starting.find((item) => item.id === row.session.id);
    if (!pending) { switchSession(row.session); return; }
    if (pending.sessionId) switchSession({ id: pending.sessionId, cwd: pending.cwd, name: pending.title });
    else void startNew();
  }, [starting, startNew, switchSession]);
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
    if (place) {
      url.searchParams.set("settings", place.section);
      if (place.section === "agents" && place.agent) url.searchParams.set("agent", targetParam(place.agent));
      if (place.section === "plugins" && place.plugin) url.searchParams.set("plugin", place.plugin);
    }
    if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    setSettings(place);
    setBacklog(undefined);
    if (place) setOpen(false);
    else if (!readSelected()) setOpen(true);
  }, []);
  // The backlog takes the thread's place the same way; the session stays in the URL underneath.
  const { refresh: refreshBacklog } = backlogList;
  const placeBacklog = useCallback((place: BacklogPlace | undefined, replace = false) => {
    const url = new URL(window.location.href);
    clearSettings(url);
    if (place) url.searchParams.set("backlog", place.item ? itemParam(place.item) : "");
    if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    // Opening the list reads the folders again: an agent may have written an item since.
    if (place && !place.item) refreshBacklog();
    setBacklog(place);
    setSettings(undefined);
    if (place) setOpen(false);
    else if (!readSelected()) setOpen(true);
  }, [refreshBacklog]);
  // A start, a failed start, or an archive can claim or free an item. Read the list again when one settles.
  const settled = launchList.filter((launch) => launch.state.type !== "starting").length;
  const archived = picker.view.archivedCount;
  const firstSettle = useRef(true);
  useEffect(() => {
    if (firstSettle.current) { firstSettle.current = false; return; }
    refreshBacklog();
  }, [settled, archived, refreshBacklog]);
  const held = useMemo(() => backlogItems ? heldSessions(backlogItems) : undefined, [backlogItems]);
  const pickerView = useMemo(() => held ? { ...picker.view, held } : picker.view, [picker.view, held]);
  // A handoff door knows only the id and workspace. The catalog may also know the title.
  const known = !selectedId ? undefined : commandSelection?.session.id === selectedId
    ? { ...picker.find(selectedId), ...commandSelection.session } : picker.find(selectedId);

  // The undo offer lives in the picker. While the sheet is closed, the thread shows it too.
  // A background start that failed after its window closed must still be seen. The window holds its draft.
  const orphan = composing === undefined ? launchList.find((launch) => launch.state.type === "failed" || launch.state.type === "unsent") : undefined;
  const orphanNotice = orphan ? <div className="picker-toast" data-tone="error" role="alert">
      <span>“{orphan.title}” {orphan.state.type === "unsent" ? "started, but its first message may not have reached Pi." : "did not start."}</span>
      <button type="button" className="picker-toast-undo" onClick={() => { void startNew(); }}>Review</button>
      <button type="button" className="picker-toast-close" aria-label="Dismiss" onClick={() => launches.dismiss(orphan.id)}><XIcon aria-hidden /></button>
    </div> : undefined;
  // One message line: the list shows it in place, the thread repeats it while the list is closed.
  const toast = picker.view.toast
    ? <PickerToast toast={picker.view.toast} onUndo={picker.actions.onUndo} onDismiss={picker.actions.onDismissToast} /> : orphanNotice;
  const dialog = composing === undefined ? null : composing
    ? <NewSession key={composeKey} cwd={composing} initialPlacement={readPlace()} initialMode={composeMode} api={newSessionApi} worktrees={worktreeApi}
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
  const thread = settings ? <Suspense fallback={<SessionFrame name="Settings" status="Opening…"><div className="thread-empty" /></SessionFrame>}>
    <SettingsView place={settings} onPlace={placeSettings} onClose={() => placeSettings(undefined)} /></Suspense>
    : backlog ? <Suspense fallback={<SessionFrame name="Backlog" status="Opening…"><div className="thread-empty" /></SessionFrame>}>
      <BacklogView place={backlog} binding={{ load: backlogList.load, onRefresh: refreshBacklog, api: backlogApi, look: picker.look,
        onPlace: placeBacklog, onClose: () => placeBacklog(undefined),
        onLaunch: (item) => { void startNew("switch", item); },
        onOpenSession: (claim) => switchSession({ id: claim.sessionId, cwd: claim.cwd }), github: githubApi, githubPage }} /></Suspense>
    : composing === "" && !selectedId
      ? <SessionFrame name="New session" status="" error="Forgerie knows no project yet. Add a project in the old client, then start a session here."><div className="thread-empty" /></SessionFrame>
    : selectedId ? <ForgerieSession key={selectedId} id={selectedId} onUnread={picker.onUnread}
      known={known}
      initialDraft={commandSelection?.session.id === selectedId ? commandSelection.draft : undefined}
      initialError={commandSelection?.session.id === selectedId ? commandSelection.error : undefined}
      drafts={drafts} onSwitchSession={switchSession}
      worktree={picker.find(selectedId)?.worktree} pullRequest={picker.find(selectedId)?.pullRequest} worktrees={worktreeApi} onNewSession={() => { void startNew(); }}
      archive={{ availability: picker.archiveState(selectedId), onArchive: () => { void archiveNext(selectedId); } }} />
    // The picker covers this area whenever nothing is selected, so it holds no
    // message of its own: the picker is the instruction.
    : <SessionFrame name="No session open" status=""><div className="thread-empty" /></SessionFrame>;
  return <AppShell open={open} onOpenChange={setOpen} attention={picker.attention} toast={toast}
    picker={(layout) => <Picker view={pickerView} prefs={picker.prefs} onPrefs={picker.setPrefs} message={orphanNotice}
      actions={{ ...picker.actions, onSelect: select, onNew: () => { void startNew(); },
        onSettings: () => placeSettings(settings ?? { section: "root" }), settingsOpen: settings !== undefined,
        onBacklog: () => placeBacklog(backlog ?? {}), backlogOpen: backlog !== undefined,
        backlogCount: backlogItems ? openCount(backlogItems) : undefined,
        onClose: layout === "overlay" && (selectedId || settings || backlog) ? () => setOpen(false) : undefined }} />}
    // `known` is read once, when the thread mounts for this id. A direct URL
    // load before the catalog arrives passes nothing and the store looks it up.
    thread={<>{thread}{dialog}</>} />;
}
