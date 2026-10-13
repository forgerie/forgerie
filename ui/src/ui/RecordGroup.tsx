import { useId, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import "./RecordGroup.css";

/**
 * Molecule: a named group of records under a heading that counts them and
 * runs a rule to the edge. The heading opens and closes the group; its owner
 * keeps that choice. A group that wants the reader sets its name in full ink.
 */
export function RecordGroup({ label, count, open, onToggle, emphasis = false, compact = false, children }: {
  label: string; count: number; open: boolean; onToggle: () => void; emphasis?: boolean;
  /** A short list: the heading takes less room above its label, so another row shows. */
  compact?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return <section className="record-group" data-emphasis={emphasis || undefined} data-compact={compact || undefined} aria-labelledby={id}>
    <h2 className="record-group-heading">
      <button type="button" className="record-group-toggle" id={id} aria-expanded={open} onClick={onToggle}>
        <ChevronDownIcon className="record-group-chevron" aria-hidden /><span className="record-group-label">{label}</span>
        <span className="record-group-count">{count}</span>
      </button>
    </h2>
    {open ? <ul className="record-group-rows">{children}</ul> : null}
  </section>;
}
