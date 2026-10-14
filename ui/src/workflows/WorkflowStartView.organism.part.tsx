import { WorkflowStartView } from "./WorkflowStartView";
import { AGENTS, RICH_ENTRY, RICH_PROPOSAL, SAVED_RICH, WORKER_MODELS } from "./fixtures/sheet";

export const name = "Workflow start view";
export const note = "A workflow before it starts: the plan as the page, the route with model pickers and the inputs in the rail, Start in the foot";

export default function Proposal() {
  return <WorkflowStartView source={{ kind: "proposal", entry: RICH_ENTRY, proposal: RICH_PROPOSAL }} models={WORKER_MODELS} agents={AGENTS}
    onStart={() => {}} onChanges={async () => true} onDismiss={() => {}} onClose={() => {}} />;
}
export function Saved() {
  return <WorkflowStartView source={{ kind: "saved", workflow: SAVED_RICH }} models={WORKER_MODELS} onStart={() => {}} onBack={() => {}} onClose={() => {}} />;
}
