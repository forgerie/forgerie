import { WorkflowStopChoices } from "./WorkflowStopChoices";
import { CONTRACT_STOP, LAND_STOP } from "./fixtures/runs";

export const name = "Workflow stop choices";
export const note = "The choices at a stop; asking for changes opens a box in place";

const decide = () => Promise.resolve(true);
export default function Approve() { return <WorkflowStopChoices entry={CONTRACT_STOP} deciding={false} onDecide={decide} />; }
export function Land() { return <WorkflowStopChoices entry={LAND_STOP} deciding={false} onDecide={decide} onReview={() => {}} />; }
export function Sending() { return <WorkflowStopChoices entry={CONTRACT_STOP} deciding onDecide={decide} />; }
