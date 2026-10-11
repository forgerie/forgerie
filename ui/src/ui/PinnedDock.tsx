import type { ReactNode } from "react";
import "./PinnedDock.css";

/**
 * Molecule: things that wait on the reader, pinned above an input so they
 * never scroll out of sight. A heading counts them. The dock takes at most a
 * share of its container's height and scrolls inside past that, so the input
 * under it always keeps its room.
 */
export function PinnedDock({ label, children }: {
  /** The heading and the region's accessible name, such as "2 waiting for you". */
  label: string;
  children: ReactNode;
}) {
  return <section className="pinned-dock" aria-label={label}>
    <p className="pinned-dock-label">{label}</p>
    <div className="pinned-dock-items">{children}</div>
  </section>;
}
