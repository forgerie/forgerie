import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, FileDiffIcon, PanelLeftIcon, PencilIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ChangeEntry, Changes, ChangesSource, FileDiff } from "../changes/changesSource";
import {
  commentProblem, linesOf, newNoteId, NOTE_LIMITS, noteRange, placeNotes, selectionBounds, selectionProblem, tapRow, trayProblem,
  type DiffNote, type RowSelection,
} from "../changes/diffNotes";
import { diffDocument, type DiffDocument } from "../changes/diffDocument";
import { fileOrder, fileTree, foldersAbove, treeRows, treeStep, type FileTreeNode } from "../changes/fileTree";
import type { DiffBlock } from "./DiffEditor";
import { shellLayout, type ShellLayout } from "./AppShell";
import { useSheetDrag } from "./useSheetDrag";

// CodeMirror and its language parsers are about 325 kB. They load when a review first shows a diff.
const DiffEditor = lazy(() => import("./DiffEditor").then((module) => ({ default: module.DiffEditor })));

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
/** The note being written: a new one on the selection, or an edit of a placed one. */
type Draft = { type: "new"; text: string; error?: string } | { type: "edit"; id: string; text: string; error?: string };

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const STATE_LABEL: Record<ChangeEntry["state"], string> = {
  modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", copied: "Copied", untracked: "New file", conflicted: "Conflicted",
};
/** The letter an editor's source control view puts beside a changed file. */
const STATE_MARK: Record<ChangeEntry["state"], string> = {
  modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", untracked: "U", conflicted: "!",
};
const entryKeyOf = (note: Pick<DiffNote, "path" | "staged">) => `${note.staged ? "staged" : "unstaged"}:${note.path}`;
const without = (set: ReadonlySet<string>, keys: readonly string[]) => keys.some((key) => set.has(key)) ? new Set([...set].filter((key) => !keys.includes(key))) : set;
const splitPath = (path: string) => {
  const slash = path.lastIndexOf("/", path.length - 2);
  return { folder: path.slice(0, slash + 1), name: path.slice(slash + 1) };
};

/**
 * One file at a time beside a tree of the changed files. The tree docks at
 * the left while the review is as wide as the app's own docked sidebar needs
 * (`shellLayout`), so a desktop window shows both. Narrower, in every Fold
 * posture, the tree is a sheet over the file: the Files button or a swipe
 * right brings it in, and choosing a file puts it away. Either way the open
 * file, its scroll, and any note being written stay as they are.
 */
function Review({ source, notes, focusNoteId, onAdd, onEdit, onRemove, onClose }: ChangesBinding) {
  const titleId = useId();
  const filesId = useId();
  const barId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [changes, setChanges] = useState<Load<Changes>>({ type: "loading" });
  const [diffs, setDiffs] = useState<Record<string, Load<FileDiff>>>({});
  const [current, setCurrent] = useState<string>();
  const [cursor, setCursor] = useState<string>();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [layout, setLayout] = useState<ShellLayout>("overlay");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selection, setSelection] = useState<{ key: string; rows: RowSelection }>();
  const [draft, setDraft] = useState<Draft>();
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const loads = useRef(new Map<string, AbortController>());
  const lifetime = useRef<AbortController>(undefined);
  const pointer = useRef<string>("");
  const pressedBackdrop = useRef(false);
  const focused = useRef(false);
  // Read once, when the changes arrive: a note asked for picks the first file.
  const focusKey = useRef(focusNoteId === undefined ? undefined : notes.find((note) => note.id === focusNoteId));

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open && typeof element.showModal === "function") element.showModal();
  }, []);
  useEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);

  const entries = useMemo(() => changes.type === "ready" ? changes.value.entries : [], [changes]);
  const tree = useMemo(() => fileTree(entries), [entries]);
  const order = useMemo(() => fileOrder(tree).filter((entry) => entry.diffable), [tree]);
  const rows = useMemo(() => treeRows(tree, collapsed), [tree, collapsed]);
  const entry = order.find((item) => item.key === current);

  const readDiff = useCallback((item: ChangeEntry) => {
    loads.current.get(item.key)?.abort();
    const controller = new AbortController();
    loads.current.set(item.key, controller);
    const settle = (value: Load<FileDiff>) => { if (!controller.signal.aborted) setDiffs((known) => ({ ...known, [item.key]: value })); };
    settle({ type: "loading" });
    source.diff(item, controller.signal).then((value) => settle({ type: "ready", value }), (error: unknown) => settle({ type: "failed", message: messageOf(error) }));
  }, [source]);

  const load = useCallback((keep?: string) => {
    lifetime.current?.abort();
    for (const controller of loads.current.values()) controller.abort();
    loads.current.clear();
    const controller = new AbortController();
    lifetime.current = controller;
    setChanges({ type: "loading" });
    setDiffs({});
    // Row positions belong to the diff they were read from.
    setSelection(undefined);
    setDraft(undefined);
    source.changes(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setChanges({ type: "ready", value });
      const nodes = fileTree(value.entries);
      const readable = fileOrder(nodes).filter((item) => item.diffable);
      const asked = focusKey.current && entryKeyOf(focusKey.current);
      const pick = readable.find((item) => item.key === keep) ?? readable.find((item) => item.key === asked) ?? readable[0];
      setCurrent(pick?.key);
      if (pick) { readDiff(pick); setCollapsed((shut) => without(shut, foldersAbove(nodes, pick.key))); }
      // Arriving with several files and nothing asked for, the reader picks one first. Docked, the tree is already there.
      if (keep === undefined) setSheetOpen(readable.length > 1 && !asked);
    }, (error: unknown) => { if (!controller.signal.aborted) setChanges({ type: "failed", message: messageOf(error) }); });
  }, [source, readDiff]);
  useEffect(() => {
    load();
    const reads = loads.current;
    return () => { lifetime.current?.abort(); for (const controller of reads.values()) controller.abort(); };
  }, [load]);

  // The tree docks from the review's own width. A ref callback, because the layout appears only once the changes have.
  const measure = useCallback((element: HTMLDivElement | null) => {
    layoutRef.current = element;
    if (!element) return undefined;
    const resize = () => setLayout(shellLayout(element.getBoundingClientRect().width));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A docked tree needs no sheet. Closing it here means a window that narrows later shows the file, not a sheet over it.
  useEffect(() => { if (layout === "docked") setSheetOpen(false); }, [layout]);
  const overlay = layout === "overlay";
  const hidden = overlay && !sheetOpen;
  useSheetDrag(layoutRef, filesRef, { enabled: overlay && changes.type === "ready" && entries.length > 0, open: sheetOpen, onOpenChange: setSheetOpen });

  // Bring the asked-for note into view once its file has drawn it.
  useEffect(() => {
    if (!focusNoteId || focused.current) return;
    const card = dialog.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(focusNoteId)}"]`);
    if (!card) return;
    focused.current = true;
    card.scrollIntoView?.({ block: "center" });
    card.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  });

  const openFile = (item: ChangeEntry) => {
    const known = diffs[item.key];
    if (!known || known.type === "failed") readDiff(item);
    setCollapsed((shut) => without(shut, foldersAbove(tree, item.key)));
    setCursor(item.key);
    if (item.key !== current) { setCurrent(item.key); bodyRef.current?.scrollTo?.({ top: 0 }); }
    if (overlay) {
      setSheetOpen(false);
      // The sheet took focus with it; the file's name is where the reader is now.
      requestAnimationFrame(() => document.getElementById(barId)?.focus({ preventScroll: true }));
    }
  };
  const toggleFolder = (key: string, open = collapsed.has(key)) =>
    setCollapsed((shut) => open ? without(shut, [key]) : new Set([...shut, key]));
  const onTreeKey = (event: KeyboardEvent, index: number) => {
    const step = treeStep(rows, index, event.key, collapsed);
    if (!step) return;
    event.preventDefault();
    if (step.type === "fold") { toggleFolder(step.key, step.open); return; }
    if (step.type === "open") { const item = order.find((file) => file.key === step.key); if (item) openFile(item); return; }
    const key = rows[step.index]?.node.key;
    if (key === undefined) return;
    setCursor(key);
    filesRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`)?.focus();
  };

  const select = (item: ChangeEntry, picked: RowSelection | undefined, typeNext: boolean) => {
    if (draft?.type === "edit") return;
    setSelection(picked && { key: item.key, rows: picked });
    if (!picked) { setDraft(undefined); return; }
    setDraft((now) => now?.type === "new" ? { type: "new", text: now.text } : { type: "new", text: "" });
    if (typeNext) requestAnimationFrame(() => dialog.current?.querySelector<HTMLTextAreaElement>(".note-editor textarea")?.focus({ preventScroll: true }));
  };
  // A mouse user types next. On a touch screen the keyboard would cover the lines still to tap.
  const tap = (item: ChangeEntry, index: number) =>
    select(item, tapRow(selection?.key === item.key ? selection.rows : undefined, index), pointer.current === "mouse");
  const clearSelection = () => { setSelection(undefined); setDraft(undefined); };

  const addNote = (item: ChangeEntry, lines: DiffDocument["lines"]) => {
    if (draft?.type !== "new" || selection?.key !== item.key) return;
    const picked = linesOf(lines, selection.rows);
    const problem = selectionProblem(item.path, picked) ?? commentProblem(draft.text)
      ?? trayProblem(notes, { path: item.path, comment: draft.text, lines: picked });
    if (problem) { setDraft({ ...draft, error: problem }); return; }
    onAdd({ id: newNoteId(), path: item.path, staged: item.staged, comment: draft.text.trim(), lines: picked });
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

  // Escape or Back puts away the top thing first: the files sheet, then a note being written, then the review.
  const putAway = () => {
    if (overlay && sheetOpen) { setSheetOpen(false); dialog.current?.querySelector<HTMLElement>(".change-files-opener")?.focus(); return true; }
    if (draft || selection) { clearSelection(); return true; }
    return false;
  };
  // Escape is handled before it becomes a close request: Chrome refuses a second cancelled request without a tap between.
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && putAway()) event.preventDefault(); };
  const onCancel = (event: Event) => {
    event.preventDefault();
    if (!putAway()) onClose();
  };
  // When Chrome closes the dialog anyway, the review closes with it rather than stay open and unseen.
  const onNativeClose = () => onClose();
  useEffect(() => {
    const element = dialog.current;
    element?.addEventListener("cancel", onCancel);
    element?.addEventListener("close", onNativeClose);
    return () => { element?.removeEventListener("cancel", onCancel); element?.removeEventListener("close", onNativeClose); };
  });

  const branch = changes.type === "ready" && changes.value.branch ? `on ${changes.value.branch}` : "";
  const count = entries.length === 0 ? branch : `${entries.length} ${entries.length === 1 ? "file" : "files"} ${branch}`.trim();
  const notesOn = (key: string) => notes.filter((note) => entryKeyOf(note) === key);
  const position = entry ? order.indexOf(entry) : -1;
  const previous = order[position - 1];
  const next = position >= 0 ? order[position + 1] : undefined;
  const rowFocus = cursor !== undefined && rows.some((row) => row.node.key === cursor) ? cursor : current ?? rows[0]?.node.key;
  const fileNotes = entry ? notesOn(entry.key) : [];
  return <dialog ref={dialog} className="tree-dialog changes-dialog" aria-labelledby={titleId} onKeyDown={onKeyDown}
    onPointerDown={(event: PointerEvent) => { pointer.current = event.pointerType; pressedBackdrop.current = event.target === dialog.current; }}
    onClick={(event) => { if (event.target === dialog.current && pressedBackdrop.current && !draft) onClose(); pressedBackdrop.current = false; }}>
    <div className="tree-sheet">
      <header className="tree-head">
        <h2 id={titleId}>Changes</h2>
        <span className="tree-count">{count}</span>
        <button type="button" className="icon-button quiet-button" aria-label="Read the changes again" title="Read the changes again"
          disabled={changes.type === "loading"} onClick={() => load(current)}><RefreshCwIcon aria-hidden size={18} /></button>
        <button type="button" className="icon-button quiet-button" aria-label="Close changes" title="Close" onClick={onClose}>
          <XIcon aria-hidden size={18} /></button>
      </header>
      {changes.type === "loading" && <p className="changes-message" role="status">Reading the changes…</p>}
      {changes.type === "failed" && <div className="changes-message" role="alert"><p>{changes.message}</p>
        <button type="button" onClick={() => load()}>Try again</button></div>}
      {changes.type === "ready" && !changes.value.isGitRepo && <p className="changes-message">This folder is not a git repository, so it has no changes to review.</p>}
      {changes.type === "ready" && changes.value.isGitRepo && entries.length === 0 && <p className="changes-message">No changes. The files match the last commit.</p>}
      {entries.length > 0 && <div ref={measure} className="changes-layout" data-layout={layout} data-sheet={hidden ? "closed" : "open"}>
        <nav ref={filesRef} id={filesId} className="changes-files" aria-label="Changed files" aria-hidden={hidden || undefined} inert={hidden}>
          <ul role="tree" aria-label="Changed files" className="file-tree">
            {rows.map((row, index) => <FileTreeRow key={row.node.key} node={row.node} level={row.level} current={current}
              open={!collapsed.has(row.node.key)} focusable={row.node.key === rowFocus}
              notes={row.node.type === "file" ? notesOn(row.node.key).length : 0}
              onActivate={() => { if (row.node.type === "folder") toggleFolder(row.node.key); else if (row.node.entry.diffable) openFile(row.node.entry); }}
              onFocus={() => setCursor(row.node.key)} onKeyDown={(event) => onTreeKey(event, index)} />)}
          </ul>
        </nav>
        {overlay && <div className="changes-scrim" aria-hidden="true" onClick={() => setSheetOpen(false)} />}
        <section className="changes-pane" aria-labelledby={entry ? barId : undefined} aria-label={entry ? undefined : "Diff"}>
          {entry && <div className="change-bar">
            {overlay && <button type="button" className="app-opener change-files-opener" aria-label="Show changed files" title="Files"
              aria-expanded={sheetOpen} aria-controls={filesId} onClick={() => setSheetOpen(true)}><PanelLeftIcon aria-hidden size={16} /></button>}
            <div className="change-bar-title">
              <h3 id={barId} tabIndex={-1} className="change-path" title={entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}>
                {splitPath(entry.path).folder && <span className="change-folder">{splitPath(entry.path).folder}</span>}<span className="change-name">{splitPath(entry.path).name}</span>
              </h3>
              <p className="change-facts">
                <span>{STATE_LABEL[entry.state]}{entry.staged ? ", staged" : ""}</span>
                {order.length > 1 && <span>File {position + 1} of {order.length}</span>}
                {fileNotes.length > 0 && <span className="change-noted">{fileNotes.length === 1 ? "1 note" : `${fileNotes.length} notes`}</span>}
              </p>
            </div>
            <button type="button" className="icon-button quiet-button" aria-label="Previous file" title={previous ? `Previous file: ${previous.path}` : "This is the first file"}
              disabled={!previous} onClick={() => { if (previous) openFile(previous); }}><ChevronUpIcon aria-hidden size={18} /></button>
            <button type="button" className="icon-button quiet-button" aria-label="Next file" title={next ? `Next file: ${next.path}` : "This is the last file"}
              disabled={!next} onClick={() => { if (next) openFile(next); }}><ChevronDownIcon aria-hidden size={18} /></button>
          </div>}
          <div ref={bodyRef} className="changes-body">
            {entry ? <FileBody key={entry.key} path={entry.path} diff={diffs[entry.key]} notes={fileNotes}
              selection={selection?.key === entry.key ? selection.rows : undefined} draft={draft}
              reveal={focusNoteId && !focused.current ? focusNoteId : undefined} onRevealed={() => { focused.current = true; }}
              onRetry={() => readDiff(entry)} onTap={(index) => tap(entry, index)} onSelectLines={(picked) => select(entry, picked, true)}
              onDraft={(text) => setDraft((now) => now && { ...now, text, error: undefined })}
              onAdd={(lines) => addNote(entry, lines)} onCancel={clearSelection}
              onEdit={(note) => { setSelection(undefined); setDraft({ type: "edit", id: note.id, text: note.comment }); }}
              onSave={saveEdit} onRemove={onRemove} />
              : <p className="changes-message">Git lists only whole folders here, such as other repositories, so there is no diff to show.</p>}
          </div>
        </section>
      </div>}
      {notes.length > 0 && <footer className="changes-foot">
        <p role="status">{notes.length === 1 ? "1 note goes" : `${notes.length} notes go`} with your next message.</p>
        <button type="button" className="primary changes-write" onClick={() => {
          onClose();
          // The notes are written; the message is next.
          requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-composer-input]")?.focus());
        }}>Write message</button>
      </footer>}
    </div>
  </dialog>;
}

/** One row of the files tree: a group, a folder, or a file with its change letter and note count. */
function FileTreeRow({ node, level, current, open, focusable, notes, onActivate, onFocus, onKeyDown }: {
  node: FileTreeNode; level: number; current: string | undefined; open: boolean; focusable: boolean; notes: number;
  onActivate: () => void; onFocus: () => void; onKeyDown: (event: KeyboardEvent) => void;
}) {
  const style = { "--level": level } as CSSProperties;
  const shared = { role: "treeitem", "aria-level": level, tabIndex: focusable ? 0 : -1, "data-row": node.key, style, onClick: onActivate, onFocus, onKeyDown };
  if (node.type === "folder") {
    return <li {...shared} className="file-row" data-kind={node.group ? "group" : "folder"} aria-expanded={open}>
      <ChevronRightIcon aria-hidden size={14} className="file-chevron" />
      <span className="file-name">{node.name}</span>
    </li>;
  }
  const { entry } = node;
  const words = entry.diffable ? `${STATE_LABEL[entry.state]}${entry.staged ? ", staged" : ""}` : "Untracked folder, no diff";
  return <li {...shared} className="file-row" data-kind="file" aria-selected={entry.key === current} aria-disabled={!entry.diffable || undefined}
    title={entry.diffable ? `${entry.oldPath ? `${entry.oldPath} → ` : ""}${entry.path}` : `${entry.path}: git lists this folder as a whole, such as another repository, so it has no diff here.`}>
    <span className="file-mark" data-state={entry.state} aria-hidden>{STATE_MARK[entry.state]}</span>
    <span className="file-name">{node.name}</span>
    {notes > 0 && <span className="file-noted" aria-hidden>{notes}</span>}
    <span className="sr-only">, {words}{notes > 0 ? `, ${notes === 1 ? "1 note" : `${String(notes)} notes`}` : ""}</span>
  </li>;
}

interface FileBodyProps {
  path: string;
  diff: Load<FileDiff> | undefined;
  notes: DiffNote[];
  selection: RowSelection | undefined;
  draft: Draft | undefined;
  /** A note to bring into view once the file draws it. */
  reveal: string | undefined;
  onRevealed: () => void;
  onRetry: () => void;
  onTap: (line: number) => void;
  onSelectLines: (rows: RowSelection) => void;
  onDraft: (text: string) => void;
  onAdd: (rows: DiffDocument["lines"]) => void;
  onCancel: () => void;
  onEdit: (note: DiffNote) => void;
  onSave: () => void;
  onRemove: (id: string) => void;
}

function FileBody({ path, diff, notes, selection, draft, reveal, onRevealed, onRetry, onTap, onSelectLines, onDraft, onAdd, onCancel, onEdit, onSave, onRemove }: FileBodyProps) {
  const rows = diff?.type === "ready" ? diff.value.rows : undefined;
  const document = useMemo(() => rows && diffDocument(rows), [rows]);
  const placement = useMemo(() => document ? placeNotes(document.lines, notes) : undefined, [document, notes]);
  if (!diff || diff.type === "loading") return <p className="change-message" role="status">Reading the diff…</p>;
  if (diff.type === "failed") return <div className="change-message" role="alert"><p>{diff.message}</p><button type="button" onClick={onRetry}>Try again</button></div>;
  const { value } = diff;
  if (value.binary) return <p className="change-message">A binary file. It has no lines to note.</p>;
  if (!document || !placement || document.lines.length === 0) return <p className="change-message">No line changes, such as a change to the file's mode only.</p>;
  const bounds = selection ? selectionBounds(selection) : undefined;
  const card = (note: DiffNote) => draft?.type === "edit" && draft.id === note.id
    ? <NoteEditor key={note.id} range={noteRange(note.lines)} draft={draft} submit="Save note" onDraft={onDraft} onSubmit={onSave} onCancel={onCancel} />
    : <NoteCard key={note.id} note={note} onEdit={() => onEdit(note)} onRemove={() => onRemove(note.id)} />;
  const selected = selection && linesOf(document.lines, selection);
  const blocks: DiffBlock[] = [];
  if (bounds && draft?.type === "new" && selected) blocks.push({ key: "draft", line: bounds[1], node: <NoteEditor range={noteRange(selected)} draft={draft} submit="Add note"
    hint={selected.length === 0 ? undefined : "Tap another line to stretch the selection."}
    onDraft={onDraft} onSubmit={() => onAdd(document.lines)} onCancel={onCancel} /> });
  for (const [line, ended] of [...placement.ends].sort(([a], [b]) => a - b)) {
    for (const note of ended) blocks.push({ key: `note:${note.id}`, line, node: card(note) });
  }
  return <div className="diff" data-selecting={selection ? true : undefined}>
    {placement.moved.length > 0 && <div className="diff-moved">
      <p className="change-message">The code under {placement.moved.length === 1 ? "this note" : "these notes"} changed after you wrote {placement.moved.length === 1 ? "it" : "them"}. {placement.moved.length === 1 ? "It still goes" : "They still go"} with your next message as written.</p>
      {placement.moved.map(card)}
    </div>}
    <Suspense fallback={<p className="change-message" role="status">Reading the diff…</p>}>
      <DiffEditor path={path} document={document} covered={placement.covered} selected={bounds} blocks={blocks}
        reveal={reveal && `note:${reveal}`} onRevealed={onRevealed} onTapLine={onTap} onSelectLines={onSelectLines} />
    </Suspense>
    {value.truncated && <p className="change-message">Git stopped reading at 2 MB, so the end of this diff is not shown.</p>}
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
