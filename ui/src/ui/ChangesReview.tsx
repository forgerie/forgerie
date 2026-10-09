import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, ChevronUpIcon, FileDiffIcon, FilePenIcon, LinkIcon, PanelLeftIcon, PencilIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import type { ChangeEntry, Changes, ChangesSource, FileDiff } from "../changes/changesSource";
import {
  commentProblem, linesOf, newNoteId, NOTE_LIMITS, noteRange, placeNotes, selectionBounds, selectionProblem, tapRow, trayProblem,
  type DiffNote, type RowSelection,
} from "../changes/diffNotes";
import { diffDocument, type DiffDocument } from "../changes/diffDocument";
import { fileOrder, fileTree, foldersAbove, treeRows, treeStep, type FileTreeNode } from "../changes/fileTree";
import { dirtyPaths, isDirty, type LockReason } from "./textBuffers";
import { fileKey, folderRows, folderStepRows, type FolderRow } from "./lazyTree";
import { keyStep } from "./treeKeys";
import { useTextFiles, type TextFileSource } from "./useTextFiles";
import { TreeItem, type TreeItemTone } from "./TreeItem";
import { BadgeButton } from "./BadgeButton";
import { ToggleGroup } from "./ToggleGroup";
import { NoticeBar, type NoticeAction } from "./NoticeBar";
import type { DiffBlock } from "./DiffEditor";
import { shellLayout, type ShellLayout } from "./AppShell";
import { useSheetDrag } from "./useSheetDrag";

// CodeMirror and its language parsers are about 325 kB. They load when a review first shows a diff.
const DiffEditor = lazy(() => import("./DiffEditor").then((module) => ({ default: module.DiffEditor })));
// The editor loads with the first file opened to edit.
const CodeEditor = lazy(() => import("./CodeEditor").then((module) => ({ default: module.CodeEditor })));

export interface ChangesBinding {
  source: ChangesSource;
  /** Every file in the workspace, for the All files list and the editor. */
  files: TextFileSource;
  /** Notes waiting for the next message, from every file. */
  notes: readonly DiffNote[];
  /** Open with this note in view. */
  focusNoteId?: string | undefined;
  /** Open with this workspace file in the editor, shown in All files. */
  openPath?: string | undefined;
  onAdd: (note: DiffNote) => void;
  onEdit: (id: string, comment: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

/** Header control. The count says notes wait, so the reader knows the review holds something unsent. */
export function ChangesOpener({ notes, onOpen }: { notes: number; onOpen: () => void }) {
  const label = notes > 0 ? `Review changes, ${notes} ${notes === 1 ? "note" : "notes"} waiting` : "Review changes";
  return <BadgeButton icon={<FileDiffIcon aria-hidden />} label={label} count={notes} onPress={onOpen} />;
}

/**
 * System organism: the session's git changes as a modal, where the reader
 * selects diff lines and writes notes for the agent, and the workspace's
 * files, which the reader can open and edit. The tray owns the notes; this
 * view owns what is open, selected, and being written. Read-only on git; it
 * writes only files the reader saves.
 */
export function ChangesReview(props: ChangesBinding) {
  return createPortal(<Review {...props} />, document.body);
}

type Load<T> = { type: "loading" } | { type: "ready"; value: T } | { type: "failed"; message: string };
/** The note being written: a new one on the selection, or an edit of a placed one. */
type Draft = { type: "new"; text: string; error?: string } | { type: "edit"; id: string; text: string; error?: string };
/** What the file side shows: one change's diff, or one workspace file to edit. */
type Pane = { type: "diff"; key: string } | { type: "file"; path: string };
/** Which files the tree lists. */
type Lens = "changes" | "files";

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const STATE_LABEL: Record<ChangeEntry["state"], string> = {
  modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", copied: "Copied", untracked: "New file", conflicted: "Conflicted",
};
/** The letter an editor's source control view puts beside a changed file, and its colour. */
const STATE_MARK: Record<ChangeEntry["state"], string> = {
  modified: "M", added: "A", deleted: "D", renamed: "R", copied: "C", untracked: "U", conflicted: "!",
};
const STATE_TONE: Record<ChangeEntry["state"], TreeItemTone> = {
  modified: "modify", added: "add", deleted: "remove", renamed: "modify", copied: "modify", untracked: "add", conflicted: "conflict",
};
const LOCKED: Record<LockReason, string> = {
  binary: "A binary file. It cannot be edited here.",
  large: "This file is larger than 512 KB, so it cannot be edited here.",
  encoding: "This file is not UTF-8 text. Saving it here could change bytes you did not edit, so it cannot be edited here.",
};
const READING_FILE = "Reading the file…";
const FOLDER_NOTES = { loading: "Reading the folder…", empty: "Empty folder", truncated: "The server lists the first 1,000 entries only." } as const;
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
function Review({ source, files: filesSource, notes, focusNoteId, openPath, onAdd, onEdit, onRemove, onClose }: ChangesBinding) {
  const titleId = useId();
  const filesId = useId();
  const barId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [changes, setChanges] = useState<Load<Changes>>({ type: "loading" });
  const [diffs, setDiffs] = useState<Record<string, Load<FileDiff>>>({});
  const [pane, setPane] = useState<Pane | undefined>(() => openPath === undefined ? undefined : { type: "file", path: openPath });
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const current = pane?.type === "diff" ? pane.key : undefined;
  const [lens, setLens] = useState<Lens>(openPath === undefined ? "changes" : "files");
  const [closing, setClosing] = useState(false);
  const [cursor, setCursor] = useState<string>();
  const [fileCursor, setFileCursor] = useState<string | undefined>(() => openPath === undefined ? undefined : fileKey(openPath));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [layout, setLayout] = useState<ShellLayout>("overlay");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selection, setSelection] = useState<{ key: string; rows: RowSelection }>();
  const [draft, setDraft] = useState<Draft>();
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  const loads = useRef(new Map<string, AbortController>());
  const lifetime = useRef<AbortController>(undefined);
  const quiet = useRef<AbortController>(undefined);
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
      // A file being edited stays on screen; reading the changes again is no reason to leave it.
      if (paneRef.current?.type !== "file") {
        const pick = readable.find((item) => item.key === keep) ?? readable.find((item) => item.key === asked) ?? readable[0];
        setPane(pick && { type: "diff", key: pick.key });
        if (pick) { readDiff(pick); setCollapsed((shut) => without(shut, foldersAbove(nodes, pick.key))); }
      }
      // Arriving with several files and nothing asked for, the reader picks one first. Docked, the tree is already there.
      if (keep === undefined) setSheetOpen(readable.length > 1 && !asked && paneRef.current?.type !== "file");
    }, (error: unknown) => { if (!controller.signal.aborted) setChanges({ type: "failed", message: messageOf(error) }); });
  }, [source, readDiff]);
  useEffect(() => {
    load();
    const reads = loads.current;
    return () => { lifetime.current?.abort(); quiet.current?.abort(); for (const controller of reads.values()) controller.abort(); };
  }, [load]);

  // A save changes the file's diff and maybe the list. Read them again without a loading screen, and leave the file on screen.
  const onSaved = useCallback((path: string) => {
    quiet.current?.abort();
    const controller = new AbortController();
    quiet.current = controller;
    source.changes(controller.signal).then((value) => {
      if (controller.signal.aborted || lifetime.current?.signal.aborted) return;
      setChanges({ type: "ready", value });
      setDiffs((known) => Object.fromEntries(Object.entries(known).filter(([key]) => !key.endsWith(`:${path}`))));
      setSelection((now) => now?.key.endsWith(`:${path}`) ? undefined : now);
      // A failed read leaves the last list on screen; Read the changes again shows the error.
    }, () => undefined);
  }, [source]);
  const files = useTextFiles(filesSource, onSaved);
  const unsaved = dirtyPaths(files.buffers);
  // Opened for one file: read it, and open the folders above it so All files shows where it lives.
  const askedPath = useRef(openPath);
  const { openFile: readAsked, reveal: revealAsked } = files;
  useEffect(() => {
    const path = askedPath.current;
    if (path === undefined) return;
    askedPath.current = undefined;
    readAsked(path);
    revealAsked(path);
  }, [readAsked, revealAsked]);

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
  useSheetDrag(layoutRef, filesRef, { enabled: overlay && changes.type === "ready", open: sheetOpen, onOpenChange: setSheetOpen });

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
    if (item.key !== current) { setPane({ type: "diff", key: item.key }); bodyRef.current?.scrollTo?.({ top: 0 }); }
    leaveSheet();
  };
  // The sheet took focus with it; the file's name is where the reader is now.
  const leaveSheet = () => {
    if (!overlay) return;
    setSheetOpen(false);
    requestAnimationFrame(() => document.getElementById(barId)?.focus({ preventScroll: true }));
  };
  /** Open a workspace file in the editor. Its buffer, edits and all, is kept from any earlier visit. */
  const editFile = (path: string) => {
    files.openFile(path);
    setFileCursor(fileKey(path));
    if (pane?.type !== "file" || pane.path !== path) setPane({ type: "file", path });
    leaveSheet();
  };
  const chooseLens = (next: Lens) => {
    setLens(next);
    if (next !== "files") return;
    // All files opens at the file on screen, so the reader sees where it lives.
    const shown = pane?.type === "file" ? pane.path : entry?.path;
    if (shown) { files.reveal(shown); setFileCursor(fileKey(shown)); } else files.readFolder("");
  };
  const fileRows = useMemo(() => folderRows(files.folders, files.open), [files.folders, files.open]);
  const onFileTreeKey = (event: KeyboardEvent, index: number) => {
    const step = keyStep(folderStepRows(fileRows, files.open), index, event.key);
    if (!step) return;
    event.preventDefault();
    const row = step.type === "focus" ? fileRows[step.index] : fileRows.find((item) => item.key === step.key);
    if (!row) return;
    if (step.type === "fold" && row.type === "folder") { files.toggleFolder(row.path, step.open); return; }
    if (step.type === "open") { activateFileRow(row); return; }
    setFileCursor(row.key);
    filesRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(row.key)}"]`)?.focus();
  };
  const activateFileRow = (row: FolderRow) => {
    if (row.type === "folder") files.toggleFolder(row.path, !files.open.has(row.path));
    else if (row.type === "file") editFile(row.path);
    else if (row.note === "failed") files.readFolder(row.folder);
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

  // Unsaved edits hold the review open until the reader chooses to keep editing or drop them.
  const requestClose = () => { if (files.unsaved().length > 0) setClosing(true); else onClose(); };
  // Escape or Back puts away the top thing first: the question about unsaved edits, the files sheet, a note being written, then the review.
  const putAway = () => {
    if (closing) { setClosing(false); return true; }
    if (overlay && sheetOpen) { setSheetOpen(false); dialog.current?.querySelector<HTMLElement>(".change-files-opener")?.focus(); return true; }
    if (draft || selection) { clearSelection(); return true; }
    return false;
  };
  // Escape is handled before it becomes a close request: Chrome refuses a second cancelled request without a tap between.
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && putAway()) event.preventDefault(); };
  const onCancel = (event: Event) => {
    event.preventDefault();
    if (!putAway()) requestClose();
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
  const editing = pane?.type === "file" ? pane.path : undefined;
  const fileRowFocus = [fileCursor, editing && fileKey(editing)].find((key) => key !== undefined && fileRows.some((row) => row.key === key)) ?? fileRows[0]?.key;
  const fileNotes = entry ? notesOn(entry.key) : [];
  // A file's working tree side comes after its staged side, so it wins: that is the side an edit changes.
  const changeOf = new Map(entries.filter((item) => item.diffable).map((item) => [item.path, item]));
  const isGit = changes.type === "ready" && changes.value.isGitRepo;
  const sheetOpener = overlay && <button type="button" className="app-opener change-files-opener" aria-label="Show files" title="Files"
    aria-expanded={sheetOpen} aria-controls={filesId} onClick={() => setSheetOpen(true)}><PanelLeftIcon aria-hidden size={16} /></button>;
  const browse = () => {
    chooseLens("files");
    if (overlay) setSheetOpen(true);
    else requestAnimationFrame(() => filesRef.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')?.focus());
  };
  /** One workspace file to edit: the bar with its name and save state, what stands between the edits and the disk, and the editor. */
  const filePane = (path: string) => {
    const buffer = files.buffers[path];
    const open = buffer?.type === "open" ? buffer : undefined;
    const dirty = isDirty(open);
    const save = open?.save;
    const change = changeOf.get(path);
    const status = save?.type === "saving" ? "Saving…" : dirty ? "Unsaved edits" : save?.type === "saved" ? "Saved" : undefined;
    const { folder, name } = splitPath(path);
    let notice: { message: string; actions: NoticeAction[] } | undefined;
    if (save?.type === "conflict") notice = save.version === undefined
      ? { message: "This file was deleted on disk after you opened it. Save it again to bring it back with your edits.", actions: [
        { label: "Discard my edits", onPress: () => { files.discard(path); setPane(undefined); } },
        { label: "Save it again", onPress: () => files.save(path, true), primary: true }] }
      : { message: "This file changed on disk after you opened it, perhaps by the agent. Reload it to see that change, which drops your edits, or overwrite it with yours.", actions: [
        { label: "Reload", onPress: () => files.reload(path) },
        { label: "Overwrite", onPress: () => files.save(path, true), primary: true }] };
    if (save?.type === "failed") notice = { message: save.message, actions: [dirty
      ? { label: "Try again", onPress: () => files.save(path), primary: true }
      : { label: "Read the file again", onPress: () => files.reload(path) }] };
    return <>
      <div className="change-bar">
        {sheetOpener}
        <div className="change-bar-title">
          <h3 id={barId} tabIndex={-1} className="change-path" title={path}>
            {folder && <span className="change-folder">{folder}</span>}<span className="change-name">{name}</span>
          </h3>
          <p className="change-facts">
            {change && <span>{STATE_LABEL[change.state]}{change.staged ? ", staged" : ""}</span>}
            <span role="status" className={dirty ? "change-unsaved" : undefined}>{status}</span>
          </p>
        </div>
        {change && <button type="button" className="icon-button quiet-button" aria-label="Show changes" title="Show this file's changes"
          onClick={() => openFile(change)}><FileDiffIcon aria-hidden size={18} /></button>}
        {open && <button type="button" className="primary change-save" disabled={!dirty || save?.type === "saving" || save?.type === "conflict"}
          aria-keyshortcuts="Control+S Meta+S" title="Save (Ctrl+S)" onClick={() => files.save(path)}>Save</button>}
      </div>
      {notice && <NoticeBar tone="alert" message={notice.message} actions={notice.actions} />}
      <div ref={bodyRef} className="changes-body">
        {(!buffer || buffer.type === "loading") && <p className="change-message" role="status">{READING_FILE}</p>}
        {buffer?.type === "failed" && <div className="change-message" role="alert"><p>{buffer.message}</p>
          <button type="button" onClick={() => files.reload(path)}>Try again</button></div>}
        {buffer?.type === "locked" && <p className="change-message">{LOCKED[buffer.reason]}</p>}
        {open && <Suspense fallback={<p className="change-message" role="status">{READING_FILE}</p>}>
          <CodeEditor key={`${path}#${String(open.opened)}`} label={`Edit ${path}`} fileName={name} text={open.text}
            onChange={(text) => files.edit(path, text)} onSave={() => files.save(path)} />
        </Suspense>}
      </div>
    </>;
  };
  return <dialog ref={dialog} className="tree-dialog changes-dialog" aria-labelledby={titleId} onKeyDown={onKeyDown}
    onPointerDown={(event: PointerEvent) => { pointer.current = event.pointerType; pressedBackdrop.current = event.target === dialog.current; }}
    onClick={(event) => { if (event.target === dialog.current && pressedBackdrop.current && !draft) requestClose(); pressedBackdrop.current = false; }}>
    <div className="tree-sheet">
      <header className="tree-head">
        <h2 id={titleId}>Changes</h2>
        <span className="tree-count">{count}</span>
        <button type="button" className="icon-button quiet-button" aria-label="Read the changes again" title="Read the changes again"
          disabled={changes.type === "loading"} onClick={() => { load(current); files.refresh(); }}><RefreshCwIcon aria-hidden size={18} /></button>
        <button type="button" className="icon-button quiet-button" aria-label="Close changes" title="Close" onClick={requestClose}>
          <XIcon aria-hidden size={18} /></button>
      </header>
      {changes.type === "loading" && <p className="changes-message" role="status">Reading the changes…</p>}
      {changes.type === "failed" && <div className="changes-message" role="alert"><p>{changes.message}</p>
        <button type="button" onClick={() => load()}>Try again</button></div>}
      {changes.type === "ready" && <div ref={measure} className="changes-layout" data-layout={layout} data-sheet={hidden ? "closed" : "open"}>
        <nav ref={filesRef} id={filesId} className="changes-files" aria-label="Files" aria-hidden={hidden || undefined} inert={hidden}>
          <div className="changes-lens">
            <ToggleGroup label="Files to list" value={lens} onChange={chooseLens}
              options={[{ value: "changes", label: "Changes", count: entries.length }, { value: "files", label: "All files" }]} />
          </div>
          {lens === "files" ? <ul role="tree" aria-label="All files" className="file-tree">
            {fileRows.map((row, index) => {
              const shared = { rowKey: row.key, level: row.level, focusable: row.key === fileRowFocus,
                onActivate: () => activateFileRow(row), onFocus: () => setFileCursor(row.key), onKeyDown: (event: KeyboardEvent) => onFileTreeKey(event, index) };
              if (row.type === "folder") return <TreeItem key={row.key} {...shared} kind="branch" name={row.name} title={row.path} expanded={files.open.has(row.path)} />;
              if (row.type === "note") {
                const failed = row.note === "failed";
                return <TreeItem key={row.key} {...shared} kind="note" disabled={!failed} title={failed ? "Read this folder again" : undefined}
                  mark={failed ? <RefreshCwIcon size={14} /> : undefined}
                  name={row.note === "failed" ? `Not read: ${row.message ?? "the folder could not be read"}. Try again.` : FOLDER_NOTES[row.note]} />;
              }
              const change = changeOf.get(row.path);
              const unsavedHere = isDirty(files.buffers[row.path]);
              return <TreeItem key={row.key} {...shared} kind="leaf" name={row.name} title={row.path} selected={row.path === editing} dot={unsavedHere}
                mark={change ? STATE_MARK[change.state] : row.link ? <LinkIcon size={12} /> : undefined} tone={change && STATE_TONE[change.state]}
                description={[change && STATE_LABEL[change.state], unsavedHere && "unsaved edits", row.link && "link"].filter(Boolean).join(", ") || undefined} />;
            })}
          </ul>
          : entries.length === 0 ? <div className="changes-message">{isGit ? <p>No changes. The files match the last commit.</p>
            : <p>This folder is not a git repository, so it has no changes to review.</p>}</div>
          : <ul role="tree" aria-label="Changed files" className="file-tree">
            {rows.map((row, index) => <FileTreeRow key={row.node.key} node={row.node} level={row.level} current={current}
              open={!collapsed.has(row.node.key)} focusable={row.node.key === rowFocus}
              notes={row.node.type === "file" ? notesOn(row.node.key).length : 0}
              onActivate={() => { if (row.node.type === "folder") toggleFolder(row.node.key); else if (row.node.entry.diffable) openFile(row.node.entry); }}
              onFocus={() => setCursor(row.node.key)} onKeyDown={(event) => onTreeKey(event, index)} />)}
          </ul>}
        </nav>
        {overlay && <div className="changes-scrim" aria-hidden="true" onClick={() => setSheetOpen(false)} />}
        <section className="changes-pane" aria-labelledby={editing || entry ? barId : undefined} aria-label={editing || entry ? undefined : "File"}>
          {editing !== undefined ? filePane(editing) : <>
          {entry && <div className="change-bar">
            {sheetOpener}
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
            {entry.state !== "deleted" && <button type="button" className="icon-button quiet-button" aria-label="Edit file" title="Edit this file"
              onClick={() => editFile(entry.path)}><FilePenIcon aria-hidden size={18} /></button>}
          </div>}
          {!entry && sheetOpener && <div className="change-bar">{sheetOpener}</div>}
          <div ref={bodyRef} className="changes-body">
            {entry ? <FileBody key={entry.key} path={entry.path} diff={diffs[entry.key]} notes={fileNotes}
              selection={selection?.key === entry.key ? selection.rows : undefined} draft={draft}
              reveal={focusNoteId && !focused.current ? focusNoteId : undefined} onRevealed={() => { focused.current = true; }}
              onRetry={() => readDiff(entry)} onTap={(index) => tap(entry, index)} onSelectLines={(picked) => select(entry, picked, true)}
              onDraft={(text) => setDraft((now) => now && { ...now, text, error: undefined })}
              onAdd={(lines) => addNote(entry, lines)} onCancel={clearSelection}
              onEdit={(note) => { setSelection(undefined); setDraft({ type: "edit", id: note.id, text: note.comment }); }}
              onSave={saveEdit} onRemove={onRemove} />
              : <div className="changes-message">
                {entries.length > 0 ? <p>Git lists only whole folders here, such as other repositories, so there is no diff to show.</p>
                  : isGit ? <p>No changes. The files match the last commit.</p> : <p>This folder is not a git repository, so it has no changes to review.</p>}
                <button type="button" onClick={browse}>All files</button>
              </div>}
          </div>
          </>}
        </section>
      </div>}
      {closing && unsaved.length > 0 ? <NoticeBar message={`${unsaved.length === 1 ? `${unsaved[0] ?? ""} has` : `${unsaved.length} files have`} unsaved edits. Closing drops them.`}
        actions={[{ label: "Keep editing", onPress: () => setClosing(false) }, { label: "Discard and close", onPress: onClose, primary: true }]} />
      : notes.length > 0 && <footer className="changes-foot">
        <p role="status">{notes.length === 1 ? "1 note goes" : `${notes.length} notes go`} with your next message.</p>
        <button type="button" className="primary changes-write" onClick={() => {
          requestClose();
          // The notes are written; the message is next.
          requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-composer-input]")?.focus());
        }}>Write message</button>
      </footer>}
    </div>
  </dialog>;
}

/** One row of the changed-files tree: a group, a folder, or a file with its change letter and note count. */
function FileTreeRow({ node, level, current, open, focusable, notes, onActivate, onFocus, onKeyDown }: {
  node: FileTreeNode; level: number; current: string | undefined; open: boolean; focusable: boolean; notes: number;
  onActivate: () => void; onFocus: () => void; onKeyDown: (event: KeyboardEvent) => void;
}) {
  const shared = { rowKey: node.key, level, focusable, onActivate, onFocus, onKeyDown };
  if (node.type === "folder") return <TreeItem {...shared} kind={node.group ? "group" : "branch"} name={node.name} expanded={open} />;
  const { entry } = node;
  const words = entry.diffable ? `${STATE_LABEL[entry.state]}${entry.staged ? ", staged" : ""}` : "Untracked folder, no diff";
  return <TreeItem {...shared} kind="leaf" name={node.name} selected={entry.key === current} disabled={!entry.diffable}
    mark={STATE_MARK[entry.state]} tone={STATE_TONE[entry.state]} count={notes}
    description={`${words}${notes > 0 ? `, ${notes === 1 ? "1 note" : `${String(notes)} notes`}` : ""}`}
    title={entry.diffable ? `${entry.oldPath ? `${entry.oldPath} → ` : ""}${entry.path}` : `${entry.path}: git lists this folder as a whole, such as another repository, so it has no diff here.`} />;
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
