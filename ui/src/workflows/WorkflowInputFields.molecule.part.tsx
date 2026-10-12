import { useState } from "react";
import { WorkflowInputFields } from "./WorkflowInputFields";
import type { WorkflowInput } from "./workflowsModel";
import { PROPOSAL } from "./fixtures/proposals";

export const name = "Workflow input fields";
export const note = "A workflow's inputs as fields: the task first, yes-or-no and choices as toggles, the rest as text";

/** Real handlers on local state: typing and toggling change the values. */
function Editing({ inputs, initial }: { inputs: readonly (readonly [string, WorkflowInput])[]; initial: Record<string, string> }) {
  const [values, setValues] = useState(initial);
  return <WorkflowInputFields inputs={inputs} values={values} onChange={(field, value) => setValues((current) => ({ ...current, [field]: value }))} />;
}

const TASK_ONLY: [string, WorkflowInput][] = [["task", { type: "string" }]];
export default function TaskOnly() {
  return <Editing inputs={TASK_ONLY} initial={{ task: PROPOSAL.inputs["task"] as string }} />;
}
export function EveryKind() {
  return <Editing inputs={Object.entries(PROPOSAL.definition.inputs ?? {})}
    initial={{ task: PROPOSAL.inputs["task"] as string, base: "main", rounds: "2" }} />;
}
export function Empty() {
  return <Editing inputs={TASK_ONLY} initial={{ task: "" }} />;
}
