import { useCallback, useEffect, useState } from "react";
import { ForgerieSession } from "./ForgerieSession";
import { usePicker } from "./usePicker";
import type { Row } from "./picker/board";
import type { Session } from "./contracts";
import { AppShell } from "./ui/AppShell";
import { Picker, PickerToast } from "./ui/Picker";
import { SessionFrame } from "./ui/SessionFrame";
import { browserStorage, createDraftStore } from "./draftStore";
import { NewSession } from "./NewSession";
import { createNewSessionApi, defaultDestinationCwd } from "./newSession";

const readSelected = () => new URLSearchParams(window.location.search).get("session")?.trim() || undefined;
/** `?new=<folder>` keeps a new session's composer open across a reload. */
const readNew = () => new URLSearchParams(window.location.search).get("new")?.trim() || undefined;
const newSessionApi = createNewSessionApi((path, init) => fetch(path, init));

/** Composition root: owns the selected session (in the URL) and the sheet. */
export function App() {
  const [selectedId, setSelectedId] = useState(readSelected);
  const [commandSelection, setCommandSelection] = useState<{ session: Session; draft?: string; error?: string }>();
  // A session that does not exist yet: the folder its composer starts in.
  const [composing, setComposing] = useState(readNew);
  // Bumped when a new composer opens, so moving its destination never remounts it.
  const [composeKey, setComposeKey] = useState(0);
  // Unsent drafts outlive a session switch and a reload, in this browser only.
  const [drafts] = useState(() => createDraftStore(browserStorage()));
  // With nothing selected there is nothing to cover, so the sheet starts open.
  const [open, setOpen] = useState(() => readSelected() === undefined && readNew() === undefined);
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
  const picker = usePicker(selectedId, { onDeleted });
  useEffect(() => {
    const onPop = () => { setCommandSelection(undefined); setSelectedId(readSelected()); setComposing(readNew()); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const switchSession = useCallback((session: Session, draft?: string, error?: string) => {
    setOpen(false);
    const fromComposer = readNew() !== undefined;
    setComposing(undefined);
    setCommandSelection({ session, draft, ...(error ? { error } : {}) });
    if (session.id === selectedId && !fromComposer) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    url.searchParams.set("session", session.id);
    // A started session replaces its composer: Back must not lead to an empty composer.
    if (fromComposer) window.history.replaceState({}, "", url); else window.history.pushState({}, "", url);
    setSelectedId(session.id);
  }, [selectedId]);
  const select = useCallback((row: Row) => switchSession(row.session), [switchSession]);
  // New session: the composer starts where the reader is, and the URL remembers it.
  const { find, recent } = picker;
  const startNew = useCallback(async () => {
    setOpen(false);
    if (readNew() !== undefined && !readSelected()) {
      document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
      return;
    }
    const open = readSelected();
    // Before the session list loads, or with no sessions yet, Forgerie's projects decide.
    const projects = await newSessionApi.projects().catch(() => []);
    const cwd = defaultDestinationCwd(open ? find(open) : undefined, recent, projects);
    setComposeKey((key) => key + 1);
    if (!cwd) { setCommandSelection(undefined); setSelectedId(undefined); setComposing(""); return; }
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    url.searchParams.set("new", cwd);
    window.history.pushState({}, "", url);
    setCommandSelection(undefined);
    setSelectedId(undefined);
    setComposing(cwd);
  }, [find, recent]);
  // Archive and next. With nothing left waiting, the list is the next thing to read.
  const { archiveAndNext } = picker;
  const archiveNext = useCallback(async (id: string) => {
    const outcome = await archiveAndNext(id);
    if (readSelected() !== id) return; // The reader moved on while the archive ran.
    if (outcome.type === "next") switchSession(outcome.session);
    else if (outcome.type === "allClear") { closeSession(); setOpen(true); }
  }, [archiveAndNext, switchSession, closeSession]);
  // A handoff door knows only the id and workspace. The catalog may also know the title.
  const known = !selectedId ? undefined : commandSelection?.session.id === selectedId
    ? { ...picker.find(selectedId), ...commandSelection.session } : picker.find(selectedId);

  // The undo offer lives in the picker. While the sheet is closed, the thread shows it too.
  const toast = picker.view.toast
    ? <PickerToast toast={picker.view.toast} onUndo={picker.actions.onUndo} onDismiss={picker.actions.onDismissToast} /> : undefined;
  return <AppShell open={open} onOpenChange={setOpen} attention={picker.attention} toast={toast}
    picker={(layout) => <Picker view={picker.view} prefs={picker.prefs} onPrefs={picker.setPrefs}
      actions={{ ...picker.actions, onSelect: select, onNew: () => { void startNew(); },
        onClose: layout === "overlay" && (selectedId || composing !== undefined) ? () => setOpen(false) : undefined }} />}
    // `known` is read once, when the thread mounts for this id. A direct URL
    // load before the catalog arrives passes nothing and the store looks it up.
    thread={composing !== undefined && !selectedId ? (composing
      ? <NewSession key={composeKey} cwd={composing} api={newSessionApi} drafts={drafts}
        onDestination={(next) => { const url = new URL(window.location.href); url.searchParams.set("new", next); window.history.replaceState({}, "", url); }}
        onStarted={(session, unsent) => switchSession(session, unsent?.draft, unsent?.error)} />
      : <SessionFrame name="New session" status="" error="Forgerie knows no project yet. Add a project in the old client, then start a session here."><div className="thread-empty" /></SessionFrame>)
      : selectedId ? <ForgerieSession key={selectedId} id={selectedId}
      known={known}
      initialDraft={commandSelection?.session.id === selectedId ? commandSelection.draft : undefined}
      initialError={commandSelection?.session.id === selectedId ? commandSelection.error : undefined}
      drafts={drafts} onSwitchSession={switchSession}
      archive={{ availability: picker.archiveState(selectedId), onArchive: () => { void archiveNext(selectedId); } }} />
      // The picker covers this area whenever nothing is selected, so it holds no
      // message of its own: the picker is the instruction.
      : <SessionFrame name="No session open" status=""><div className="thread-empty" /></SessionFrame>} />;
}
