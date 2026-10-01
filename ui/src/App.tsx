import { useCallback, useEffect, useState } from "react";
import { ForgerieSession } from "./ForgerieSession";
import { usePicker } from "./usePicker";
import type { Row } from "./picker/board";
import type { Session } from "./contracts";
import { AppShell } from "./ui/AppShell";
import { Picker } from "./ui/Picker";
import { SessionFrame } from "./ui/SessionFrame";

const readSelected = () => new URLSearchParams(window.location.search).get("session")?.trim() || undefined;

/** Composition root: owns the selected session (in the URL) and the sheet. */
export function App() {
  const [selectedId, setSelectedId] = useState(readSelected);
  const [commandSelection, setCommandSelection] = useState<{ session: Session; draft?: string }>();
  // With nothing selected there is nothing to cover, so the sheet starts open.
  const [open, setOpen] = useState(() => readSelected() === undefined);
  // A deleted session cannot stay open: its thread has nothing left to load.
  // The URL is the source of truth for the selection, so read it there.
  const onDeleted = useCallback((id: string) => {
    if (readSelected() !== id) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    window.history.replaceState({}, "", url);
    setSelectedId(undefined);
    setCommandSelection(undefined);
  }, []);
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
  // A handoff door knows only the id and workspace. The catalog may also know the title.
  const known = !selectedId ? undefined : commandSelection?.session.id === selectedId
    ? { ...picker.find(selectedId), ...commandSelection.session } : picker.find(selectedId);

  return <AppShell open={open} onOpenChange={setOpen} attention={picker.attention}
    picker={(layout) => <Picker view={picker.view} prefs={picker.prefs} onPrefs={picker.setPrefs}
      actions={{ ...picker.actions, onSelect: select, onClose: layout === "overlay" && selectedId ? () => setOpen(false) : undefined }} />}
    // `known` is read once, when the thread mounts for this id. A direct URL
    // load before the catalog arrives passes nothing and the store looks it up.
    thread={selectedId ? <ForgerieSession key={selectedId} id={selectedId}
      known={known}
      initialDraft={commandSelection?.session.id === selectedId ? commandSelection.draft : undefined}
      onSwitchSession={switchSession} />
      // The picker covers this area whenever nothing is selected, so it holds no
      // message of its own: the picker is the instruction.
      : <SessionFrame name="No session open" status=""><div className="thread-empty" /></SessionFrame>} />;
}
