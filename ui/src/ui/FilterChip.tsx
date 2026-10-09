import type { ReactNode } from "react";
import { XIcon } from "lucide-react";
import "./FilterChip.css";

/**
 * Atom: a filter that is on. It sits above the list it narrows, so the reader
 * always knows why rows are missing, and its clear button undoes it in one
 * press. With no filter on, it is not drawn at all.
 */
export function FilterChip({ icon, label, detail, clear, onClear }: {
  icon?: ReactNode; label: string; detail?: string | undefined;
  /** The clear button's accessible name, such as "Show everything". */
  clear: string; onClear: () => void;
}) {
  return <div className="filter-chip" role="status">
    {icon}<span className="filter-chip-label">{label}</span>
    {detail ? <span className="filter-chip-detail">{detail}</span> : null}
    <button type="button" className="filter-chip-clear" aria-label={clear} title={clear} onClick={onClear}><XIcon aria-hidden size={14} /></button>
  </div>;
}
