import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import "./FilterChip.css";

/**
 * Atom: a filter that is on. It sits above the list it narrows, so the reader
 * always knows why rows are missing, and its clear button undoes it in one
 * press. With no filter on, it is not drawn at all. A filter of several
 * choices names the first and counts the rest, so a long first name never
 * hides that there are more; the title holds them all.
 */
export function FilterChip({ icon, label, more = 0, title, detail, clear, onClear }: {
  icon?: ReactNode; label: string;
  /** How many more choices the filter holds beyond the one named. */
  more?: number | undefined;
  /** Every choice, for a label cut short. Default: the label. */
  title?: string | undefined;
  detail?: string | undefined;
  /** The clear button's accessible name, such as "Show everything". */
  clear: string; onClear: () => void;
}) {
  return <div className="filter-chip" role="status">
    {icon}<span className="filter-chip-label" title={title ?? label}>{label}</span>
    {more > 0 ? <span className="filter-chip-more">+{more}</span> : null}
    {detail ? <span className="filter-chip-detail">{detail}</span> : null}
    <button type="button" className="filter-chip-clear" aria-label={clear} title={clear} onClick={onClear}><XIcon aria-hidden size={14} /></button>
  </div>;
}
