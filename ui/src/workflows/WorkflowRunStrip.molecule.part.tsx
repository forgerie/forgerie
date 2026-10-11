import { WorkflowRunStrip } from "./WorkflowRunStrip";
import { BUILDING, CONTRACT_WAITING, LANDED } from "./fixtures/runs";

export const name = "Workflow run strip";
export const note = "The running workflow above the composer; it opens the run";

export default function Waiting() { return <WorkflowRunStrip run={CONTRACT_WAITING} onOpen={() => {}} />; }
export function Building() { return <WorkflowRunStrip run={BUILDING} onOpen={() => {}} />; }
export function Finished() { return <WorkflowRunStrip run={LANDED} onOpen={() => {}} />; }
