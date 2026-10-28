import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import "./FoldHandle.css";

/** One count the handle reads, such as 3 and "proposals". */
export interface FoldCount { count: number; noun: string }

/**
 * Atom: the one press that folds a surface above an input away and brings it back, as a pill in the input's row.
 * It reads what the surface holds, as its counts in words or as their total, and a live dot when something new
 * arrived while it was folded. The surface never reopens on its own. The label carries the whole state.
 */
export function FoldHandle({ counts, form, folded, fresh = false, label, onToggle, measure = false }: {
  counts: readonly FoldCount[];
  /** `total`: one number, for a row with no room for the words. The words stay in the label. */
  form: "words" | "total";
  folded: boolean;
  /** Something new arrived while folded. */
  fresh?: boolean;
  /** The accessible name and hover text, such as "Fold 3 proposals, 2 queued away". */
  label: string;
  onToggle: () => void;
  /** Drawn only to be measured, such as by a row that plans its room: no button, nothing to press or hear. */
  measure?: boolean;
}) {
  const shown = counts.filter((part) => part.count > 0);
  const total = shown.reduce((sum, part) => sum + part.count, 0);
  const face = <>
    {form === "words" ? <span className="fold-handle-words">
      {shown.map((part, index) => <span key={part.noun}>{index > 0 ? ", " : null}<b>{part.count}</b> {part.noun}</span>)}
    </span> : <span className="fold-handle-total">{total}</span>}
    {folded ? <ChevronUpIcon aria-hidden size={14} /> : <ChevronDownIcon aria-hidden size={14} />}
  </>;
  if (measure) return <span className="fold-handle" aria-hidden="true">{face}</span>;
  return <button type="button" className="fold-handle" aria-expanded={!folded} aria-label={label} title={label} data-fresh={fresh || undefined}
    onClick={onToggle}>{face}</button>;
}
