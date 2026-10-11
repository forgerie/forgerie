import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, CornerDownRightIcon, GitForkIcon, ListTreeIcon, ScrollTextIcon, SearchIcon, SquareIcon, XIcon } from "lucide-react";
import { SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH, type SessionTreeNode, type SessionTreeSnapshot, type SessionTreeSummaryChoice, type TreeOperation } from "../sessionTree";
import {
  buildSessionTreeModel, initialSessionTreeFilter, initialSessionTreeSelection, isSessionTreeBookkeeping, nearestVisibleSessionTreeId,
  SESSION_TREE_FILTER_OPTIONS, sessionTreeAbandonedPreviewIds, sessionTreeEntryReturnsToEditor, sessionTreeKindLabel, sessionTreeView,
  sessionTreeVisualDepth, toggleSessionTreeFold, transitionSessionTreeKey, validateSessionTreeSummaryChoice,
  type SessionTreeFilterMode, type SessionTreeRow,
} from "../sessionTreeModel";
import { shortAge } from "../picker/board";
import { writeClipboardText } from "../clipboard";

export interface SessionTreeBinding {
  tree: SessionTreeSnapshot;
  operation: TreeOperation;
  onContinue: (targetId: string, summary: SessionTreeSummaryChoice) => void;
  onFork: (entryId: string) => void;
  onAbort: () => void;
  onClose: () => void;
  /** The entry the tree opens on, such as a search hit's passage. Its lens widens to show it. Read once, when the tree opens. */
  initialSelectedId?: string | undefined;
}

/** Header control for `/tree`. Pi refuses the tree while the session works, so the button waits too. */
export function TreeOpener({ idle, onOpen }: { idle: boolean; onOpen: () => void }) {
  return <button type="button" className="icon-button quiet-button" aria-label="Session tree" disabled={!idle}
    title={idle ? "Session tree" : "Session tree opens when the session is idle"} onClick={onOpen}>
    <ListTreeIcon aria-hidden size={18} /></button>;
}

/**
 * System organism: the session tree as a modal. The store owns the action in
 * flight; this view owns only how the reader looks at the tree (lens, search,
 * folds, selection, and the summary choice). Mount it once per opened tree.
 */
export function SessionTreeNavigator(props: SessionTreeBinding) {
  return createPortal(<Navigator {...props} />, document.body);
}

function Navigator({ tree, operation, onContinue, onFork, onAbort, onClose, initialSelectedId }: SessionTreeBinding) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const focusInput = useRef<HTMLInputElement>(null);
  const model = useMemo(() => buildSessionTreeModel(tree), [tree]);
  const [filter, setFilter] = useState<SessionTreeFilterMode>(() => initialSessionTreeFilter(model, initialSelectedId));
  const [search, setSearch] = useState("");
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  // The entry the reader means. A lens may hide it; widening the lens returns to it.
  const [anchorId, setAnchorId] = useState(() => initialSessionTreeSelection(model, initialSelectedId));
  const [summarize, setSummarize] = useState(false);
  const [focusText, setFocusText] = useState("");
  const [copied, setCopied] = useState<string>();
  const [focusRow, setFocusRow] = useState(true);
  // Read during the first render, before showModal moves focus into the dialog.
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined);
  // A backdrop press counts only when it also started there, so a drag out of the search field does not close.
  const pressedBackdrop = useRef(false);
  const wasBusy = useRef(false);

  const view = sessionTreeView(model, { foldedIds: folded, filter, search });
  const rows = view.rows;
  const selectedId = nearestVisibleSessionTreeId(model, rows.map((row) => row.node.id), anchorId);
  const selected = selectedId === undefined ? undefined : model.nodesById.get(selectedId);
  const position = selectedId === undefined ? -1 : rows.findIndex((row) => row.node.id === selectedId);
  const leaving = sessionTreeAbandonedPreviewIds(tree, selectedId);
  const branching = rows.some((row) => row.childIds.length > 1);
  const busy = operation.type !== "idle";
  const summarizing = operation.type === "continuing" && operation.summarizing;
  const notice = operation.type === "forking" ? undefined : operation.notice;

  // Native modality gives the top layer, an inert page, and Escape as `cancel`.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open && typeof element.showModal === "function") element.showModal();
  }, []);
  // Focus returns to whatever opened the tree: the composer or the header button.
  useEffect(() => () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); }, [opener]);
  // Turning Summarize on reveals its optional focus; the caret goes there in the same motion.
  useEffect(() => { if (summarize) focusInput.current?.focus(); }, [summarize]);
  // The pressed action button is disabled while it runs, so focus falls out of the tree. Put it back after.
  useEffect(() => {
    if (wasBusy.current && !busy) setFocusRow(true);
    wasBusy.current = busy;
  }, [busy]);
  useEffect(() => {
    if (!focusRow) return;
    setFocusRow(false);
    const row = list.current?.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]');
    if (row) { row.focus({ preventScroll: true }); row.scrollIntoView?.({ block: "nearest" }); }
  }, [focusRow]);

  const choose = (id: string | undefined) => { setAnchorId(id); setCopied(undefined); setFocusRow(true); };
  // A new lens or search shows a new forest, so folds from the old one no longer apply.
  const lens = (next: SessionTreeFilterMode) => { if (next === filter) return; setFilter(next); setFolded(new Set()); setCopied(undefined); setFocusRow(true); };
  const summaryChoice = (): SessionTreeSummaryChoice | undefined => {
    const checked = validateSessionTreeSummaryChoice(!summarize ? "none" : focusText.trim() === "" ? "default" : "custom", focusText);
    return checked.ok ? checked.choice : undefined;
  };
  const continueHere = () => {
    const choice = summaryChoice();
    if (busy || selectedId === undefined || choice === undefined) return;
    onContinue(selectedId, choice);
  };
  // Escape closes when idle, stops a running summary, and otherwise waits. A stray backdrop press never stops paid work.
  const escape = () => { if (!busy) onClose(); else if (summarizing) onAbort(); };
  const onTreeKey = (event: KeyboardEvent) => {
    // The dialog's cancel event owns Escape. Modified keys belong to the browser and assistive tech.
    if (event.key === "Escape" || event.altKey || event.ctrlKey || event.metaKey) return;
    const row = rows.find((candidate) => candidate.node.id === selectedId);
    // Only a fork folds. Left on a linear entry steps to the entry before it.
    if (event.key === "ArrowLeft" && row && !foldable(row, folded.has(row.node.id))) {
      event.preventDefault();
      choose(view.visibleParentById.get(row.node.id) ?? row.node.id);
      return;
    }
    const next = transitionSessionTreeKey(model, { selectedId, foldedIds: folded, filter, search }, event.key);
    if (!next.handled) return;
    event.preventDefault();
    if (next.action === "confirm") { continueHere(); return; }
    setFolded(next.foldedIds);
    choose(next.selectedId);
  };
  const toggleFold = (id: string, event: MouseEvent) => {
    event.stopPropagation();
    const next = toggleSessionTreeFold(model, { selectedId, foldedIds: folded, filter, search }, id);
    setFolded(next.foldedIds);
    choose(next.selectedId);
  };
  const copy = async () => {
    if (!selected) return;
    const done = await writeClipboardText(selected.label === undefined ? selected.summary : `[${selected.label}] ${selected.summary}`);
    setCopied(done ? "Entry text copied." : "This browser blocked the clipboard.");
  };

  const now = Date.now();
  return <dialog ref={dialog} className="tree-dialog" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); escape(); }}
    // A second Escape without a click between can close the dialog anyway. While an action runs,
    // its result must reach the reader, so the dialog reopens; when idle, the store closes too.
    onClose={() => { if (busy) dialog.current?.showModal(); else onClose(); }}
    // A press on the backdrop lands on the dialog itself; the sheet fills the rest.
    onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
    onClick={(event) => {
      if (pressedBackdrop.current && event.target === event.currentTarget && !busy) onClose();
      pressedBackdrop.current = false;
    }}>
    <div className="tree-sheet">
      <header className="tree-head">
        <h2 id={titleId}>Session tree</h2>
        {rows.length > 0 && <span className="tree-count" title="Selected entry's position in this view">
          {position < 0 ? "–" : position + 1} of {rows.length}</span>}
        {/* Copy acts on the selection, so it sits with the readout, not on every row. */}
        <button type="button" className="icon-button quiet-button tree-copy" aria-label="Copy entry text" title="Copy the selected entry's text"
          disabled={!selected} onClick={() => { void copy(); }}><CopyIcon aria-hidden size={16} /></button>
        <button type="button" className="icon-button quiet-button" aria-label="Close session tree" title="Close"
          disabled={busy} onClick={onClose}><XIcon aria-hidden size={20} /></button>
      </header>
      {/* Between the pinned header and actions. Normally only the tree scrolls; in a very short
          window the tree keeps two rows and this whole region scrolls instead. */}
      <div className="tree-body">
      <div className="tree-tools">
        <label className="tree-search">
          <SearchIcon aria-hidden size={16} />
          <input type="search" placeholder="Search history" aria-label="Search history entries" value={search}
            onChange={(event) => { setSearch(event.target.value); setFolded(new Set()); setCopied(undefined); }} />
        </label>
        <div className="tree-lenses" role="group" aria-label="Show entries">
          {SESSION_TREE_FILTER_OPTIONS.map((option) => <button type="button" key={option.mode} title={option.description}
            aria-pressed={filter === option.mode} onClick={() => lens(option.mode)}>{option.label}</button>)}
        </div>
      </div>
      {copied && <p className="tree-copied" role="status">{copied}</p>}
      {rows.length === 0
        ? <p className="tree-empty" role="status">{model.orderedIds.length === 0 ? "This session has no history yet."
          : search.trim() === "" ? "No entries in this view. Choose All to see every entry." : "No entries match this search."}</p>
        : <div ref={list} className="tree-list" role="tree" aria-label="Session history" data-branching={branching || undefined}
          onKeyDown={onTreeKey}>
          {rows.map((row) => <TreeRow key={row.node.id} row={row} now={now} selected={row.node.id === selectedId}
            leaving={leaving.has(row.node.id)} movesHere={leaving.size > 0} folded={folded.has(row.node.id)} branching={branching}
            onSelect={() => choose(row.node.id)} onFold={(event) => toggleFold(row.node.id, event)} />)}
        </div>}
      {summarize && <label className="tree-focus">
        <ScrollTextIcon aria-hidden size={16} />
        <input ref={focusInput} type="text" placeholder="Summary focus (optional)" aria-label="Summary focus (optional)"
          maxLength={SESSION_TREE_CUSTOM_INSTRUCTIONS_MAX_LENGTH} value={focusText} disabled={busy}
          onChange={(event) => setFocusText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); continueHere(); } }} />
      </label>}
      {notice && <p className="tree-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.message}</p>}
      </div>
      <footer className="tree-actions">
        {summarizing && <button type="button" className="tree-stop" disabled={operation.aborting} onClick={onAbort}>
          <SquareIcon aria-hidden size={12} />{operation.aborting ? "Stopping…" : "Stop summary"}</button>}
        <button type="button" className="tree-summarize" aria-pressed={summarize} disabled={busy || !selected}
          title="Also write a summary of the branch you leave behind"
          onClick={() => setSummarize(!summarize)}>
          <ScrollTextIcon aria-hidden size={16} />Summarize</button>
        <button type="button" className="tree-fork" disabled={busy || !selected} title={selected ? forkDescription(selected) : undefined}
          onClick={() => { if (selectedId !== undefined) onFork(selectedId); }}>
          <GitForkIcon aria-hidden size={16} />{operation.type === "forking" ? "Forking…" : "Fork"}</button>
        <button type="button" className="tree-continue" disabled={busy || !selected} title={selected ? continueDescription(selected) : undefined}
          onClick={continueHere}>
          <CornerDownRightIcon aria-hidden size={16} />
          {operation.type !== "continuing" ? "Continue from here" : operation.summarizing ? "Summarizing…" : "Continuing…"}</button>
      </footer>
    </div>
  </dialog>;
}

function continueDescription(node: SessionTreeNode): string {
  return sessionTreeEntryReturnsToEditor(node.kind)
    ? "Move this session back to before this message. Its text returns to the message box."
    : "Move this session to this entry. Later entries stay in the tree as another branch.";
}
function forkDescription(node: SessionTreeNode): string {
  return node.kind === "user"
    ? "Start a new session from the history before this message, with its text as the draft. This session stays as it is."
    : "Start a new session from the history up to this entry. This session stays as it is.";
}

/** A caret marks a real fork. A folded entry keeps one too, so its hidden rows have a visible cause. */
function foldable(row: SessionTreeRow, folded: boolean): boolean {
  return row.childIds.length > 1 || folded && row.childIds.length > 0;
}

function TreeRow({ row, now, selected, leaving, movesHere, folded, branching, onSelect, onFold }: {
  row: SessionTreeRow; now: number; selected: boolean; leaving: boolean; movesHere: boolean; folded: boolean; branching: boolean;
  onSelect: () => void; onFold: (event: MouseEvent) => void;
}) {
  const { node } = row;
  const canFold = foldable(row, folded);
  const lanes = sessionTreeVisualDepth(row.branchDepth);
  // Nesting follows forks, as drawn. A linear history is one level, not hundreds.
  return <div role="treeitem" className="tree-row" aria-level={row.branchDepth + 1} aria-selected={selected}
    aria-expanded={canFold ? !folded : undefined} aria-current={row.activeLeaf ? "true" : undefined}
    tabIndex={selected ? 0 : -1} data-path={row.activePath || undefined} data-leaving={leaving || undefined}
    data-bookkeeping={isSessionTreeBookkeeping(node.kind) || undefined} onClick={onSelect}>
    {/* Always present: the row grid places by order, so a missing rail track would shift every column. */}
    <span className="tree-rails" aria-hidden>{Array.from({ length: lanes }, (_, lane) => {
      const own = lane === lanes - 1 && row.connector !== "none";
      return <span key={lane} className="tree-lane" data-line={!own && row.rails[lane] === true || undefined}
        data-elbow={own ? row.connector : undefined} />;
    })}</span>
    <span className="tree-marker" aria-hidden data-leaf={row.activeLeaf || undefined} />
    {branching && <span className="tree-fold" aria-hidden title={canFold ? folded ? "Expand branch" : "Collapse branch" : undefined}
      onClick={canFold ? onFold : undefined}>
      {canFold && (folded ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />)}</span>}
    <span className="tree-entry">
      <span className="tree-summary" dir="auto">{node.summary}</span>
      <span className="tree-meta">
        <span className="tree-kind">{sessionTreeKindLabel(node.kind)}</span>
        {node.label !== undefined && <span className="tree-label" title={node.label}>{node.label}</span>}
        {row.activeLeaf && <span className="tree-current">Current</span>}
        {row.activePath && !row.activeLeaf && <span className="sr-only">On the active path</span>}
        {selected && movesHere && <span className="sr-only">Becomes the current entry</span>}
        {node.timestamp !== undefined && <time dateTime={node.timestamp} title={new Date(node.timestamp).toLocaleString()}>{shortAge(node.timestamp, now)}</time>}
      </span>
    </span>
  </div>;
}
