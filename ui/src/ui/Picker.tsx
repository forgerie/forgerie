import { ArchiveIcon, ArrowLeftIcon, CalendarClockIcon, FlagIcon, FolderTreeIcon, ListTodoIcon, Maximize2Icon, Minimize2Icon, SettingsIcon, SquarePenIcon, ArchiveRestoreIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, EllipsisIcon, HashIcon, PinIcon, PinOffIcon, SearchIcon, Trash2Icon, XIcon,
  type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { navigable, type Row, type Section } from "../picker/board";
import type { CatalogConnection } from "../picker/catalogStore";
import { commandForKey, rowCommands, type RowCommandKind } from "../picker/commands";
import type { PickerPrefs } from "../picker/prefs";
import { readRowPress, ROW_PRESS } from "../picker/press";
import type { Toast as ActionMessage } from "../picker/rowActions";
import { Toast } from "./Toast";
import { LogoMark } from "./LogoMark";
import { WorktreeRowMark } from "./WorktreeChip";
import { PullRequestRowMark } from "./PullRequestReview";
import { FilterChip } from "./FilterChip";
import { IconCount } from "./IconCount";
import { footerPlan, FOOTER_ALL_LABELS, FOOTER_ICONS_ONLY } from "./pickerFooter";

/** What the picker draws. Built by the binding; the view does no I/O. */
export interface PickerView {
  connection: CatalogConnection;
  sections: Section[];
  /** Machine names appear in the location only when there is more than one. */
  machines: number;
  selectedId?: string | undefined;
  archivedCount: number;
  /** The latest command's message. The app shows it as a toast. */
  toast?: ActionMessage | undefined;
  /** Rows with a write in flight. */
  pending?: ReadonlySet<string> | undefined;
  /** Sessions that hold a backlog item. */
  held?: ReadonlySet<string> | undefined;
}
export interface PickerActions {
  onSelect: (row: Row) => void;
  onRetry: () => void;
  onClose?: (() => void) | undefined;
  onCommand?: ((row: Row, kind: RowCommandKind) => void) | undefined;
  onUndo?: (() => void) | undefined;
  onDismissToast?: (() => void) | undefined;
  /** Opens the first-message composer of a new session. */
  onNew?: (() => void) | undefined;
  /** Opens settings in the thread's place. */
  onSettings?: (() => void) | undefined;
  /** Settings is what the thread area shows now. */
  settingsOpen?: boolean | undefined;
  /** Opens the backlog in the thread's place. */
  onBacklog?: (() => void) | undefined;
  backlogOpen?: boolean | undefined;
  /** Open items across every project. Absent until the backlog is read. */
  backlogCount?: number | undefined;
  /** Opens the triggers in the thread's place. */
  onTriggers?: (() => void) | undefined;
  triggersOpen?: boolean | undefined;
  /** The triggers entry's name and its chip, shown only when there is something to act on. */
  triggers?: { title: string; chip?: { text: string; tone: "bad" | "warn" } | undefined } | undefined;
  /** Toggles browser full screen. Absent when the browser cannot. */
  onFullscreen?: (() => void) | undefined;
  fullscreen?: boolean | undefined;
}
/**
 * Which projects the list shows. The choices live in the list's ⋯ menu, under
 * the grouping; a chosen one stands above the list until it is cleared.
 */
export interface PickerFilter {
  options: readonly { value: string; label: string; detail: string }[];
  /** The chosen option, or "" for all projects. */
  value: string;
  onChoose: (value: string) => void;
  /** Opens the page where groups are made and changed. */
  onManage: () => void;
}

/**
 * Search in the list's header. Closed, a Search button sits beside New session.
 * Open, the field takes the header's place, so the list loses no row to it. The
 * binding owns the query and whether the reader asked for the field.
 */
export interface PickerSearch {
  /** The search box, drawn in the header while search is open. */
  field: ReactNode;
  /** The typed query. While it holds text, search stays open, wherever focus goes. */
  query: string;
  /** The reader asked for the field: the Search button, Ctrl+K, or `/`. */
  open: boolean;
  /** Opens the field and puts the caret in it. */
  onOpen: () => void;
  /** Closes the field and clears its query. */
  onClose: () => void;
  /** The keys that reach the field from anywhere, for the Search button's `aria-keyshortcuts`. */
  keys?: string | undefined;
  /** A line about the query, drawn under the header. Its id describes the field. */
  hint?: { id: string; text: string } | undefined;
}

const PIN = <PinIcon className="picker-pin" aria-hidden />;
// The homepage's row menu icons (thread-list-item.tsx), one per command.
const COMMAND_ICONS: Record<RowCommandKind, LucideIcon> = {
  pin: PinIcon, unpin: PinOffIcon, archive: ArchiveIcon, restore: ArchiveRestoreIcon, delete: Trash2Icon, copyPath: CopyIcon, copyId: HashIcon,
};
// Same drawings as the Lit client's tabIcons.ts, so one concept has one picture.
const AGENTS = <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M7.5 11 16.5 6.8" /><path d="M7.5 13 16.5 17.2" /></svg>;
const TERMINAL = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 10 3 3-3 3" /><path d="M12 16h5" /></svg>;
const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
const menuId = (id: string) => `picker-menu-${id}`;

/** The footer's inner width, measured, so its plan follows the list's own room and never the window's. */
function useInnerWidth(element: HTMLElement | null): number {
  // Before the first measure: the usual room, a docked or overlaid list of about 18rem.
  const [width, setWidth] = useState((FOOTER_ALL_LABELS + FOOTER_ICONS_ONLY) / 2);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const inner = element.clientWidth - (parseFloat(style.paddingInlineStart) || 0) - (parseFloat(style.paddingInlineEnd) || 0);
      // A footer that is not laid out (a hidden sheet's first frame, a test page) keeps the last plan.
      if (element.clientWidth > 0) setWidth(inner);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

interface Press { x: number; y: number; at: number; timer: ReturnType<typeof setTimeout> }

function PickerRow({ row, selected, pending, held, showPin, menuOpen, onSelect, onMenu: openMenu, onCloseMenu }: {
  row: Row; selected: boolean; pending: boolean; held: boolean;
  /** False under the Pinned heading, which already says it for every row. */
  showPin: boolean; menuOpen: boolean; onSelect: (row: Row) => void; onMenu: (id: string) => void; onCloseMenu: () => void;
}) {
  // A row with no commands (a start still in flight) has no menu to open.
  const hasCommands = rowCommands(row).length > 0;
  const onMenu = (id: string) => { if (hasCommands) openMenu(id); };
  const { session, location } = row;
  const press = useRef<Press | undefined>(undefined);
  // A hold that opened the menu must not also open the session on release.
  const swallowClick = useRef(false);
  const cancel = () => { if (press.current) clearTimeout(press.current.timer); press.current = undefined; };
  useEffect(() => cancel, []);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    cancel();
    // The hold must land while the finger is still down, so it is a timer.
    press.current = { x: event.clientX, y: event.clientY, at: Date.now(), timer: setTimeout(() => {
      press.current = undefined; swallowClick.current = true; onMenu(session.id);
    }, ROW_PRESS.holdMs) };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = press.current;
    if (!origin || event.pointerType !== "touch") return;
    if (readRowPress(Math.hypot(event.clientX - origin.x, event.clientY - origin.y), Date.now() - origin.at) === "abandoned") cancel();
  };
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // A touch browser raises contextmenu from its own hold timer, racing ours.
    // Mid-press means the finger is still down, so its release is not a tap.
    if (press.current) { cancel(); swallowClick.current = true; }
    onMenu(session.id);
  };
  return <div id={`picker-row-${session.id}`} className="picker-row" role="option" aria-selected={selected} data-state={row.state}
    data-session={session.id} aria-busy={pending || undefined}
    onClick={() => { if (swallowClick.current) { swallowClick.current = false; return; } onSelect(row); }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={cancel} onPointerCancel={cancel} onContextMenu={onContextMenu}>
    <span className="picker-mark" aria-hidden="true"><i /></span>
    <span className="picker-title">{session.pinned && showPin ? <>{PIN} </> : null}
      {session.name ? session.name : <span className="picker-untitled">Untitled session</span>}</span>
    <span className="picker-time" data-live={row.working || undefined}>{row.time}</span>
    <span className="picker-sub">
      <span className="picker-where" title={session.cwd}>{location.project}{location.branch ? <> · <span className="picker-branch">{location.branch}</span></> : null}</span>
      {session.worktree ? <WorktreeRowMark info={session.worktree} /> : null}
      {session.pullRequests?.length ? <PullRequestRowMark links={session.pullRequests} /> : null}
      {held ? <span className="picker-from-backlog" title="Holds a backlog item" aria-label="Holds a backlog item"><ListTodoIcon aria-hidden /></span> : null}
      {row.agents || row.processes || row.flagged ? <span className="picker-work">
        {row.agents ? <span title={`${count(row.agents, "agent", "agents")} working`} aria-label={`${count(row.agents, "agent", "agents")} working`}>{AGENTS}{row.agents}</span> : null}
        {row.processes ? <span title={`${count(row.processes, "managed process", "managed processes")} running`} aria-label={`${count(row.processes, "managed process", "managed processes")} running`}>{TERMINAL}{row.processes}</span> : null}
        {/* Flagged guesses: a muted readout, never the live tone. Nothing waits on them. */}
        {row.flagged ? <IconCount icon={<FlagIcon aria-hidden />} count={row.flagged} label={`${count(row.flagged, "flagged decision", "flagged decisions")} to look at`} /> : null}
      </span> : null}
    </span>
    {hasCommands && <button className="picker-row-more" aria-label="Session commands" aria-haspopup="menu" aria-expanded={menuOpen}
      aria-controls={menuOpen ? menuId(session.id) : undefined} tabIndex={-1}
      onClick={(event) => { event.stopPropagation(); if (menuOpen) onCloseMenu(); else onMenu(session.id); }}><EllipsisIcon aria-hidden /></button>}
  </div>;
}

/**
 * A row's commands, opened under that row as part of the list. A floating
 * panel inside the transformed sheet is clipped by it (the Lit client lost its
 * row menu that way); a drawer in the list cannot be cut off.
 */
function RowMenu({ row, confirming, onConfirm, onRun, onClose }: {
  row: Row; confirming: boolean; onConfirm: () => void; onRun: (kind: RowCommandKind) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true }); }, []);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest" }); }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation(); // The list's own keys (J, K, E) must not run under an open menu.
    if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); onClose(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const index = items.findIndex((item) => item === document.activeElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return <div ref={ref} id={menuId(row.session.id)} className="picker-row-menu" role="menu" aria-label="Session commands" onKeyDown={onKeyDown}>
    {rowCommands(row).map((command) => {
      const asking = command.danger === true && confirming;
      const Icon = COMMAND_ICONS[command.kind];
      return <button key={command.kind} role="menuitem" data-command={command.kind} disabled={command.disabled !== undefined}
        data-tone={command.danger ? "danger" : undefined}
        onClick={() => { if (command.danger && !confirming) onConfirm(); else onRun(command.kind); }}>
        <Icon aria-hidden />{asking ? "Delete for good?" : command.label}
        {command.disabled ? <small>{command.disabled}</small> : command.key ? <small>{command.key}</small> : null}
      </button>;
    })}
  </div>;
}

/** The result of a session command, such as an archive with its undo. It shows in the page's toast region. */
export function PickerToast({ toast, onUndo, onDismiss }: { toast: ActionMessage; onUndo?: (() => void) | undefined; onDismiss?: (() => void) | undefined }) {
  const note = toast.type === "undo" || toast.type === "note" ? toast.note : undefined;
  // The note's title stays in view; its reason opens on request.
  const message = toast.type === "undo" ? <>Archived <strong>{toast.target.name ?? "Untitled session"}</strong>{note ? `. ${note.title}.` : null}</>
    : toast.type === "note" ? toast.note.title : toast.text;
  return <Toast tone={toast.type === "error" ? "alert" : "plain"} onDismiss={onDismiss} message={message} detail={note?.text}
    action={toast.type === "undo" && onUndo ? { label: "Undo", onPress: onUndo } : undefined} />;
}

/**
 * The session picker. Pure view: sessions and the reader's arrangement come
 * in; selections, commands, and arrangement changes go out. Only open menus
 * live here.
 */
export function Picker({ view, prefs, onPrefs, actions, shelves, filter, search, results, narrowed = false, onEscape }: {
  view: PickerView; prefs: PickerPrefs; onPrefs: (prefs: PickerPrefs) => void; actions: PickerActions;
  /** Plugin shelves, drawn between the list and Backlog and Settings. */
  shelves?: ReactNode;
  /** Which projects the list shows. Without it, the list shows every project and the menu offers no filter. */
  filter?: PickerFilter | undefined;
  /** Search in the header. Without it, the header offers no search. */
  search?: PickerSearch | undefined;
  /** Drawn in the list's place while set, such as what a search found. The list's own keys rest meanwhile. */
  results?: ReactNode;
  /** The sections hold only some sessions, such as those whose title matches, so the list makes no claim about the rest. */
  narrowed?: boolean;
  /**
   * Escape anywhere in the list asks this first, from the search box too, unless a control already used the key.
   * It returns true when it used the key, such as to clear a search. If it did not, Escape closes an open search
   * field, and only then the list.
   */
  onEscape?: (() => boolean) | undefined;
}) {
  const [menu, setMenu] = useState<"board" | undefined>();
  const [rowMenu, setRowMenu] = useState<{ id: string; confirming: boolean } | undefined>();
  const listRef = useRef<HTMLDivElement>(null);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const plan = footerPlan(useInnerWidth(footer));
  const fullScreenInMenu = actions.onFullscreen !== undefined && plan.fullScreen === "menu";
  const change = onPrefs;
  // A typed query keeps the field open even after focus leaves it, so the list it narrows never hides its cause.
  const searchOpen = search !== undefined && (search.open || search.query !== "");
  const searchButton = useRef<HTMLButtonElement>(null);
  // Closed by the reader (Escape, the back arrow): focus goes back to the Search button. A blur closes it quietly.
  const searchFocusBack = useRef(false);
  const closeSearch = () => { searchFocusBack.current = true; search?.onClose(); };
  useLayoutEffect(() => {
    if (searchOpen || !searchFocusBack.current) return;
    searchFocusBack.current = false;
    searchButton.current?.focus({ preventScroll: true });
  }, [searchOpen]);

  // The selected row's group opens, so the current session is never hidden.
  const selectedKey = useMemo(() => view.sections.find((section) => section.rows.some((row) => row.session.id === view.selectedId))?.key, [view.sections, view.selectedId]);
  const collapsed = useMemo(() => {
    if (!selectedKey || !prefs.collapsed.has(selectedKey)) return prefs.collapsed;
    const next = new Set(prefs.collapsed); next.delete(selectedKey); return next;
  }, [prefs.collapsed, selectedKey]);
  const order = useMemo(() => navigable(view.sections, collapsed), [view.sections, collapsed]);
  const selectedRow = order.find((row) => row.session.id === view.selectedId);

  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    change({ ...prefs, collapsed: next });
  };
  const openRowMenu = (id: string) => { setMenu(undefined); setRowMenu({ id, confirming: false }); };
  const closeRowMenu = () => { setRowMenu(undefined); listRef.current?.focus({ preventScroll: true }); };
  const run = (row: Row, kind: RowCommandKind) => { closeRowMenu(); actions.onCommand?.(row, kind); };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (menu) setMenu(undefined);
      else if (onEscape?.()) return;
      else if (searchOpen) closeSearch();
      else actions.onClose?.();
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) return;
    if ((event.key === "ContextMenu" || event.shiftKey && event.key === "F10") && results === undefined) {
      event.preventDefault();
      if (selectedRow) openRowMenu(selectedRow.session.id);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    // Rows the reader cannot see are not for the keys to walk or command; arranging the list still works.
    if (results !== undefined && key !== "n" && key !== "g" && key !== "a") return;
    if (key === "j" || key === "k" || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = order.findIndex((row) => row.session.id === view.selectedId);
      const step = key === "j" || event.key === "ArrowDown" ? 1 : -1;
      const next = order[index === -1 ? (step > 0 ? 0 : order.length - 1) : Math.min(Math.max(index + step, 0), order.length - 1)];
      if (next && next.session.id !== view.selectedId) actions.onSelect(next);
    } else if (key === "n" && actions.onNew) { event.preventDefault(); actions.onNew(); }
    else if (key === "g") change({ ...prefs, grouping: prefs.grouping === "state" ? "project" : "state" });
    else if (key === "a") change({ ...prefs, showArchived: !prefs.showArchived });
    else if (selectedRow && actions.onCommand) {
      const command = commandForKey(selectedRow, key);
      if (command) { event.preventDefault(); actions.onCommand(selectedRow, command.kind); }
    }
  };
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [view.selectedId]);
  // A press anywhere outside the open row menu closes it, and that press then
  // does what it was aimed at.
  const openMenuId = rowMenu?.id;
  useEffect(() => {
    if (openMenuId === undefined) return;
    const onDown = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      // The row's own ⋯ toggles the menu itself.
      if (document.getElementById(menuId(openMenuId))?.contains(event.target) || event.target.closest(`[aria-controls="${menuId(openMenuId)}"]`)) return;
      setRowMenu(undefined);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [openMenuId]);

  const { connection } = view;
  const empty = view.sections.length === 0;
  const rowWithMenu = rowMenu ? order.find((row) => row.session.id === rowMenu.id) : undefined;
  const filterChosen = filter?.value ? filter.options.find((option) => option.value === filter.value) : undefined;
  return <section className="picker" aria-label="Sessions" onKeyDown={onKeyDown}>
    {/* The homepage sidebar header: product mark and name, then the list's commands. Search opens in its place. */}
    <header className="picker-header" data-search={searchOpen ? "open" : undefined}
      onBlur={searchOpen ? (event) => {
        // Focus left an empty field: it closes. A query keeps it open; so does a window that lost focus, not the field.
        const next = event.relatedTarget;
        if (search?.query !== "" || next instanceof Node && event.currentTarget.contains(next) || !document.hasFocus()) return;
        search.onClose();
      } : undefined}>
      {searchOpen ? <>
        <button className="picker-icon" aria-label="Close search" title="Close search (Esc)" onClick={closeSearch}><ArrowLeftIcon aria-hidden size={16} /></button>
        <div className="picker-search">{search?.field}</div>
      </> : <>
      <h2 className="picker-brand"><LogoMark /><span className="picker-brand-name">Forgerie</span><span className="sr-only"> sessions</span></h2>
      {search ? <button ref={searchButton} className="picker-icon" aria-label="Search sessions" aria-keyshortcuts={search.keys}
        title="Search sessions (Ctrl+K or /)" onClick={() => { setMenu(undefined); search.onOpen(); }}><SearchIcon aria-hidden size={16} /></button> : null}
      {actions.onNew ? <button className="picker-icon" aria-label="New session" aria-keyshortcuts="N" title="New session (N)"
        onClick={actions.onNew}><SquarePenIcon aria-hidden size={16} /></button> : null}
      <button className="picker-icon" aria-label="More session commands" aria-haspopup="menu" aria-expanded={menu === "board"}
        title="Arrange the list"
        onClick={() => { setRowMenu(undefined); setMenu(menu === "board" ? undefined : "board"); }}><EllipsisIcon aria-hidden size={16} /></button>
      {actions.onClose ? <button className="picker-icon" aria-label="Close sessions" title="Close sessions" onClick={actions.onClose}><XIcon aria-hidden size={16} /></button> : null}
      {menu === "board" ? <div className="picker-menu" role="menu" aria-label="Session commands">
        {(["state", "project"] as const).map((grouping) => <button key={grouping} role="menuitemradio" aria-checked={prefs.grouping === grouping}
          onClick={() => { setMenu(undefined); change({ ...prefs, grouping }); }}>
          <CheckIcon aria-hidden />Group by {grouping}{prefs.grouping === grouping ? null : <small>G</small>}</button>)}
        <div className="picker-menu-separator" role="separator" />
        <button role="menuitemcheckbox" aria-checked={prefs.showArchived} disabled={view.archivedCount === 0}
          onClick={() => { setMenu(undefined); change({ ...prefs, showArchived: !prefs.showArchived }); }}>
          <CheckIcon aria-hidden />Show archived <small>{view.archivedCount} · A</small></button>
        {filter ? <>
          <div className="picker-menu-separator" role="separator" />
          {filter.options.length ? [{ value: "", label: "All projects", detail: "" }, ...filter.options].map((option) =>
            <button key={`filter-${option.value}`} role="menuitemradio" aria-checked={filter.value === option.value}
              onClick={() => { setMenu(undefined); filter.onChoose(option.value); }}>
              <CheckIcon aria-hidden />{option.label}{option.detail ? <small>{option.detail}</small> : null}</button>) : null}
          <button role="menuitem" onClick={() => { setMenu(undefined); filter.onManage(); }}>
            <FolderTreeIcon aria-hidden />{filter.options.length ? "Edit project groups…" : "Group projects…"}</button>
        </> : null}
        {fullScreenInMenu ? <>
          <div className="picker-menu-separator" role="separator" />
          <button role="menuitemcheckbox" aria-checked={actions.fullscreen === true}
            onClick={() => { setMenu(undefined); actions.onFullscreen?.(); }}>
            <CheckIcon aria-hidden />Full screen</button>
        </> : null}
      </div> : null}
      </>}
    </header>
    {searchOpen && search?.hint ? <p id={search.hint.id} className="picker-search-hint">{search.hint.text}</p> : null}
    {filterChosen ? <FilterChip icon={<FolderTreeIcon aria-hidden />} label={filterChosen.label} detail={filterChosen.detail}
      clear="Show all projects" onClear={() => filter?.onChoose("")} /> : null}
    {connection.type === "reconnecting" ? <p className="picker-notice" role="status"><span aria-hidden="true">&gt;</span> Reconnecting…</p> : null}
    {connection.type === "failed" && !empty ? <p className="picker-notice" data-tone="error" role="alert">{connection.message}<button onClick={actions.onRetry}>Retry now</button></p> : null}
    {/* The room the list shares with plugin shelves. A shelf measures it to decide how much of it to take. */}
    <div className="picker-room">
    {results !== undefined ? results : connection.type === "loading" && empty ? <div className="picker-list" role="status" aria-label="Loading sessions">
      {[38, 90, 70, 38, 90, 70].map((width, index) => <span key={index} className="picker-skeleton" style={{ "--picker-skeleton-width": `${String(width)}%` }} />)}
    </div> : connection.type === "failed" && empty ? <div className="picker-state" role="alert">
      <strong>Could not load sessions</strong><span>{connection.message}</span><button onClick={actions.onRetry}>Retry now</button>
    </div> : empty ? <div className="picker-state"><strong>No sessions yet</strong>
      {actions.onNew ? <button onClick={actions.onNew}>New session</button> : null}</div>
    : <div className="picker-list" role="listbox" aria-label="Sessions" tabIndex={0} ref={listRef}
        aria-activedescendant={view.selectedId ? `picker-row-${view.selectedId}` : undefined}>
      {!narrowed && view.sections.every((section) => section.kind === "band" || section.kind === "archived" || section.kind === "project")
        && prefs.grouping === "state" ? <p className="picker-clear">Nothing is waiting for you</p> : null}
      {view.sections.map((section) => <div key={section.key} className="picker-group" data-kind={section.kind}>
          <button className="picker-group-header" aria-expanded={!collapsed.has(section.key)} onClick={() => toggle(section.key)}>
            <ChevronDownIcon className="picker-chevron" aria-hidden /><span className="picker-group-label">{section.label}</span>
            <span className="picker-count">{section.rows.length + (section.hidden ?? 0)}</span>
          </button>
          {collapsed.has(section.key) ? null : <div className="picker-group-rows" role="group" aria-label={section.label}>
            {section.rows.map((row) => <div key={row.session.id} role="none">
              <PickerRow row={row} selected={row.session.id === view.selectedId} pending={view.pending?.has(row.session.id) === true}
                held={view.held?.has(row.session.id) === true} showPin={section.kind !== "pinned"}
                menuOpen={rowWithMenu?.session.id === row.session.id} onSelect={actions.onSelect} onMenu={openRowMenu} onCloseMenu={closeRowMenu} />
              {rowMenu && rowWithMenu?.session.id === row.session.id ? <RowMenu row={row} confirming={rowMenu.confirming}
                onConfirm={() => setRowMenu({ ...rowMenu, confirming: true })} onRun={(kind) => run(row, kind)} onClose={closeRowMenu} /> : null}
            </div>)}
            {/* A control, not a row: it says what it adds. The chevron trails the words;
                leading, it stood where a heading's does and read as a closed group. */}
            {section.hidden ? <button className="picker-more" onClick={() => change({ ...prefs, allPinned: true })}>
              Show {section.hidden} more<ChevronDownIcon aria-hidden /></button>
              : section.kind === "pinned" && prefs.allPinned ? <button className="picker-more" onClick={() => change({ ...prefs, allPinned: false })}>
                Show fewer<ChevronUpIcon aria-hidden /></button> : null}
          </div>}
        </div>)}
    </div>}
    {shelves}
    </div>
    {actions.onSettings || actions.onBacklog || actions.onTriggers ? <div className="picker-footer" ref={setFooter} data-labels={plan.placeLabels ? undefined : "none"}>
      {actions.onBacklog ? <button className="picker-new" onClick={actions.onBacklog} aria-current={actions.backlogOpen ? "page" : undefined}
        title={actions.backlogCount === undefined ? "Backlog" : `Backlog: ${String(actions.backlogCount)} open ${actions.backlogCount === 1 ? "item" : "items"}`}
        aria-label={plan.placeLabels ? undefined : "Backlog"}>
        <ListTodoIcon aria-hidden size={16} />{plan.placeLabels ? "Backlog" : null}{actions.backlogCount === undefined ? null
          : <span className="picker-footer-count" aria-hidden="true">{actions.backlogCount}</span>}</button> : null}
      {actions.onTriggers ? <button className="picker-new" onClick={actions.onTriggers} aria-current={actions.triggersOpen ? "page" : undefined}
        title={actions.triggers?.title ?? "Triggers"} aria-label={actions.triggers?.title ?? "Triggers"}>
        <CalendarClockIcon aria-hidden size={16} />{plan.placeLabels ? "Triggers" : null}{actions.triggers?.chip
          ? <span className="picker-footer-count" data-tone={actions.triggers.chip.tone} aria-hidden="true">{actions.triggers.chip.text}</span> : null}</button> : null}
      {actions.onSettings ? <button className={plan.settingsLabel ? "picker-new" : "picker-new picker-footer-icon"} onClick={actions.onSettings}
        aria-current={actions.settingsOpen ? "page" : undefined} aria-label={plan.settingsLabel ? undefined : "Settings"} title={plan.settingsLabel ? undefined : "Settings"}>
        <SettingsIcon aria-hidden size={16} />{plan.settingsLabel ? "Settings" : null}</button> : null}
      {actions.onFullscreen && !fullScreenInMenu ? <button className="picker-new picker-footer-icon" onClick={actions.onFullscreen}
        aria-label={actions.fullscreen ? "Exit full screen" : "Full screen"} title={actions.fullscreen ? "Exit full screen" : "Full screen"}>
        {actions.fullscreen ? <Minimize2Icon aria-hidden size={16} /> : <Maximize2Icon aria-hidden size={16} />}</button> : null}
    </div> : null}
  </section>;
}
