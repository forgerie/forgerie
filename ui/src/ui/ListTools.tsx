import type { ReactNode } from "react";
import "./ListTools.css";

/**
 * Molecule: the controls that choose what a list below them shows, such as
 * a switch and a search box, stacked with one gap and set apart from the
 * list's first section.
 */
export function ListTools({ label, children }: { label: string; children: ReactNode }) {
  return <div className="list-tools" role="search" aria-label={label}>{children}</div>;
}
