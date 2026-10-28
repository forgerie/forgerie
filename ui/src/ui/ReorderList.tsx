import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon, XIcon } from "lucide-react";
import "./ReorderList.css";

/** One row of an ordered list. `label` names the row in its controls and in what a screen reader hears after a move. */
export interface ReorderRow {
  key: string;
  label: string;
  content: ReactNode;
  /** A line under the row: `warn` for trouble the row survives, `danger` for a row that is wrong. */
  note?: { text: string; tone?: "warn" | "danger" | undefined } | undefined;
}

type Control = "handle" | "up" | "down" | "remove";
/**
 * Where focus goes after an action, first choice first: the same control, then its partner when a move to an end
 * turned it off. A focus that does not take moves on to the next.
 */
const FOCUS_ORDER: Record<Control, readonly string[]> = {
  up: ["up", "down", "handle"], down: ["down", "up", "handle"], handle: ["handle"], remove: ["remove"],
};
interface Drag { pointer: number; from: number; startY: number; centers: number[]; shift: number }

/** Where `from` lands when its centre has moved to `center`: the number of other rows whose centre is above it. */
const dropIndex = (centers: readonly number[], from: number, center: number) =>
  centers.reduce((count, other, index) => index !== from && other < center ? count + 1 : count, 0);

/**
 * Molecule: a short list whose order means something, such as which choice is tried first. Each row shows its place,
 * a handle, its content, and Move up, Move down and Remove named for it. A row moves by its handle (mouse, pen or
 * touch: the rows between make room, and the row lands where it is let go; Escape puts it back), by the move buttons,
 * or by the arrow keys on its handle. Focus follows the moved row, and a live region says where it landed; after a
 * removal it goes to the row that takes its place, else to the foot. Under its least width the row's buttons wrap
 * under its content as one group. With no rows the empty text takes their place.
 */
export function ReorderList({ label, rows, empty, foot, note, disabled = false, removeBlocked, onMove, onRemove }: {
  /** The list's accessible name. */
  label: string;
  rows: readonly ReorderRow[];
  empty: ReactNode;
  /** A control under the rows, such as one that adds a row. */
  foot?: ReactNode;
  /** A quiet line under the foot, such as a limit that has been reached. */
  note?: ReactNode;
  disabled?: boolean | undefined;
  /** Set to keep every Remove off, such as for a list that must keep a row; the words say why, in Remove's title. */
  removeBlocked?: string | undefined;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const [dragging, setDragging] = useState<{ from: number; to: number; dy: number }>();
  const [said, setSaid] = useState("");
  /** The control to focus after the next render: the moved row's, or the row that takes a removed row's place. */
  const focusNext = useRef<{ key: string | undefined; control: Control } | undefined>(undefined);
  useLayoutEffect(() => {
    const target = focusNext.current;
    focusNext.current = undefined;
    if (!target || !root.current) return;
    const row = target.key === undefined ? undefined : [...(list.current?.children ?? [])].find((node) => node.getAttribute("data-key") === target.key);
    const candidates = [
      ...FOCUS_ORDER[target.control].map((control) => row?.querySelector<HTMLElement>(`button[data-control="${control}"]:not(:disabled)`)),
      // A row whose own buttons are all off, such as the last one left, still has its content.
      ...row?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [],
      ...root.current.querySelectorAll<HTMLElement>(".reorder-list-foot button:not(:disabled)"),
    ];
    for (const candidate of candidates) {
      candidate?.focus();
      if (candidate && document.activeElement === candidate) return;
    }
  });

  const move = (from: number, to: number, control: Control) => {
    const row = rows[from];
    if (!row || to < 0 || to >= rows.length || to === from) return;
    focusNext.current = { key: row.key, control };
    setSaid(`${row.label}, ${String(to + 1)} of ${String(rows.length)}`);
    onMove(from, to);
  };
  const remove = (index: number) => {
    const next = rows[index + 1] ?? rows[index - 1];
    focusNext.current = { key: next?.key, control: "remove" };
    setSaid("");
    onRemove(index);
  };

  const start = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    if (disabled || event.button !== 0 || !list.current) return;
    const items = [...list.current.children].map((node) => node.getBoundingClientRect());
    const own = items[index];
    if (!own) return;
    event.preventDefault();
    // Keeping the press from starting a text selection also keeps focus away, so the handle takes it here: Escape then reaches it.
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = items[index + 1] ?? items[index - 1];
    // The rows between make room by the dragged row's height and the gap after it.
    const gap = next ? Math.abs((next.top > own.top ? next.top - own.bottom : own.top - next.bottom)) : 0;
    drag.current = { pointer: event.pointerId, from: index, startY: event.clientY, centers: items.map((rect) => rect.top + rect.height / 2), shift: own.height + gap };
    setDragging({ from: index, to: index, dy: 0 });
  };
  const follow = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    const dy = event.clientY - current.startY;
    setDragging({ from: current.from, to: dropIndex(current.centers, current.from, (current.centers[current.from] ?? 0) + dy), dy });
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, drop: boolean) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    drag.current = undefined;
    const to = dragging?.to ?? current.from;
    setDragging(undefined);
    if (drop) move(current.from, to, "handle");
  };
  const keys = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Escape" && drag.current) { event.preventDefault(); drag.current = undefined; setDragging(undefined); return; }
    if (disabled || drag.current || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    move(index, index + (event.key === "ArrowUp" ? -1 : 1), "handle");
  };
  /** How far a row stands from its place while another row is dragged: the dragged row follows the pointer, the rows it passed make room. */
  const offsetOf = (index: number): number => {
    if (!dragging || !drag.current) return 0;
    const { from, to, dy } = dragging;
    if (index === from) return dy;
    if (from < to && index > from && index <= to) return -drag.current.shift;
    if (to < from && index >= to && index < from) return drag.current.shift;
    return 0;
  };

  return <div className="reorder-list" ref={root}>
    {rows.length === 0 ? <p className="reorder-list-empty">{empty}</p>
      : <ol className="reorder-list-rows" ref={list} aria-label={label} data-dragging={dragging ? "" : undefined}>{rows.map((row, index) => {
        const offset = offsetOf(index);
        return <li key={row.key} className="reorder-list-row" data-key={row.key} data-lifted={dragging?.from === index ? "" : undefined}
          style={{ "--reorder-offset": `${String(offset)}px` }}>
          <span className="reorder-list-place" aria-hidden="true">{index + 1}</span>
          <button type="button" className="reorder-list-handle" data-control="handle" disabled={disabled || rows.length < 2}
            aria-label={`Drag to move ${row.label}`} title="Drag, or use the arrow keys, to move"
            onPointerDown={(event) => start(event, index)} onPointerMove={follow}
            onPointerUp={(event) => finish(event, true)} onPointerCancel={(event) => finish(event, false)}
            onKeyDown={(event) => keys(event, index)}><GripVerticalIcon aria-hidden /></button>
          <div className="reorder-list-content">{row.content}</div>
          <span className="reorder-list-actions">
            <button type="button" className="reorder-list-button" data-control="up" disabled={disabled || index === 0}
              aria-label={`Move ${row.label} up`} title="Move up" onClick={() => move(index, index - 1, "up")}><ArrowUpIcon aria-hidden /></button>
            <button type="button" className="reorder-list-button" data-control="down" disabled={disabled || index === rows.length - 1}
              aria-label={`Move ${row.label} down`} title="Move down" onClick={() => move(index, index + 1, "down")}><ArrowDownIcon aria-hidden /></button>
            <button type="button" className="reorder-list-button" data-control="remove" disabled={disabled || removeBlocked !== undefined}
              aria-label={`Remove ${row.label}`} title={removeBlocked ?? "Remove"} onClick={() => remove(index)}><XIcon aria-hidden /></button>
          </span>
          {row.note ? <p className="reorder-list-note" data-tone={row.note.tone}>{row.note.text}</p> : null}
        </li>;
      })}</ol>}
    {foot ? <div className="reorder-list-foot">{foot}</div> : null}
    {note ? <p className="reorder-list-limit">{note}</p> : null}
    <span className="reorder-list-said" role="status">{said}</span>
  </div>;
}
