import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { LedgeRow } from "./LedgeRow";
import "./LedgeStack.css";

/** One row of the stack, newest first. `key` identifies it across updates. */
export type LedgeStackRow = Omit<ComponentProps<typeof LedgeRow>, "lead" | "even"> & { key: string };

/**
 * Molecule: offers at the input as one band of a ledge. One offer is its row, and only a lone row shows its gist. Two or more fold into a
 * stack: the newest in front with its own actions, and the edges of the others behind it, never more than two (one in a
 * container under 30rem tall), so a stack of 3 and one of 30 have the same height. A count at the front row's start
 * opens the list: a head that counts, then every row, newest first, each with its own action and none louder than
 * another. The list scrolls inside a share of the container's height, with a fade at its cut edge. The head may hold one
 * control of its own before Fold, such as a menu that acts on every row at once.
 */
export function LedgeStack({ rows, open, onToggle, labels, headAction }: {
  rows: readonly LedgeStackRow[];
  /** A control in the open list's head, before Fold, such as a menu that acts on every row at once. */
  headAction?: ReactNode;
  /** The list is open. Only a stack of two or more opens. */
  open: boolean;
  onToggle: () => void;
  labels: {
    /** What a count of rows counts, such as "proposals": the head reads "3 proposals". */
    noun: (count: number) => string;
    /** The count button's name, such as "Show all 3 proposals". */
    show: (count: number) => string;
    /** The head's button, such as "Fold". */
    fold: string;
  };
}) {
  const list = useRef<HTMLUListElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [cut, setCut] = useState(false);
  const named = (count: number) => `${String(count)} ${labels.noun(count)}`;
  const many = rows.length > 1;
  const listOpen = many && open;
  // The list says there is more below while its end is out of view.
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !listOpen) { setCut(false); return; }
    const measure = () => setCut(element.scrollHeight - element.scrollTop - element.clientHeight > 1);
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => { element.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, [listOpen, rows.length]);
  // The press that opened or folded the list unmounts with it: focus, if it was there, moves to the control that does
  // the opposite.
  const moved = useRef(false);
  useLayoutEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    toggle.current?.focus({ preventScroll: true });
  }, [listOpen]);
  const press = () => { moved.current = document.activeElement === toggle.current; onToggle(); };
  if (rows.length === 0) return null;
  const { key: frontKey, ...front } = rows[0]!;
  if (!many) {
    return <div className="ledge-stack" data-ledge-band>
      <ul className="ledge-stack-rows" aria-label={named(1)}><LedgeRow key={frontKey} {...front} /></ul>
    </div>;
  }
  if (!listOpen) {
    const edges = Math.min(2, rows.length - 1);
    return <div className="ledge-stack" data-ledge-band data-ledge-edges={edges}>
      <span className="ledge-stack-edges" aria-hidden="true">
        {Array.from({ length: edges }, (_, index) => <span key={index} className="ledge-stack-edge" />)}
      </span>
      <ul className="ledge-stack-rows" aria-label={named(rows.length)}>
        <LedgeRow key={frontKey} {...front} gist={undefined} lead={<button ref={toggle} type="button" className="ledge-stack-count" aria-expanded={false}
          aria-label={labels.show(rows.length)} title={labels.show(rows.length)} onClick={press}>
          {rows.length}<ChevronUpIcon aria-hidden size={14} />
        </button>} />
      </ul>
    </div>;
  }
  return <div className="ledge-stack" data-ledge-band data-open>
    <div className="ledge-stack-head">
      <span className="ledge-stack-head-count"><strong>{rows.length}</strong> {labels.noun(rows.length)}</span>
      <span className="ledge-stack-head-actions">
        {headAction}
        <button ref={toggle} type="button" className="ledge-stack-fold" aria-expanded={true} onClick={press}>
          {labels.fold}<ChevronDownIcon aria-hidden size={14} />
        </button>
      </span>
    </div>
    <ul ref={list} className="ledge-stack-rows" aria-label={named(rows.length)} data-cut={cut || undefined}>
      {rows.map(({ key, ...row }) => <LedgeRow key={key} {...row} gist={undefined} even />)}
    </ul>
  </div>;
}
