import { useCallback, useEffect, useState } from "react";
import { ForgerieSession } from "./ForgerieSession";
import { usePicker } from "./usePicker";
import type { Row } from "./picker/board";
import type { Session } from "./contracts";
import { AppShell } from "./ui/AppShell";
import { Picker, PickerToast } from "./ui/Picker";
import { SessionFrame } from "./ui/SessionFrame";
import { browserStorage, createDraftStore } from "./draftStore";

const readSelected = () => new URLSearchParams(window.location.search).get("session")?.trim() || undefined;

/** Composition root: owns the selected session (in the URL) and the sheet. */
export function App() {
  const [selectedId, setSelectedId] = useState(readSelected);
  const [commandSelection, setCommandSelection] = useState<{ session: Session; draft?: string }>();
  // Unsent drafts outlive a session switch and a reload, in this browser only.
  const [drafts] = useState(() => createDraftStore(browserStorage()));
  // With nothing selected there is nothing to cover, so the sheet starts open.
  const [open, setOpen] = useState(() => readSelected() === undefined);
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
    const onPop = () => { setCommandSelection(undefined); setSelectedId(readSelected()); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const switchSession = useCallback((session: Session, draft?: string) => {
    setOpen(false);
    setCommandSelection({ session, draft });
    if (session.id === selectedId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("session", session.id);
    window.history.pushState({}, "", url);
    setSelectedId(session.id);
  }, [selectedId]);
  const select = useCallback((row: Row) => switchSession(row.session), [switchSession]);
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
      actions={{ ...picker.actions, onSelect: select, onClose: layout === "overlay" && selectedId ? () => setOpen(false) : undefined }} />}
    // `known` is read once, when the thread mounts for this id. A direct URL
    // load before the catalog arrives passes nothing and the store looks it up.
    thread={selectedId ? <ForgerieSession key={selectedId} id={selectedId}
      known={known}
      initialDraft={commandSelection?.session.id === selectedId ? commandSelection.draft : undefined}
      drafts={drafts} onSwitchSession={switchSession}
      archive={{ availability: picker.archiveState(selectedId), onArchive: () => { void archiveNext(selectedId); } }} />
      // The picker covers this area whenever nothing is selected, so it holds no
      // message of its own: the picker is the instruction.
      : <SessionFrame name="No session open" status=""><div className="thread-empty" /></SessionFrame>} />;
}
