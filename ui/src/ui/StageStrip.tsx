import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { stripGrid, type StripCell } from "./stageStripPlan";
import "./StageStrip.css";

/** done: finished. working: at work now. waiting: waits on the reader. failed: its worker failed. next: not reached. */
export type StageStripState = "done" | "working" | "waiting" | "failed" | "next";
/** One stage as a bar. A stage with several lanes, such as parallel workers, is stacked bars. */
export interface StageStripSegment { key: string; lanes: readonly StageStripState[] }

/** The root size the plan's thresholds assume, in CSS px. */
const PLAN_ROOT = 16;

/** The strip's content width, scaled to a 16 px root so the plan's thresholds follow the reader's text size. 0 until laid out. */
function useInnerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const style = getComputedStyle(element);
      const root = Number.parseFloat(getComputedStyle(element.ownerDocument.documentElement).fontSize) || PLAN_ROOT;
      const content = element.clientWidth - (Number.parseFloat(style.paddingInlineStart) || 0) - (Number.parseFloat(style.paddingInlineEnd) || 0);
      setWidth(Math.max(0, content) * PLAN_ROOT / root);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** The text tone of the `+n` count: the worst state it hides, as ink. */
const foldTone = (state: StripCell | undefined) => state === "failed" ? "bad" : state === "waiting" || state === "working" ? "live" : undefined;

/**
 * Molecule: a whole process as one row: a block grid, its name, its status,
 * and a count of what waits on the reader; the whole strip opens the process.
 * It sits above an input. The grid has a column per stage and a block per
 * lane, stacked from the floor, and takes at most 40% of the strip; past
 * that, the leading stages fold into a `+n` count in the worst tone they
 * hide. Without stages, `icon` stands where the grid would be. A narrow
 * strip drops the name first.
 */
export function StageStrip({ icon, title, status, count = 0, label, segments, onPress }: {
  /** Drawn in place of the grid when there are no stages. */
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
  const [ref, width] = useInnerWidth<HTMLButtonElement>();
  const grid = stripGrid(segments, width);
  return <button ref={ref} type="button" className="stage-strip" aria-label={`${label}: ${status}`} onClick={onPress}>
    {grid.columns.length === 0
      ? <span className="stage-strip-icon" aria-hidden>{icon}</span>
      : <span className="stage-strip-grid" aria-hidden>
        {grid.fold > 0 && <span className="stage-strip-fold" data-tone={foldTone(grid.foldTone)}>+{grid.fold}</span>}
        {grid.columns.map((cells, index) => <span key={segments[grid.fold + index]?.key ?? index} className="stage-strip-column">
          {cells.map((state, row) => <span key={row} className="stage-strip-block" data-state={state} />)}
        </span>)}
      </span>}
    <span className="stage-strip-title">{title}</span>
    <span className="stage-strip-status">{status}</span>
    {count > 0 && <span className="stage-strip-count" aria-hidden>{count}</span>}
    <ChevronRightIcon className="stage-strip-open" aria-hidden />
  </button>;
}
