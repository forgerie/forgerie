import type { ReactNode } from "react";
import "./TileStrip.css";

/**
 * Molecule: tiles in one row that keeps its height. More tiles than fit
 * scroll sideways, and the last one shows cut off, so the reader sees there
 * are more. One control for all the tiles follows the last tile while the
 * row has room for it, and moves under the tiles when it does not. Notes, such
 * as a failure's full text, follow under both.
 */
export function TileStrip({ label, children, end, alerts = [], align = "start" }: {
  /** The strip's accessible name. */
  label: string;
  /** "end" lines the tiles up with content set at the end, such as the reader's own message. */
  align?: "start" | "end";
  children: ReactNode;
  end?: ReactNode;
  /** What went wrong with a tile, in full, since a tile has room for two words. */
  alerts?: readonly string[];
}) {
  return <div className="tile-strip" data-align={align}>
    <div className="tile-strip-row">
      <div className="tile-strip-tiles" role="group" aria-label={label}>{children}</div>
      {end && <div className="tile-strip-end">{end}</div>}
    </div>
    {alerts.length > 0 && <div className="tile-strip-alerts" role="alert">{alerts.map((alert) => <p key={alert}>{alert}</p>)}</div>}
  </div>;
}
