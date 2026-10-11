import { WorkflowIcon } from "lucide-react";
import { StageStrip } from "./StageStrip";

export const name = "Stage strip";
export const note = "A whole process as one row of bars above an input; parallel work is stacked bars";

export default function Waiting() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Contract, waiting for you" count={1} label="Open the run"
    segments={[{ key: "a", lanes: ["waiting"] }, { key: "b", lanes: ["next", "next"] }, { key: "c", lanes: ["next"] }, { key: "d", lanes: ["next"] }]} onPress={() => {}} />;
}
export function Working() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Design and build, 2 working" label="Open the run"
    segments={[{ key: "a", lanes: ["done"] }, { key: "b", lanes: ["working", "working"] }, { key: "c", lanes: ["next"] }, { key: "d", lanes: ["next"] }]} onPress={() => {}} />;
}
export function Finished() {
  return <StageStrip icon={<WorkflowIcon />} title="Design, build, review" status="Finished" label="Open the run"
    segments={[{ key: "a", lanes: ["done"] }, { key: "b", lanes: ["done", "done"] }, { key: "c", lanes: ["done"] }, { key: "d", lanes: ["done"] }]} onPress={() => {}} />;
}
