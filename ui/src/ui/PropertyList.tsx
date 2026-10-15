import type { ReactNode } from "react";
import "./PropertyList.css";

/**
 * Molecule: a document's property rows, between two rules, under its title. `narrow` fits a side panel: shorter
 * labels, so a label still sits beside its value in a narrow column, and no space above the first rule.
 */
export function PropertyList({ label, narrow = false, children }: { label?: string | undefined; narrow?: boolean | undefined; children: ReactNode }) {
  return <div className="property-list" role={label ? "group" : undefined} aria-label={label} data-narrow={narrow || undefined}>{children}</div>;
}
