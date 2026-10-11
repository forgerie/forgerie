import { WorkflowRunSheet } from "./WorkflowRunSheet";
import { BUILDING, CHILD_LOOKS, LAND_WAITING, LANDED } from "./fixtures/runs";

export const name = "Workflow run sheet";
export const note = "One run as its live route; each started worker opens its child";

export default function Building() {
  return <WorkflowRunSheet run={BUILDING} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}} />;
}
export function WaitingToLand() {
  return <WorkflowRunSheet run={LAND_WAITING} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}} />;
}
export function Finished() {
  return <WorkflowRunSheet run={LANDED} workers={CHILD_LOOKS} onOpenChild={() => {}} onClose={() => {}} />;
}
