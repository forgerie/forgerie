import type { StageStripState } from "./StageStrip";
import { stripGrid, type StripCell } from "./stageStripPlan";
import { useInnerWidth } from "./useInnerWidth";
import "./StageLine.css";

/** The text tone of the `+n` count: the worst state it hides, as ink (StageStrip's rule). */
const foldTone = (state: StripCell | undefined) => state === "failed" ? "bad" : state === "waiting" || state === "working" ? "live" : undefined;

/**
 * Molecule: a whole process on one text line, under a list row's words: the
 * stage strip's block grid one block high (a block per stage), the current
 * stage's name, and a count of what waits on the reader. The grid takes the
 * strip's share of the line (stageStripPlan.ts) and folds its leading stages
 * into a `+n` count past that; the name yields next, to an ellipsis with its
 * full text in `title`. Without stages (a prose-only process) the process's
 * name stands where the stage's would, with no grid. The name is muted; it
 * takes the live ink when a stop waits on the reader and the bad ink when a
 * stage failed. Decorative beside the row's words: it reads as one sentence,
 * such as "Design, build, review: Approve landing, 1 waiting for you".
 * `--stage-line-end-room` is room the host keeps clear at the line's end,
 * such as for a control that appears on hover; the last item ends before it,
 * so the measured width, and with it the fold, holds still.
 */
export function StageLine({ name, stage, stages, waiting }: {
  /** The process's name. */
  name: string;
  /** The current stage's name; "" when there is none. */
  stage: string;
  /** One state per stage, in order. Empty for a process without stages. */
  stages: readonly StageStripState[];
  /** Things that wait on the reader. */
  waiting: number;
}) {
  const [ref, width] = useInnerWidth<HTMLSpanElement>();
  const grid = stripGrid(stages.map((state, index) => ({ key: String(index), lanes: [state] })), width);
  // A failed stage outranks a stop: the reader sees the failure first. Without stages, the count alone says that something waits.
  const tone = stages.includes("failed") ? "bad" : stages.includes("waiting") || waiting > 0 ? "live" : undefined;
  const said = stage ? `${name}: ${stage}` : name;
  const label = waiting > 0 ? `${said}, ${String(waiting)} waiting for you` : said;
  const shown = stage || name;
  return <span ref={ref} className="stage-line" role="img" aria-label={label} data-tone={tone}>
    {stages.length > 0 ? <span className="stage-line-grid" aria-hidden>
      {grid.fold > 0 && <span className="stage-line-fold" data-tone={foldTone(grid.foldTone)}>+{grid.fold}</span>}
      {grid.columns.map((cells, index) => <span key={grid.fold + index} className="stage-line-block" data-state={cells[0]} />)}
    </span> : null}
    <span className="stage-line-name" title={shown}>{shown}</span>
    {waiting > 0 ? <span className="stage-line-count">{waiting}</span> : null}
  </span>;
}
