import type { ReactNode } from "react";
import "./Ledge.css";

/**
 * Molecule: a surface that grows out of the top of an input bar, so what waits at the input stays in reach after the
 * thread scrolls away. It has the bar's full width, surface and edge, and the bar's top corners move up to it, so the
 * two read as one rounded shape with a faint line across it. Its bands, such as a stack of offers and a list that
 * waits to be sent, sit one under another, split by a hairline. Closed, it draws nothing, and its bands stay mounted,
 * so their state and any live region inside them survive.
 */
export function Ledge({ label, open, children }: {
  /** The region's accessible name. */
  label: string;
  /** Shown. Closed while the reader folded it away or while it holds nothing. */
  open: boolean;
  /** The bands, each marked `data-ledge-band`, top to bottom. */
  children: ReactNode;
}) {
  return <section className="ledge" data-ledge aria-label={label} data-open={open || undefined}>{children}</section>;
}
