import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import "./StageStrip.css";

/** done: finished. working: at work now. waiting: waits on the reader. failed: its worker failed. next: not reached. */
export type StageStripState = "done" | "working" | "waiting" | "failed" | "next";
/** One stage as a bar. A stage with several lanes, such as parallel workers, is stacked bars. */
export interface StageStripSegment { key: string; lanes: readonly StageStripState[] }

/**
 * Molecule: a whole process as one row of bars, with its name, its status,
 * and a count of what waits on the reader; the whole strip opens the process.
 * It sits above an input. A narrow strip drops the name first; a short
 * container puts the bars beside the text so the strip takes one row.
 */
export function StageStrip({ icon, title, status, count = 0, label, segments, onPress }: {
  icon: ReactNode;
  title: string;
  status: string;
  /** Things that wait on the reader. */
  count?: number;
  /** Accessible name of the press. */
  label: string;
  segments: readonly StageStripSegment[];
  onPress: () => void;
}) {
  return <button type="button" className="stage-strip" aria-label={`${label}: ${status}`} onClick={onPress}>
    <span className="stage-strip-bars" aria-hidden>
      {segments.map((segment) => <span key={segment.key} className="stage-strip-segment" data-lanes={segment.lanes.length > 1 || undefined}>
        {segment.lanes.map((state, index) => <span key={index} className="stage-strip-bar" data-state={state} />)}
      </span>)}
    </span>
    <span className="stage-strip-text">
      <span className="stage-strip-icon" aria-hidden>{icon}</span>
      <span className="stage-strip-title">{title}</span>
      <span className="stage-strip-status">{status}</span>
      {count > 0 && <span className="stage-strip-count" aria-hidden>{count}</span>}
      <ChevronRightIcon className="stage-strip-open" aria-hidden />
    </span>
  </button>;
}
