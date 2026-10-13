import type { ReactNode } from "react";
import "./IconCount.css";

/**
 * Atom: a quiet count beside a small icon, as a readout in a row, such as
 * flagged items the reader may look at later. Muted ink: it is not a signal.
 * Its label is its name and hover text.
 */
export function IconCount({ icon, count, label }: { icon: ReactNode; count: number; label: string }) {
  return <span className="icon-count" role="img" aria-label={label} title={label}>{icon}<span aria-hidden="true">{count}</span></span>;
}
