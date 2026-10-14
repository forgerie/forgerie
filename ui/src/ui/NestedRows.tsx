import type { ReactNode } from "react";
import "./NestedRows.css";

/**
 * Molecule: a short list of rows that belong to the line or row above them,
 * such as the parts one event was made of. The rows come in as `<li>`
 * children, indented on a hairline so they read as one group under their
 * owner. `label` names the group for a screen reader.
 */
export function NestedRows({ label, children }: { label: string; children: ReactNode }) {
  return <ul className="nested-rows" aria-label={label}>{children}</ul>;
}
