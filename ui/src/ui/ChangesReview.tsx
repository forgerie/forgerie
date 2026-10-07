import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronRightIcon, FileDiffIcon, PencilIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ChangeEntry, Changes, ChangesSource, FileDiff } from "../changes/changesSource";
import {
  commentProblem, linesOf, newNoteId, NOTE_LIMITS, noteRange, placeNotes, selectionBounds, selectionProblem, tapRow, trayProblem,
  type DiffNote, type RowSelection,
} from "../changes/diffNotes";
import { isCodeRow, type DiffRow } from "../changes/unifiedDiff";

export interface ChangesBinding {
  source: ChangesSource;
  /** Notes waiting for the next message, from every file. */
  notes: readonly DiffNote[];
  /** Open with this note in view. */
  focusNoteId?: string | undefined;
  onAdd: (note: DiffNote) => void;
  onEdit: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

/** Header control. The count says notes wait, so the reader knows the review holds something unsent. */
export function ChangesOpener({ notes, onOpen }: { notes: number; onOpen: () => void }) {
  const label = notes > 0 ? `Review changes, ${notes} ${notes === 1 ? "note" : "notes"} waiting` : "Review changes";
  return <button type="button" className="icon-button quiet-button changes-opener" aria-label={label} title={label} onClick={onOpen}>
    <FileDiffIcon aria-hidden size={18} />
    {notes > 0 && <span className="changes-badge" aria-hidden>{notes}</span>}
  </button>;
}

/**
 * System organism: the session's git changes as a modal, where the reader
 * selects diff lines and writes notes for the agent. The tray owns the notes;
 * this view owns what is open, selected, and being written. Read-only on git.
 */
export function ChangesReview(props: ChangesBinding) {
  return createPortal(<Review {...props} />, document.body);
}

type Load<T> = { type: "loading" } | { type: "ready"; value: T } | { type: "failed"; message: string };
interface FileView { open: boolean; diff?: Load<FileDiff> }
/** The note being written: a new one on the selection, or an edit of a placed one. */
type Draft = { type: "new"; text: string; error?: string } | { type: "edit"; id: string; text: string; error?: string };

/** Files open on arrival while there are this few of them. More would read as a wall of code. */
const OPEN_ON_ARRIVAL = 6;
/** Rows drawn before "Show more". A 2 MB diff is tens of thousands of rows. */
const ROW_PAGE = 1500;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const STATE_LABEL: Record<ChangeEntry["state"], string> = {
  modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", copied: "Copied", untracked: "New file", conflicted: "Conflicted",
};

function Review({ source, notes, focusNoteId, onAdd, onEdit, onRemove, onClose }: ChangesBinding) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [changes, setChanges] = useState<Load<Changes>>({ type: "loading" });
  const [files, setFiles] = useState<Record<string, FileView>>({});
  const [selection, setSelection] = useState<{ key: string; rows: RowSelection }>();
  const [draft, setDraft] = useState<Draft>();
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const loads = useRef(new Map<string, AbortController>());
  const lifetime = useRef<AbortController>(undefined);
  const pointer = useRef<string>("");
  const pressedBackdrop = useRef(false);
  const focused = useRef(false);
  // Notes decide only which files open on arrival; a new note must not read the changes again.
  const notesNow = useRef(notes);
  notesNow.current = notes;

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open && typeof element.showModal === "function") element.showModal();
  }, []);
  useEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);

  const readDiff = useCallback((entry: ChangeEntry) => {
    loads.current.get(entry.key)?.abort();
    const controller = new AbortController();
    loads.current.set(entry.key, controller);
    setFiles((current) => ({ ...current, [entry.key]: { open: true, diff: { type: "loading" } } }));
    source.diff(entry, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setFiles((current) => ({ ...current, [entry.key]: { open: current[entry.key]?.open ?? true, diff: { type: "ready", value } } })); },
      (error: unknown) => { if (!controller.signal.aborted) setFiles((current) => ({ ...current, [entry.key]: { open: current[entry.key]?.open ?? true, diff: { type: "failed", message: messageOf(error) } } })); });
  }, [source]);

  const load = useCallback((keepOpen?: ReadonlySet<string>) => {
    lifetime.current?.abort();
    for (const controller of loads.current.values()) controller.abort();
    loads.current.clear();
    const controller = new AbortController();
    lifetime.current = controller;
    setChanges({ type: "loading" });
    // Row positions belong to the diff they were read from.
    setSelection(undefined);
    setDraft(undefined);
    source.changes(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setChanges({ type: "ready", value });
      const readable = value.entries.filter((entry) => entry.diffable);
      const noted = new Set(notesNow.current.map((note) => `${note.staged ? "staged" : "unstaged"}:${note.path}`));
      const opens = (entry: ChangeEntry) => entry.diffable && (keepOpen ? keepOpen.has(entry.key)
        : readable.length <= OPEN_ON_ARRIVAL || noted.has(entry.key));
      setFiles(Object.fromEntries(value.entries.map((entry) => [entry.key, { open: opens(entry) }])));
      for (const entry of value.entries) if (opens(entry)) readDiff(entry);
    }, (error: unknown) => { if (!controller.signal.aborted) setChanges({ type: "failed", message: messageOf(error) }); });
  }, [source, readDiff]);
  useEffect(() => {
    load();
    const reads = loads.current;
    return () => { lifetime.current?.abort(); for (const controller of reads.values()) controller.abort(); };
  }, [load]);

  // Bring the asked-for note into view once its file has drawn it.
  useEffect(() => {
    if (!focusNoteId || focused.current) return;
    const card = dialog.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(focusNoteId)}"]`);
    if (!card) return;
    focused.current = true;
    card.scrollIntoView?.({ block: "center" });
    card.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  });

  const toggle = (entry: ChangeEntry) => {
    const view = files[entry.key];
    const open = !view?.open;
    setFiles((current) => ({ ...current, [entry.key]: { ...current[entry.key], open } }));
    if (open && (!view?.diff || view.diff.type === "failed")) readDiff(entry);
  };
  const refresh = () => load(new Set(Object.entries(files).flatMap(([key, view]) => view.open ? [key] : [])));

  const tap = (entry: ChangeEntry, index: number, event: MouseEvent) => {
    // A drag that selected text is for copying, not for a note.
    const text = window.getSelection?.();
    if (text && !text.isCollapsed && event.currentTarget.contains(text.anchorNode)) return;
    if (draft?.type === "edit") return;
    const rows = selection?.key === entry.key ? tapRow(selection.rows, index) : tapRow(undefined, index);
    setSelection(rows && { key: entry.key, rows });
    if (!rows) { setDraft(undefined); return; }
    setDraft((current) => current?.type === "new" ? { type: "new", text: current.text } : { type: "new", text: "" });
    // A mouse user types next. On a touch screen the keyboard would cover the lines still to tap.
    if (pointer.current === "mouse") requestAnimationFrame(() => dialog.current?.querySelector<HTMLTextAreaElement>(".note-editor textarea")?.focus({ preventScroll: true }));
  };
  const clearSelection = () => { setSelection(undefined); setDraft(undefined); };

  const addNote = (entry: ChangeEntry, rows: readonly DiffRow[]) => {
    if (draft?.type !== "new" || selection?.key !== entry.key) return;
    const lines = linesOf(rows, selection.rows);
    const problem = selectionProblem(entry.path, lines) ?? commentProblem(draft.text)
      ?? trayProblem(notes, { path: entry.path, comment: draft.text, lines });
    if (problem) { setDraft({ ...draft, error: problem }); return; }
    onAdd({ id: newNoteId(), path: entry.path, staged: entry.staged, comment: draft.text.trim(), lines });
    clearSelection();
  };
  const saveEdit = () => {
    if (draft?.type !== "edit") return;
    const note = notes.find((item) => item.id === draft.id);
    if (!note) { setDraft(undefined); return; }
    const problem = commentProblem(draft.text) ?? trayProblem(notes, { ...note, comment: draft.text }, note.id);
    if (problem) { setDraft({ ...draft, error: problem }); return; }
    onEdit(note.id, draft.text.trim());
    setDraft(undefined);
  };

  // Escape puts away a note being written before it closes the review.
  const onCancel = (event: Event) => {
    event.preventDefault();
    if (draft || selection) clearSelection();
    else onClose();
  };
  useEffect(() => {
    const element = dialog.current;
    element?.addEventListener("cancel", onCancel);
    return () => element?.removeEventListener("cancel", onCancel);
  });

  const entries = changes.type === "ready" ? changes.value.entries : [];
  const branch = changes.type === "ready" && changes.value.branch ? `on ${changes.value.branch}` : "";
  const count = entries.length === 0 ? branch : `${entries.length} ${entries.length === 1 ? "file" : "files"} ${branch}`.trim();
  return <dialog ref={dialog} className="tree-dialog changes-dialog" aria-labelledby={titleId}
    onPointerDown={(event: PointerEvent) => { pointer.current = event.pointerType; pressedBackdrop.current = event.target === dialog.current; }}
    onClick={(event) => { if (event.target === dialog.current && pressedBackdrop.current && !draft) onClose(); pressedBackdrop.current = false; }}>
    <div className="tree-sheet">
      <header className="tree-head">
        <h2 id={titleId}>Changes</h2>
        <span className="tree-count">{count}</span>
        <button type="button" className="icon-button quiet-button" aria-label="Read the changes again" title="Read the changes again"
          disabled={changes.type === "loading"} onClick={refresh}><RefreshCwIcon aria-hidden size={18} /></button>
        <button type="button" className="icon-button quiet-button" aria-label="Close changes" title="Close" onClick={onClose}>
          <XIcon aria-hidden size={18} /></button>
      </header>
      <div className="changes-body">
        {changes.type === "loading" && <p className="changes-message" role="status">Reading the changes…</p>}
        {changes.type === "failed" && <div className="changes-message" role="alert"><p>{changes.message}</p>
          <button type="button" onClick={() => load()}>Try again</button></div>}
        {changes.type === "ready" && !changes.value.isGitRepo && <p className="changes-message">This folder is not a git repository, so it has no changes to review.</p>}
        {changes.type === "ready" && changes.value.isGitRepo && entries.length === 0 && <p className="changes-message">No changes. The files match the last commit.</p>}
        {entries.map((entry) => <ChangeFile key={entry.key} entry={entry} view={files[entry.key]}
          notes={notes.filter((note) => note.path === entry.path && note.staged === entry.staged)}
          selection={selection?.key === entry.key ? selection.rows : undefined} draft={draft}
          onToggle={() => toggle(entry)} onRetry={() => readDiff(entry)} onTap={(index, event) => tap(entry, index, event)}
          onDraft={(text) => setDraft((current) => current && { ...current, text, error: undefined })}
          onAdd={(rows) => addNote(entry, rows)} onCancel={clearSelection}
          onEdit={(note) => { setSelection(undefined); setDraft({ type: "edit", id: note.id, text: note.comment }); }}
          onSave={saveEdit} onRemove={onRemove} />)}
      </div>
      {notes.length > 0 && <footer className="changes-foot">
        <p role="status">{notes.length === 1 ? "1 note goes" : `${notes.length} notes go`} with your next message.</p>
        <button type="button" className="primary changes-write" onClick={() => {
          onClose();
          // The notes are written; the message is next.
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus());
        }}>Write message</button>
      </footer>}
    </div>
  </dialog>;
}

interface ChangeFileProps {
  entry: ChangeEntry;
  view: FileView | undefined;
  notes: DiffNote[];
  selection: RowSelection | undefined;
  draft: Draft | undefined;
  onToggle: () => void;
  onRetry: () => void;
  onTap: (index: number, event: MouseEvent) => void;
  onDraft: (text: string) => void;
  onAdd: (rows: readonly DiffRow[]) => void;
  onCancel: () => void;
  onEdit: (note: DiffNote) => void;
  onSave: () => void;
  onRemove: (id: string) => void;
}

function ChangeFile({ entry, view, notes, selection, draft, onToggle, onRetry, onTap, onDraft, onAdd, onCancel, onEdit, onSave, onRemove }: ChangeFileProps) {
  const headId = useId();
  const slash = entry.path.lastIndexOf("/", entry.path.length - 2);
  const folder = entry.path.slice(0, slash + 1);
  const name = entry.path.slice(slash + 1);
  const open = view?.open === true;
  return <section className="change-file" aria-labelledby={headId}>
    <h3 className="change-file-head">
      <button type="button" id={headId} aria-expanded={entry.diffable ? open : undefined} disabled={!entry.diffable} onClick={onToggle}>
        <ChevronRightIcon aria-hidden size={16} className="change-chevron" />
        <span className="change-path" title={!entry.diffable ? `${entry.path}: git lists this folder as a whole, such as another repository, so it has no diff here.`
          : entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}>
          {folder && <span className="change-folder">{folder}</span>}<span className="change-name">{name}</span>
        </span>
        <span className="change-facts">
          {notes.length > 0 && <span className="change-noted">{notes.length === 1 ? "1 note" : `${notes.length} notes`}</span>}
          <span>{entry.diffable ? `${STATE_LABEL[entry.state]}${entry.staged ? ", staged" : ""}` : "Untracked folder, no diff"}</span>
        </span>
      </button>
    </h3>
    {open && <FileBody diff={view.diff} notes={notes} selection={selection} draft={draft} onRetry={onRetry} onTap={onTap}
      onDraft={onDraft} onAdd={onAdd} onCancel={onCancel} onEdit={onEdit} onSave={onSave} onRemove={onRemove} />}
  </section>;
}

function FileBody({ diff, notes, selection, draft, onRetry, onTap, onDraft, onAdd, onCancel, onEdit, onSave, onRemove }:
  Omit<ChangeFileProps, "entry" | "view" | "onToggle"> & { diff: Load<FileDiff> | undefined }) {
  const [shown, setShown] = useState(ROW_PAGE);
  const rows = diff?.type === "ready" ? diff.value.rows : undefined;
  const placement = useMemo(() => rows ? placeNotes(rows, notes) : undefined, [rows, notes]);
  if (!diff || diff.type === "loading") return <p className="change-message" role="status">Reading the diff…</p>;
  if (diff.type === "failed") return <div className="change-message" role="alert"><p>{diff.message}</p><button type="button" onClick={onRetry}>Try again</button></div>;
  const { value } = diff;
  if (value.binary) return <p className="change-message">A binary file. It has no lines to note.</p>;
  if (!rows || !placement || !rows.some(isCodeRow)) return <p className="change-message">No line changes, such as a change to the file's mode only.</p>;
  const [from, to] = selection ? selectionBounds(selection) : [-1, -1];
  const card = (note: DiffNote) => draft?.type === "edit" && draft.id === note.id
    ? <NoteEditor key={note.id} range={noteRange(note.lines)} draft={draft} submit="Save note" onDraft={onDraft} onSubmit={onSave} onCancel={onCancel} />
    : <NoteCard key={note.id} note={note} onEdit={() => onEdit(note)} onRemove={() => onRemove(note.id)} />;
  const selected = selection && linesOf(rows, selection);
  return <div className="diff" data-selecting={selection ? true : undefined}>
    {placement.moved.length > 0 && <div className="diff-moved">
      <p className="change-message">The code under {placement.moved.length === 1 ? "this note" : "these notes"} changed after you wrote {placement.moved.length === 1 ? "it" : "them"}. {placement.moved.length === 1 ? "It still goes" : "They still go"} with your next message as written.</p>
      {placement.moved.map(card)}
    </div>}
    {rows.slice(0, shown).map((row, index) => {
      if (row.kind === "meta") return null;
      const inSelection = index >= from && index <= to;
      const ends = placement.ends.get(index);
      return <div key={index} className="diff-chunk">
        <DiffLine row={row} selected={inSelection} noted={placement.covered.has(index)} extending={!!selection && !inSelection}
          onTap={(event) => onTap(index, event)} />
        {index === to && draft?.type === "new" && selected && <NoteEditor range={noteRange(selected)} draft={draft} submit="Add note"
          hint={selected.length === 0 ? undefined : "Tap another line to stretch the selection."}
          onDraft={onDraft} onSubmit={() => onAdd(rows)} onCancel={onCancel} />}
        {ends?.map(card)}
      </div>;
    })}
    {rows.length > shown && <button type="button" className="diff-more" onClick={() => setShown((count) => count + ROW_PAGE)}>
      Show {Math.min(ROW_PAGE, rows.length - shown).toLocaleString()} more lines</button>}
    {value.truncated && <p className="change-message">Git stopped reading at 2 MB, so the end of this diff is not shown.</p>}
  </div>;
}

function DiffLine({ row, selected, noted, extending, onTap }: { row: DiffRow; selected: boolean; noted: boolean; extending: boolean; onTap: (event: MouseEvent) => void }) {
  if (!isCodeRow(row)) return <div className="diff-row" data-kind={row.kind}><span className="diff-text">{row.text}</span></div>;
  const oldNumber = "oldLineNumber" in row ? row.oldLineNumber : undefined;
  const newNumber = "newLineNumber" in row ? row.newLineNumber : undefined;
  const where = row.kind === "remove" ? `removed line ${oldNumber}` : row.kind === "add" ? `added line ${newNumber}` : `line ${newNumber}`;
  return <div className="diff-row" data-kind={row.kind} data-selected={selected || undefined} data-noted={noted || undefined} onClick={onTap}>
    <button type="button" className="diff-gutter" aria-pressed={selected} aria-label={extending ? `Stretch the selection to ${where}` : `Select ${where}`}
      // The row's click handles the press, so the button's own click does not count twice.
      onClick={(event) => { event.stopPropagation(); onTap(event); }}>
      <span>{oldNumber}</span><span>{newNumber}</span>
    </button>
    <span className="diff-sign" aria-hidden>{row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}</span>
    <span className="diff-text">{row.text}</span>
  </div>;
}

function NoteEditor({ range, draft, submit, hint, onDraft, onSubmit, onCancel }: {
  range: string; draft: Draft; submit: string; hint?: string | undefined;
  onDraft: (text: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  const labelId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSubmit(); }
  };
  return <div className="note-editor diff-note">
    <label id={labelId} className="diff-note-range">{range ? `Note on ${rangeWords(range)}` : "Note"}</label>
    <textarea aria-labelledby={labelId} rows={2} maxLength={NOTE_LIMITS.commentChars} value={draft.text} placeholder="What should the agent do with these lines?"
      onChange={(event) => onDraft(event.target.value)} onKeyDown={onKeyDown} aria-invalid={draft.error ? true : undefined} />
    {draft.error ? <p className="note-error" role="alert">{draft.error}</p> : hint && <p className="note-hint">{hint}</p>}
    <div className="note-actions">
      <button type="button" className="note-cancel" onClick={onCancel}>Cancel</button>
      <button type="button" className="primary note-submit" onClick={onSubmit} aria-keyshortcuts="Control+Enter Meta+Enter">{submit}</button>
    </div>
  </div>;
}

function NoteCard({ note, onEdit, onRemove }: { note: DiffNote; onEdit: () => void; onRemove: () => void }) {
  return <div className="diff-note" data-note-id={note.id}>
    <div className="diff-note-head">
      <span className="diff-note-range">Note on {rangeWords(noteRange(note.lines))}</span>
      <button type="button" className="icon-button quiet-button" aria-label="Edit note" title="Edit note" onClick={onEdit}><PencilIcon aria-hidden size={15} /></button>
      <button type="button" className="icon-button quiet-button" aria-label="Remove note" title="Remove note" onClick={onRemove}><Trash2Icon aria-hidden size={15} /></button>
    </div>
    <p className="diff-note-text">{note.comment}</p>
  </div>;
}

/** "line 12", "lines 12–18", "old line 4". */
export function rangeWords(range: string): string {
  const old = range.startsWith("old ");
  const span = old ? range.slice(4) : range;
  return `${old ? "old " : ""}${span.includes("–") ? "lines" : "line"} ${span}`;
}
