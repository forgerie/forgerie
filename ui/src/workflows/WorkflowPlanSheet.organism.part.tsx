import { WorkflowPlanSheet } from "./WorkflowPlanSheet";
import { SAVED } from "./fixtures/runs";

export const name = "Workflow plan sheet";
export const note = "What a saved workflow will do before it starts: the task, the route, and Start";

const workflow = SAVED[0]!;
export default function Plan() {
  return <WorkflowPlanSheet workflow={workflow} starting={false} initialTask="Export run history as CSV: one endpoint and an Export button."
    onStart={() => {}} onBack={() => {}} onClose={() => {}} />;
}
export function Blocked() {
  return <WorkflowPlanSheet workflow={workflow} starting={false} blocked="Finish the running workflow before you start another."
    onStart={() => {}} onBack={() => {}} onClose={() => {}} />;
}
export function ProseOnly() {
  return <WorkflowPlanSheet workflow={SAVED[1]!} starting={false} onStart={() => {}} onBack={() => {}} onClose={() => {}} />;
}
