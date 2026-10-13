import type { ReactNode } from "react";
import "./PropertyList.css";

/** Molecule: a document's property rows, between two rules, under its title. */
export function PropertyList({ label, children }: { label?: string | undefined; children: ReactNode }) {
  return <div className="property-list" role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}
