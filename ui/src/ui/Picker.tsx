import { AnvilIcon, ArchiveIcon, ListTodoIcon, SettingsIcon, SquarePenIcon, ArchiveRestoreIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, EllipsisIcon, PinIcon, PinOffIcon, Trash2Icon, XIcon,
  type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { navigable, type Row, type Section } from "../picker/board";
import type { CatalogConnection } from "../picker/catalogStore";
import { commandForKey, rowCommands, type RowCommandKind } from "../picker/commands";
import type { PickerPrefs } from "../picker/prefs";
import { readRowPress, ROW_PRESS } from "../picker/press";
import type { Toast } from "../picker/rowActions";
import { WorktreeRowMark } from "./WorktreeChip";

/** What the picker draws. Built by the binding; the view does no I/O. */
export interface PickerView {
  connection: CatalogConnection;
  sections: Section[];
  /** Machine names appear in the location only when there is more than one. */
  machines: number;
  selectedId?: string | undefined;
  archivedCount: number;
  /** The one message line under the list. */
  toast?: Toast | undefined;
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
}

const PIN = <PinIcon className="picker-pin" aria-hidden />;
// The homepage's row menu icons (thread-list-item.tsx), one per command.
const COMMAND_ICONS: Record<RowCommandKind, LucideIcon> = {
  pin: PinIcon, unpin: PinOffIcon, archive: ArchiveIcon, restore: ArchiveRestoreIcon, delete: Trash2Icon, copyPath: CopyIcon,
};
// Same drawings as the Lit client's tabIcons.ts, so one concept has one picture.
const AGENTS = <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M7.5 11 16.5 6.8" /><path d="M7.5 13 16.5 17.2" /></svg>;
const TERMINAL = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 10 3 3-3 3" /><path d="M12 16h5" /></svg>;
const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;
const menuId = (id: string) => `picker-menu-${id}`;

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
      {held ? <span className="picker-from-backlog" title="Holds a backlog item" aria-label="Holds a backlog item"><ListTodoIcon aria-hidden /></span> : null}
      {row.agents || row.processes ? <span className="picker-work">
        {row.agents ? <span title={`${count(row.agents, "agent", "agents")} working`} aria-label={`${count(row.agents, "agent", "agents")} working`}>{AGENTS}{row.agents}</span> : null}
        {row.processes ? <span title={`${count(row.processes, "process", "processes")} running`} aria-label={`${count(row.processes, "process", "processes")} running`}>{TERMINAL}{row.processes}</span> : null}
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

/** The picker's message line. The shell also shows it over the thread while the sheet is closed. */
export function PickerToast({ toast, onUndo, onDismiss }: { toast: Toast; onUndo?: (() => void) | undefined; onDismiss?: (() => void) | undefined }) {
  return <div className="picker-toast" data-tone={toast.type === "error" ? "error" : undefined} role={toast.type === "error" ? "alert" : "status"}>
    <span>{toast.type === "undo" ? <>Archived <em>{toast.target.name ?? "Untitled session"}</em>{toast.note ? <>. {toast.note}</> : null}</> : toast.text}</span>
    {toast.type === "undo" && onUndo ? <button className="picker-toast-undo" onClick={onUndo}>Undo</button> : null}
    {onDismiss ? <button className="picker-toast-close" aria-label="Dismiss" onClick={onDismiss}><XIcon aria-hidden /></button> : null}
  </div>;
}

/**
 * The session picker. Pure view: sessions and the reader's arrangement come
 * in; selections, commands, and arrangement changes go out. Only open menus
 * live here.
 */
export function Picker({ view, prefs, onPrefs, actions, message }: {
  view: PickerView; prefs: PickerPrefs; onPrefs: (prefs: PickerPrefs) => void; actions: PickerActions;
  /** The app's message line, when it is not the list's own: a background start that went wrong. */
  message?: ReactNode;
}) {
  const [menu, setMenu] = useState<"board" | undefined>();
  const [rowMenu, setRowMenu] = useState<{ id: string; confirming: boolean } | undefined>();
  const listRef = useRef<HTMLDivElement>(null);
  const change = onPrefs;

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
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) return;
    if (event.key === "Escape") { if (menu) setMenu(undefined); else actions.onClose?.(); return; }
    if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") {
      event.preventDefault();
      if (selectedRow) openRowMenu(selectedRow.session.id);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
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
  return <section className="picker" aria-label="Sessions" onKeyDown={onKeyDown}>
    <header className="picker-header">
      {/* The homepage sidebar header: product mark and name. */}
      <h2 className="picker-brand"><AnvilIcon aria-hidden />Forgerie<span className="sr-only"> sessions</span></h2>
      <button className="picker-icon" aria-label="More session commands" aria-haspopup="menu" aria-expanded={menu === "board"}
        title="Grouping and archived sessions"
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
      </div> : null}
    </header>
    {/* The homepage thread list opens with "New Thread"; here it starts a session. */}
    {actions.onNew ? <button className="picker-new" onClick={actions.onNew} aria-keyshortcuts="N" title="New session (N)">
      <SquarePenIcon aria-hidden size={16} />New session</button> : null}
    {connection.type === "reconnecting" ? <p className="picker-notice" role="status"><span aria-hidden="true">&gt;</span> Reconnecting…</p> : null}
    {connection.type === "failed" && !empty ? <p className="picker-notice" data-tone="error" role="alert">{connection.message}<button onClick={actions.onRetry}>Retry now</button></p> : null}
    {connection.type === "loading" && empty ? <div className="picker-list" role="status" aria-label="Loading sessions">
      {[38, 90, 70, 38, 90, 70].map((width, index) => <span key={index} className="picker-skeleton" style={{ inlineSize: `${String(width)}%` }} />)}
    </div> : connection.type === "failed" && empty ? <div className="picker-state" role="alert">
      <strong>Could not load sessions</strong><span>{connection.message}</span><button onClick={actions.onRetry}>Retry now</button>
    </div> : empty ? <div className="picker-state"><strong>No sessions yet</strong><span>Start one with New session, and it appears here.</span></div>
    : <div className="picker-list" role="listbox" aria-label="Sessions" tabIndex={0} ref={listRef}
        aria-activedescendant={view.selectedId ? `picker-row-${view.selectedId}` : undefined}>
      {view.sections.every((section) => section.kind === "band" || section.kind === "archived" || section.kind === "project")
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
    {view.toast ? <PickerToast toast={view.toast} onUndo={actions.onUndo} onDismiss={actions.onDismissToast} /> : message}
    {actions.onSettings || actions.onBacklog ? <div className="picker-footer">
      {actions.onBacklog ? <button className="picker-new" onClick={actions.onBacklog} aria-current={actions.backlogOpen ? "page" : undefined}
        title={actions.backlogCount === undefined ? "Backlog" : `Backlog: ${String(actions.backlogCount)} open ${actions.backlogCount === 1 ? "item" : "items"}`}>
        <ListTodoIcon aria-hidden size={16} />Backlog{actions.backlogCount === undefined ? null
          : <span className="picker-footer-count" aria-hidden="true">{actions.backlogCount}</span>}</button> : null}
      {actions.onSettings ? <button className="picker-new" onClick={actions.onSettings} aria-current={actions.settingsOpen ? "page" : undefined}>
        <SettingsIcon aria-hidden size={16} />Settings</button> : null}
    </div> : null}
  </section>;
}
