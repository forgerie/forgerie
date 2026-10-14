import { WorkflowPlan } from "./WorkflowPlan";
import { planOf } from "./workflowPlan";
import { addStage, removeWorker, routeChanges } from "./workflowRoute";
import { PROPOSAL_STAGES } from "./fixtures/proposals";
import { RICH_TEXT } from "./fixtures/sheet";

export const name = "Workflow plan";
export const note = "A workflow's plan as a document in the chat's blocks, one numbered section per stage";

const plan = planOf(RICH_TEXT, PROPOSAL_STAGES);
const edited = addStage(removeWorker(PROPOSAL_STAGES.filter((stage) => stage.id !== "shape"), "port", "page"), "review", "Docs");

export default function Plan() {
  return <WorkflowPlan plan={plan} original={PROPOSAL_STAGES} />;
}
export function Running() {
  return <WorkflowPlan plan={plan} original={PROPOSAL_STAGES} progress={{ shape: "done", port: "current", review: "next", land: "next" }} />;
}
export function RouteChanged() {
  return <WorkflowPlan plan={plan} original={PROPOSAL_STAGES} stages={edited} changes={routeChanges(PROPOSAL_STAGES, edited)} />;
}
