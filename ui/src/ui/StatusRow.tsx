import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import "./StatusRow.css";

/**
 * waiting: on the reader. working: at work now. retrying: waits to try again after an error. failed: ended in a
 * failure. quiet: done or idle. stopped: ended before it finished, or was set aside.
 */
export type StatusTone = "waiting" | "working" | "retrying" | "failed" | "quiet" | "stopped";

/** A control under the row, outside its press area, such as Answer or Land. */
export interface StatusRowAction { label: string; onPress: () => void; disabled?: boolean | undefined; tone?: "primary" | undefined }

/**
 * Molecule: one pressable row in a list of running things. A mark in the
 * margin carries the state before any words do: a block when the row is one
 * unit of work, such as a child agent, and a dot when it is not, such as a
 * process. Then a name in the code face, a quieter detail, the status phrase,
 * and an optional readout under it, such as a cost. When the row is too
 * narrow, the detail and status wrap under the name instead of vanishing.
 * Content under the row stays readable without opening it, and actions sit
 * under that, outside the row's own press.
 */
export function StatusRow({ tone, mark = "dot", name, detail, status, meta, label, onPress, below, actions = [] }: {
  tone: StatusTone;
  /** block: the row counts one unit of work. dot: the row reports a state. */
  mark?: "block" | "dot";
  name: string;
  detail?: string | undefined;
  status: string;
  /** A quiet readout after the status, such as a cost or an age. */
  meta?: string | undefined;
  /** Accessible name of the row's action. */
  label: string;
  onPress: () => void;
  /** Content under the row that stays readable without opening it, such as a question. */
  below?: ReactNode;
  actions?: readonly StatusRowAction[];
}) {
  return <div className="status-row" data-tone={tone} data-mark={mark}>
    <button type="button" className="status-row-main" aria-label={label} onClick={onPress}>
      <span className="status-row-mark" aria-hidden />
      <span className="status-row-name">{name}</span>
      {detail && <span className="status-row-detail">{detail}</span>}
      <span className="status-row-trail">
        <span className="status-row-status">{status}</span>
        {meta && <span className="status-row-meta">{meta}</span>}
      </span>
      <ChevronRightIcon className="status-row-chevron" aria-hidden />
    </button>
    {below !== undefined && <div className="status-row-below">{below}</div>}
    {actions.length > 0 && <div className="status-row-actions">{actions.map((action) => <button key={action.label} type="button"
      className="status-row-action" data-tone={action.tone} disabled={action.disabled} onClick={action.onPress}>{action.label}</button>)}</div>}
  </div>;
}
