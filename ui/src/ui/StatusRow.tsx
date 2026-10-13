import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import "./StatusRow.css";

/** waiting: on the reader. working: at work now. retrying: waits to try again after an error. quiet: neither. */
export type StatusTone = "waiting" | "working" | "retrying" | "quiet";

/**
 * Molecule: one pressable row in a list of running things. A tone dot, a name
 * in the code face, a quieter detail, and a status phrase. When the row is too
 * narrow, the detail and status wrap under the name instead of vanishing. A
 * row that waits on the reader carries the live colour on its edge; one that
 * waits to retry an error takes the warn colour on its dot and status.
 */
export function StatusRow({ tone, name, detail, status, label, onPress, below }: {
  tone: StatusTone;
  name: string;
  detail?: string | undefined;
  status: string;
  /** Accessible name of the row's action. */
  label: string;
  onPress: () => void;
  /** Content under the row that stays readable without opening it, such as a question. */
  below?: ReactNode;
}) {
  return <div className="status-row" data-tone={tone}>
    <button type="button" className="status-row-main" aria-label={label} onClick={onPress}>
      <span className="status-row-dot" aria-hidden />
      <span className="status-row-name">{name}</span>
      {detail && <span className="status-row-detail">{detail}</span>}
      <span className="status-row-status">{status}</span>
      <ChevronRightIcon className="status-row-chevron" aria-hidden />
    </button>
    {below !== undefined && <div className="status-row-below">{below}</div>}
  </div>;
}
