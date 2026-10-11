import { WorkflowIcon } from "lucide-react";
import { StageStrip } from "../ui/StageStrip";
import { runStatus, stripSegments, waitingStops, type WorkflowRun } from "./workflowsModel";

/** Shape: the running workflow as a strip above the composer. Pressing it opens the run. */
export function WorkflowRunStrip({ run, onOpen }: { run: WorkflowRun; onOpen: () => void }) {
  return <StageStrip icon={<WorkflowIcon />} title={run.definition.name} status={runStatus(run)} count={waitingStops(run)}
    label={`Open the ${run.definition.name} run`} segments={stripSegments(run)} onPress={onOpen} />;
}
