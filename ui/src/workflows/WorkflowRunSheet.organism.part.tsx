import { WorkflowRunSheet } from "./WorkflowRunSheet";
import { BUILDING, CHILD_LOOKS, LAND_WAITING, LANDED, RETRY_LOOKS, RUN_NOW, UNSENT } from "./fixtures/runs";

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
/** design waits to retry a model error; build's report was a duplicate; review stopped before it reported. */
export function Retrying() {
  return <WorkflowRunSheet run={UNSENT} workers={RETRY_LOOKS} onOpenChild={() => {}} onClose={() => {}} now={() => RUN_NOW} />;
}
