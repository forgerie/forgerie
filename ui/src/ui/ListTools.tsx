import type { ReactNode } from "react";
import "./ListTools.css";

/**
 * Molecule: the controls that choose what a list below them shows, such as
 * a switch and a search box, stacked with one gap and set apart from the
 * list's first section. A `readout`, such as a total, sits beside the last
 * control while the row has room for both and goes under it when it does not.
 */
export function ListTools({ label, readout, children }: { label: string; readout?: string | undefined; children: ReactNode }) {
  return <div className="list-tools" role="search" aria-label={label}>
    {readout === undefined ? children : <div className="list-tools-row">{children}<span className="list-tools-readout">{readout}</span></div>}
  </div>;
}
