import { useId, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import "./PinnedDock.css";

/**
 * Molecule: things that wait on the reader, pinned above an input so they
 * never scroll out of sight. A heading counts them. The dock takes at most a
 * share of its container's height and scrolls inside past that, so the input
 * under it always keeps its room.
 *
 * The heading folds the dock to its one line, so a reader on a short screen
 * can read the thread behind it. Folded, the line names what waits. A new item
 * opens the dock again, so a fold never hides something the reader has not seen.
 * The items stay mounted while folded, so a half-written answer survives.
 */
export function PinnedDock({ label, names = [], keys, children }: {
  /** The heading and the region's accessible name, such as "2 waiting for you". */
  label: string;
  /** What waits, in a few words each, shown after the heading while the dock is folded. */
  names?: readonly string[];
  /** One stable key per item. A key the reader has not folded away opens the dock again. */
  keys?: readonly string[];
  children: ReactNode;
}) {
  const itemsId = useId();
  // The keys the reader folded away; null while the dock is open.
  const [foldedKeys, setFoldedKeys] = useState<ReadonlySet<string> | null>(null);
  const folded = foldedKeys !== null && (keys ?? []).every((key) => foldedKeys.has(key));
  const named = folded && names.length > 0 ? names.join(", ") : undefined;
  return <section className="pinned-dock" aria-label={label} data-folded={folded || undefined}>
    <button type="button" className="pinned-dock-heading" aria-expanded={!folded} aria-controls={itemsId}
      title={folded ? "Show what waits for you" : "Fold to read the thread"}
      onClick={() => setFoldedKeys(folded ? null : new Set(keys ?? []))}>
      <span className="pinned-dock-label">{label}</span>
      {named !== undefined && <span className="pinned-dock-names">{named}</span>}
      {folded ? <ChevronUpIcon aria-hidden className="pinned-dock-chevron" /> : <ChevronDownIcon aria-hidden className="pinned-dock-chevron" />}
    </button>
    <div className="pinned-dock-items" id={itemsId} hidden={folded}>{children}</div>
  </section>;
}
