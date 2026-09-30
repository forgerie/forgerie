import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { navigable, type Row, type Section } from "../picker/board";
import type { CatalogConnection } from "../picker/catalogStore";
import type { PickerPrefs } from "../picker/prefs";

/** What the picker draws. Built by the binding; the view does no I/O. */
export interface PickerView {
  connection: CatalogConnection;
  sections: Section[];
  /** Machine names appear in the location only when there is more than one. */
  machines: number;
  selectedId?: string | undefined;
  archivedCount: number;
}
export interface PickerActions {
  onSelect: (row: Row) => void;
  onRetry: () => void;
  onClose?: (() => void) | undefined;
}

const PIN = <svg className="picker-pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" /><path d="M12 15v5" /></svg>;
// Same drawings as the Lit client's tabIcons.ts, so one concept has one picture.
const AGENTS = <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="6" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M7.5 11 16.5 6.8" /><path d="M7.5 13 16.5 17.2" /></svg>;
const TERMINAL = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 10 3 3-3 3" /><path d="M12 16h5" /></svg>;
const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

function PickerRow({ row, selected, onSelect }: { row: Row; selected: boolean; onSelect: (row: Row) => void }) {
  const { session, location } = row;
  return <div id={`picker-row-${session.id}`} className="picker-row" role="option" aria-selected={selected} data-state={row.state}
    data-session={session.id} onClick={() => onSelect(row)}>
    <span className="picker-mark" aria-hidden="true"><i /></span>
    <span className="picker-title">{session.pinned ? <>{PIN} </> : null}
      {session.name ? session.name : <span className="picker-untitled">Untitled session</span>}</span>
    <span className="picker-time" data-live={row.working || undefined}>{row.time}</span>
    <span className="picker-sub">
      <span className="picker-where" title={session.cwd}>{location.project}{location.branch ? <> · <span className="picker-branch">{location.branch}</span></> : null}</span>
      {row.agents || row.processes ? <span className="picker-work">
        {row.agents ? <span title={`${count(row.agents, "agent", "agents")} working`} aria-label={`${count(row.agents, "agent", "agents")} working`}>{AGENTS}{row.agents}</span> : null}
        {row.processes ? <span title={`${count(row.processes, "process", "processes")} running`} aria-label={`${count(row.processes, "process", "processes")} running`}>{TERMINAL}{row.processes}</span> : null}
      </span> : null}
    </span>
  </div>;
}

/**
 * The session picker. Pure view: sessions and the reader's arrangement come
 * in; selections and arrangement changes go out. Only open menus live here.
 */
export function Picker({ view, prefs, onPrefs, actions }: {
  view: PickerView; prefs: PickerPrefs; onPrefs: (prefs: PickerPrefs) => void; actions: PickerActions;
}) {
  const [menu, setMenu] = useState<"grouping" | "board" | undefined>();
  const listRef = useRef<HTMLDivElement>(null);
  const change = onPrefs;

  // The selected row's group opens, so the current session is never hidden.
  const selectedKey = useMemo(() => view.sections.find((section) => section.type === "group"
    && section.rows.some((row) => row.session.id === view.selectedId))?.key, [view.sections, view.selectedId]);
  const collapsed = useMemo(() => {
    if (!selectedKey || !prefs.collapsed.has(selectedKey)) return prefs.collapsed;
    const next = new Set(prefs.collapsed); next.delete(selectedKey); return next;
  }, [prefs.collapsed, selectedKey]);
  const order = useMemo(() => navigable(view.sections, collapsed), [view.sections, collapsed]);

  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    change({ ...prefs, collapsed: next });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) return;
    if (event.key === "Escape") { if (menu) setMenu(undefined); else actions.onClose?.(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "j" || key === "k" || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = order.findIndex((row) => row.session.id === view.selectedId);
      const step = key === "j" || event.key === "ArrowDown" ? 1 : -1;
      const next = order[index === -1 ? (step > 0 ? 0 : order.length - 1) : Math.min(Math.max(index + step, 0), order.length - 1)];
      if (next && next.session.id !== view.selectedId) actions.onSelect(next);
    } else if (key === "g") change({ ...prefs, grouping: prefs.grouping === "state" ? "project" : "state" });
    else if (key === "a") change({ ...prefs, showArchived: !prefs.showArchived });
  };
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [view.selectedId]);

  const { connection } = view;
  const empty = view.sections.length === 0;
  return <section className="picker" aria-label="Sessions" onKeyDown={onKeyDown}>
    <header className="picker-header">
      <h2><button className="picker-grouping" aria-haspopup="menu" aria-expanded={menu === "grouping"}
        onClick={() => setMenu(menu === "grouping" ? undefined : "grouping")}>
        Sessions <span className="picker-grouping-value">by {prefs.grouping}</span></button></h2>
      <button className="picker-icon" aria-label="More session commands" aria-haspopup="menu" aria-expanded={menu === "board"}
        onClick={() => setMenu(menu === "board" ? undefined : "board")}>⋯</button>
      {actions.onClose ? <button className="picker-icon" aria-label="Close sessions" onClick={actions.onClose}>×</button> : null}
      {menu === "grouping" ? <div className="picker-menu" role="menu" aria-label="Group sessions">
        {(["state", "project"] as const).map((grouping) => <button key={grouping} role="menuitemradio" aria-checked={prefs.grouping === grouping}
          onClick={() => { setMenu(undefined); change({ ...prefs, grouping }); }}>By {grouping}</button>)}
      </div> : null}
      {menu === "board" ? <div className="picker-menu picker-menu-end" role="menu" aria-label="Session commands">
        <button role="menuitemcheckbox" aria-checked={prefs.showArchived} disabled={view.archivedCount === 0}
          onClick={() => { setMenu(undefined); change({ ...prefs, showArchived: !prefs.showArchived }); }}>
          Show archived <small>{view.archivedCount} · A</small></button>
      </div> : null}
    </header>
    {connection.type === "reconnecting" ? <p className="picker-notice" role="status"><span aria-hidden="true">&gt;</span> Reconnecting…</p> : null}
    {connection.type === "failed" && !empty ? <p className="picker-notice" data-tone="error" role="alert">{connection.message}<button onClick={actions.onRetry}>Retry now</button></p> : null}
    {connection.type === "loading" && empty ? <div className="picker-list" role="status" aria-label="Loading sessions">
      {[38, 90, 70, 38, 90, 70].map((width, index) => <span key={index} className="picker-skeleton" style={{ inlineSize: `${String(width)}%` }} />)}
    </div> : connection.type === "failed" && empty ? <div className="picker-state" role="alert">
      <strong>Could not load sessions</strong><span>{connection.message}</span><button onClick={actions.onRetry}>Retry now</button>
    </div> : empty ? <div className="picker-state"><strong>No sessions yet</strong><span>Start one and it appears here.</span></div>
    : <div className="picker-list" role="listbox" aria-label="Sessions" tabIndex={0} ref={listRef}
        aria-activedescendant={view.selectedId ? `picker-row-${view.selectedId}` : undefined}>
      {view.sections.every((section) => section.type === "label" || section.kind === "band" || section.kind === "archived" || section.kind === "project")
        && prefs.grouping === "state" ? <p className="picker-clear">Nothing is waiting for you</p> : null}
      {view.sections.map((section) => section.type === "label"
        ? <div key={section.key} className="picker-band">{section.text}</div>
        : <div key={section.key} className="picker-group" data-kind={section.kind}>
          <button className="picker-group-header" aria-expanded={!collapsed.has(section.key)} onClick={() => toggle(section.key)}>
            <span className="picker-chevron" aria-hidden="true">▾</span><span className="picker-group-label">{section.label}</span>
            <span className="picker-count">{section.rows.length}</span>
          </button>
          {collapsed.has(section.key) ? null : <div role="group" aria-label={section.label}>
            {section.rows.map((row) => <PickerRow key={row.session.id} row={row} selected={row.session.id === view.selectedId} onSelect={actions.onSelect} />)}
          </div>}
        </div>)}
    </div>}
  </section>;
}
