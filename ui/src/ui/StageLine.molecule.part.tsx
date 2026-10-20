import { StageLine } from "./StageLine";
import type { StageStripState } from "./StageStrip";

export const name = "Stage line";
export const note = "A process on one text line under a list row's words: the strip's block grid one block high, the current stage's name, and a count of what waits on the reader";

/** A seven-stage route: `done` before `at`, `at` at index `index`, `next` after. */
const route = (at: StageStripState, index: number): StageStripState[] => Array.from({ length: 7 }, (_, stage) => stage < index ? "done" : stage === index ? at : "next");

/** A stage at work: its block blinks, the name stays muted. */
export default function AtWork() {
  return <StageLine name="Design, build, review" stage="Independently review" stages={route("working", 3)} waiting={0} />;
}
/** A stop waits on the reader: the live ink and the count. */
export function Waiting() {
  return <StageLine name="Design, build, review" stage="Approve landing" stages={route("waiting", 5)} waiting={1} />;
}
/** A stage failed: its block and the name in the bad ink. */
export function Failed() {
  return <StageLine name="Design, build, review" stage="Implement and test" stages={route("failed", 2)} waiting={0} />;
}
/** Forty stages: the leading ones fold into a count in the worst tone they hide. */
export function ManyStages() {
  return <StageLine name="Review every module" stage="Review the queue module" stages={[...Array<StageStripState>(34).fill("done"), "working", "working", ...Array<StageStripState>(4).fill("next")]} waiting={0} />;
}
/** A long name ends in an ellipsis after the grid and before the count. */
export function LongName() {
  return <StageLine name="Design, build, review" stage="Rebase, verify, and fast-forward onto main after the final combined checks" stages={route("waiting", 6)} waiting={2} />;
}
/** No stages: the process's name alone, with the count. */
export function NoStages() {
  return <StageLine name="Write and review" stage="" stages={[]} waiting={1} />;
}
