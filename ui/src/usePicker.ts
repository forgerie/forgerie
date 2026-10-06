import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { attention, createLocationResolver, rows as boardRows, sections as boardSections, type Row } from "./picker/board";
import { archiveAvailability, nextWaiting, type ArchiveAvailability } from "./picker/archiveNext";
import { createCatalogStore } from "./picker/catalogStore";
import type { RowCommandKind } from "./picker/commands";
import { readPrefs, writePrefs, type PickerPrefs } from "./picker/prefs";
import { createRowActions } from "./picker/rowActions";
import { writeClipboardText } from "./clipboard";
import { browserTransport } from "./sessionStore";
import type { PickerActions, PickerView } from "./ui/Picker";

const MINUTE = 60_000;
const storage = () => { try { return window.localStorage; } catch { return undefined; } };

/** Binding: the only hook that reads or writes the machine catalog. Views get a PickerView. */
export function usePicker(selectedId: string | undefined, options: { onDeleted?: (id: string) => void } = {}) {
  const [store] = useState(() => createCatalogStore(browserTransport));
  const onDeleted = useRef(options.onDeleted);
  useEffect(() => { onDeleted.current = options.onDeleted; }, [options.onDeleted]);
  const [commands] = useState(() => createRowActions({
    writes: store, copy: writeClipboardText, onDeleted: (id) => onDeleted.current?.(id),
  }));
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const actionState = useSyncExternalStore(commands.subscribe, commands.getSnapshot);
  useEffect(() => { void store.start(); return () => { store.dispose(); commands.dispose(); }; }, [store, commands]);
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
    sections: boardSections(rows, { grouping: prefs.grouping, showArchived: prefs.showArchived, allPinned: prefs.allPinned, selectedId, now }),
    machines: 1,
    selectedId,
    archivedCount: rows.filter((row) => row.state === "archived").length,
    toast: actionState.toast,
    pending: actionState.pending,
  }), [state.connection, rows, prefs.grouping, prefs.showArchived, prefs.allPinned, now, selectedId, actionState]);
  const find = useCallback((id: string) => {
    const session = state.sessions.find((candidate) => candidate.id === id);
    return session ? { id: session.id, cwd: session.cwd, ...(session.name ? { name: session.name } : {}) } : undefined;
  }, [state.sessions]);
  const latestRows = useRef(rows);
  // Layout, not passive: a click right after a render must read that render's rows.
  useLayoutEffect(() => { latestRows.current = rows; }, [rows]);
  /** Whether the open session can be archived now. A write in flight on it counts as busy. */
  const archiveState = useCallback((id: string): ArchiveAvailability => actionState.pending.has(id)
    ? { type: "blocked", reason: "Archiving" } : archiveAvailability(rows.find((row) => row.session.id === id)), [rows, actionState.pending]);
  /**
   * Archive one session with the usual undo offer, then name the next session that wants
   * the reader. Nothing moves when the server refuses; its reason shows in the message line.
   */
  const archiveAndNext = useCallback(async (id: string): Promise<ArchiveOutcome> => {
    const row = latestRows.current.find((candidate) => candidate.session.id === id);
    if (!row || archiveAvailability(row).type !== "ready") return { type: "refused" };
    if (!await commands.archive({ id, cwd: row.session.cwd, name: row.session.name })) return { type: "refused" };
    const next = nextWaiting(latestRows.current, id);
    return next ? { type: "next", session: { id: next.session.id, cwd: next.session.cwd, ...(next.session.name ? { name: next.session.name } : {}) } }
      : { type: "allClear" };
  }, [commands]);
  const rowActions: Omit<PickerActions, "onSelect" | "onClose"> = useMemo(() => ({
    onRetry: store.retry,
    onCommand: (row: Row, kind: RowCommandKind) => void commands.run(kind, { id: row.session.id, cwd: row.session.cwd, name: row.session.name }),
    onUndo: () => void commands.undo(),
    onDismissToast: commands.dismiss,
  }), [store, commands]);
  return { view, prefs, setPrefs, find, attention: attention(rows), actions: rowActions, archiveState, archiveAndNext };
}

export type ArchiveOutcome =
  | { type: "next"; session: { id: string; cwd: string; name?: string } }
  /** Nothing else waits. */
  | { type: "allClear" }
  /** The server refused, or the session cannot be archived now. Nothing changed. */
  | { type: "refused" };
