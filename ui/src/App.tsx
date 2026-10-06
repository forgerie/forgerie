import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ForgerieSession } from "./ForgerieSession";
import { usePicker, type StartingSession } from "./usePicker";
import type { Row } from "./picker/board";
import type { Session } from "./contracts";
import { AppShell } from "./ui/AppShell";
import { Picker, PickerToast } from "./ui/Picker";
import { SessionFrame } from "./ui/SessionFrame";
import { browserStorage, createDraftStore } from "./draftStore";
import { NewSession, type LaunchDraft, type LaunchMode } from "./NewSession";
import { createDeferredFiles, createNewSessionApi, defaultDestinationCwd, newStartupToken } from "./newSession";
import { XIcon } from "lucide-react";
import { createLaunchStore, type StartupListener } from "./launches";
import { newSessionShortcut } from "./shortcuts";
import { readTarget, targetParam, type SettingsPlace } from "./agents/agentPlace";
// Settings carry the prompt editor; the chat never pays for it.
const SettingsView = lazy(() => import("./ui/settings/SettingsView").then((module) => ({ default: module.SettingsView })));

const readSelected = () => new URLSearchParams(window.location.search).get("session")?.trim() || undefined;
/** `?new=<folder>` keeps the new-session dialog open across a reload, over whatever is open. */
const readNew = () => new URLSearchParams(window.location.search).get("new")?.trim() || undefined;
/** `?settings=<section>&agent=<target>` keeps a settings page open across a reload. */
const readSettings = (): SettingsPlace | undefined => {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("settings");
  if (section === null) return undefined;
  return section === "agents" ? { section, agent: readTarget(params.get("agent") ?? undefined) } : { section: "root" };
};
const clearSettings = (url: URL) => { url.searchParams.delete("settings"); url.searchParams.delete("agent"); };
const newSessionApi = createNewSessionApi((path, init) => fetch(path, init));
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
  const [launches] = useState(() => createLaunchStore<LaunchDraft>(newSessionApi, { onStartup: startup.on }));
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
  const [open, setOpen] = useState(() => readSelected() === undefined && readNew() === undefined && readSettings() === undefined);
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
  const { onStartup } = picker;
  useEffect(() => onStartup(startup.emit), [onStartup, startup]);
  useEffect(() => () => launches.dispose(), [launches]);
  useEffect(() => {
    const onPop = () => { setCommandSelection(undefined); setSelectedId(readSelected()); setComposing(readNew()); setSettings(readSettings()); };
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
    window.history.replaceState({}, "", url);
    setComposing(undefined);
  }, []);
  const switchSession = useCallback((session: Session, draft?: string, error?: string) => {
    setOpen(false);
    const fromComposer = readNew() !== undefined;
    setComposing(undefined);
    setCommandSelection({ session, draft, ...(error ? { error } : {}) });
    const inSettings = readSettings() !== undefined;
    setSettings(undefined);
    if (session.id === selectedId && !fromComposer && !inSettings) return;
    const url = new URL(window.location.href);
    clearSettings(url);
    url.searchParams.delete("new");
    url.searchParams.set("session", session.id);
    // A started session replaces the dialog's entry: Back must not reopen an emptied dialog.
    if (fromComposer) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    setSelectedId(session.id);
  }, [selectedId]);
  // New session: the dialog starts where the reader is, over whatever is open, and the URL remembers it.
  const { find, recent } = picker;
  // Two quick presses must open one window, not push two history entries.
  const opening = useRef(false);
  const startNew = useCallback(async (mode: LaunchMode = "switch") => {
    setOpen(false);
    if (opening.current) return;
    if (readNew() !== undefined) {
      setComposeMode(mode);
      document.querySelector<HTMLTextAreaElement>(".ns-dialog textarea")?.focus();
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
    }
    if (replace) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    setSettings(place);
    if (place) setOpen(false);
    else if (!readSelected()) setOpen(true);
  }, []);
  // A handoff door knows only the id and workspace. The catalog may also know the title.
  const known = !selectedId ? undefined : commandSelection?.session.id === selectedId
    ? { ...picker.find(selectedId), ...commandSelection.session } : picker.find(selectedId);

  // The undo offer lives in the picker. While the sheet is closed, the thread shows it too.
  // A background start that failed after its window closed must still be seen. The window holds its draft.
  const orphan = composing === undefined ? launchList.find((launch) => launch.state.type === "failed" || launch.state.type === "unsent") : undefined;
  const toast = picker.view.toast
    ? <PickerToast toast={picker.view.toast} onUndo={picker.actions.onUndo} onDismiss={picker.actions.onDismissToast} />
    : orphan ? <div className="picker-toast" data-tone="error" role="alert">
      <span>“{orphan.title}” {orphan.state.type === "unsent" ? "started, but its first message may not have reached Pi." : "did not start."}</span>
      <button type="button" className="picker-toast-undo" onClick={() => { void startNew(); }}>Review</button>
      <button type="button" className="picker-toast-close" aria-label="Dismiss" onClick={() => launches.dismiss(orphan.id)}><XIcon aria-hidden /></button>
    </div> : undefined;
  const dialog = composing === undefined ? null : composing
    ? <NewSession key={composeKey} cwd={composing} initialMode={composeMode} api={newSessionApi} launches={launches} deferred={deferred} drafts={drafts}
      onDestination={(next) => { const url = new URL(window.location.href); url.searchParams.set("new", next); window.history.replaceState(window.history.state, "", url); }}
      onStarted={(session, unsent) => switchSession(session, unsent?.draft, unsent?.error)} onClose={closeComposer} />
    : null;
  const thread = settings ? <Suspense fallback={<SessionFrame name="Settings" status="Opening…"><div className="thread-empty" /></SessionFrame>}>
    <SettingsView place={settings} onPlace={placeSettings} onClose={() => placeSettings(undefined)} /></Suspense>
    : composing === "" && !selectedId
      ? <SessionFrame name="New session" status="" error="Forgerie knows no project yet. Add a project in the old client, then start a session here."><div className="thread-empty" /></SessionFrame>
    : selectedId ? <ForgerieSession key={selectedId} id={selectedId}
      known={known}
      initialDraft={commandSelection?.session.id === selectedId ? commandSelection.draft : undefined}
      initialError={commandSelection?.session.id === selectedId ? commandSelection.error : undefined}
      drafts={drafts} onSwitchSession={switchSession}
      archive={{ availability: picker.archiveState(selectedId), onArchive: () => { void archiveNext(selectedId); } }} />
    // The picker covers this area whenever nothing is selected, so it holds no
    // message of its own: the picker is the instruction.
    : <SessionFrame name="No session open" status=""><div className="thread-empty" /></SessionFrame>;
  return <AppShell open={open} onOpenChange={setOpen} attention={picker.attention} toast={toast}
    picker={(layout) => <Picker view={picker.view} prefs={picker.prefs} onPrefs={picker.setPrefs}
      actions={{ ...picker.actions, onSelect: select, onNew: () => { void startNew(); },
        onSettings: () => placeSettings(settings ?? { section: "root" }), settingsOpen: settings !== undefined,
        onClose: layout === "overlay" && (selectedId || settings) ? () => setOpen(false) : undefined }} />}
    // `known` is read once, when the thread mounts for this id. A direct URL
    // load before the catalog arrives passes nothing and the store looks it up.
    thread={<>{thread}{dialog}</>} />;
}
