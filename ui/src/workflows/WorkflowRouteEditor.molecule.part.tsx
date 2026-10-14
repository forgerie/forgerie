import { useState } from "react";
import { WorkflowRouteEditor } from "./WorkflowRouteEditor";
import type { WorkflowStage } from "./workflowsModel";
import { PROPOSAL_STAGES } from "./fixtures/proposals";
import { AGENTS, WORKER_MODELS } from "./fixtures/sheet";

export const name = "Workflow route editor";
export const note = "A route before it starts: workers with their model pickers, and Edit stages to add and remove stages and workers";

/** Real handlers on local state: every edit changes the route. */
function Editing({ editable = true, editing: initial = false }: { editable?: boolean; editing?: boolean }) {
  const [stages, setStages] = useState<WorkflowStage[]>(PROPOSAL_STAGES);
  const [editing, setEditing] = useState(initial);
  return <WorkflowRouteEditor original={PROPOSAL_STAGES} stages={stages} onChange={setStages} editable={editable} editing={editing} onEditing={setEditing}
    disabled={false} models={WORKER_MODELS} resetLabel="Use the agent's" agents={AGENTS} onJump={() => {}} />;
}

export default function Proposed() { return <Editing />; }
export function EditStages() { return <Editing editing />; }
export function SavedFile() { return <Editing editable={false} />; }
