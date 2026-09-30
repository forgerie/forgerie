import { useCallback, useEffect, useState } from "react";
import { ForgerieSession } from "./ForgerieSession";
import { usePicker } from "./usePicker";
import type { Row } from "./picker/board";
import { AppShell } from "./ui/AppShell";
import { Picker } from "./ui/Picker";
import { SessionFrame } from "./ui/SessionFrame";

const readSelected = () => new URLSearchParams(window.location.search).get("session")?.trim() || undefined;

/** Composition root: owns the selected session (in the URL) and the sheet. */
export function App() {
  const [selectedId, setSelectedId] = useState(readSelected);
  // With nothing selected there is nothing to cover, so the sheet starts open.
  const [open, setOpen] = useState(() => readSelected() === undefined);
  const picker = usePicker(selectedId);
  useEffect(() => {
    const onPop = () => setSelectedId(readSelected());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const select = useCallback((row: Row) => {
    setOpen(false);
    if (row.session.id === selectedId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("session", row.session.id);
    window.history.pushState({}, "", url);
    setSelectedId(row.session.id);
  }, [selectedId]);

  return <AppShell open={open} onOpenChange={setOpen} attention={picker.attention}
    picker={(layout) => <Picker view={picker.view} prefs={picker.prefs} onPrefs={picker.setPrefs}
      actions={{ onSelect: select, onRetry: picker.retry, onClose: layout === "overlay" && selectedId ? () => setOpen(false) : undefined }} />}
    // `known` is read once, when the thread mounts for this id. A direct URL
    // load before the catalog arrives passes nothing and the store looks it up.
    thread={selectedId ? <ForgerieSession key={selectedId} id={selectedId} known={picker.find(selectedId)} />
      // The picker covers this area whenever nothing is selected, so it holds no
      // message of its own: the picker is the instruction.
      : <SessionFrame name="No session open" status=""><div className="thread-empty" /></SessionFrame>} />;
}
