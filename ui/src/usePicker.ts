import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { attention, createLocationResolver, rows as boardRows, sections as boardSections } from "./picker/board";
import { createCatalogStore } from "./picker/catalogStore";
import { readPrefs, writePrefs, type PickerPrefs } from "./picker/prefs";
import { browserTransport } from "./sessionStore";
import type { PickerView } from "./ui/Picker";

const MINUTE = 60_000;
const storage = () => { try { return window.localStorage; } catch { return undefined; } };

/** Binding: the only hook that reads the machine catalog. Views get a PickerView. */
export function usePicker(selectedId: string | undefined) {
  const [store] = useState(() => createCatalogStore(browserTransport));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => { void store.start(); return store.dispose; }, [store]);
  // Shorthand time changes at most once a minute, so re-derive once a minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), MINUTE); return () => clearInterval(timer); }, []);
  const [prefs, setPrefsState] = useState(() => readPrefs(storage()));
  const setPrefs = useCallback((next: PickerPrefs) => { setPrefsState(next); writePrefs(storage(), next); }, []);

  const locate = useMemo(() => createLocationResolver(state.projects, []), [state.projects]);
  const rows = useMemo(() => boardRows({ sessions: state.sessions, statuses: state.statuses, activities: state.activities, unread: state.unread, locate, now }),
    [state.sessions, state.statuses, state.activities, state.unread, locate, now]);
  const view: PickerView = useMemo(() => ({
    connection: state.connection,
    sections: boardSections(rows, { grouping: prefs.grouping, showArchived: prefs.showArchived, now }),
    machines: 1,
    selectedId,
    archivedCount: rows.filter((row) => row.state === "archived").length,
  }), [state.connection, rows, prefs.grouping, prefs.showArchived, now, selectedId]);
  const find = useCallback((id: string) => {
    const session = state.sessions.find((candidate) => candidate.id === id);
    return session ? { id: session.id, cwd: session.cwd, ...(session.name ? { name: session.name } : {}) } : undefined;
  }, [state.sessions]);
  return { view, prefs, setPrefs, find, attention: attention(rows), retry: store.retry };
}
