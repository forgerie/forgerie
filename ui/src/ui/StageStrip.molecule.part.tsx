import { WorkflowIcon } from "lucide-react";
import { StageStrip, type StageStripState } from "./StageStrip";

export const name = "Stage strip";
export const note = "A whole process as one row above an input: a line of blocks, one per stage, then the name and status";

export default function Waiting() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Contract, waiting for you" count={1} label="Open the run"
    stages={["done", "waiting", "next", "next", "next"]} onPress={() => {}} />;
}
/** The build stage runs three workers; its one block shows the worst of them. */
export function Working() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Build, 2 working" label="Open the run"
    stages={["done", "done", "working", "next", "next"]} onPress={() => {}} />;
}
export function Failed() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Failed" label="Open the run"
    stages={["done", "done", "failed", "next", "next"]} onPress={() => {}} />;
}
export function Finished() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Finished" label="Open the run"
    stages={["done", "done", "done", "done", "done"]} onPress={() => {}} />;
}
/** A review per module: more stages than the strip's share holds, so the leading ones fold into a count. One of them failed, so the count is red. */
export function ManyStages() {
  const stages = Array.from({ length: 40 }, (_, index): StageStripState => index === 2 ? "failed" : index < 34 ? "done" : index < 36 ? "working" : "next");
  return <StageStrip icon={<WorkflowIcon />} title="Review every module" status="Teams and theme, 4 working" label="Open the run" stages={stages} onPress={() => {}} />;
}
/** A prose-only workflow: no stages, so the icon stands where the blocks would be. */
export function NoStages() {
  return <StageStrip icon={<WorkflowIcon />} title="Tidy the changelog" status="Running" label="Open the run" stages={[]} onPress={() => {}} />;
}
