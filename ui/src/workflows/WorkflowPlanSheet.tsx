import { useState } from "react";
import { ActionFooter } from "../ui/ActionFooter";
import { Lede } from "../ui/Lede";
import { RouteMap } from "../ui/RouteMap";
import { SheetDialog } from "../ui/SheetDialog";
import { WorkflowInputFields } from "./WorkflowInputFields";
import { launchInputs, routeSteps, type SavedWorkflow, type WorkflowInputs } from "./workflowsModel";

/**
 * Shape: what a saved workflow will do, before anything starts: its inputs
 * (the task first), its route with the stops that wait on the reader, and
 * Start. Starting needs an idle session with no other workflow running.
 */
export function WorkflowPlanSheet({ workflow, blocked, starting, error, initialTask, onStart, onBack, onClose }: {
  workflow: SavedWorkflow;
  /** Why the workflow cannot start now, such as another run in progress. */
  blocked?: string | undefined;
  starting: boolean;
  error?: string | undefined;
  /** A first draft of the task, such as the composer's text. */
  initialTask?: string | undefined;
  onStart: (inputs: WorkflowInputs) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const inputs = Object.entries(workflow.definition.inputs ?? {});
  const [typed, setTyped] = useState<Record<string, string>>(() => Object.fromEntries(inputs.map(([name, input]) =>
    [name, name === "task" && initialTask !== undefined ? initialTask : input.default === undefined ? "" : String(input.default)])));
  const [problem, setProblem] = useState<string>();
  const stages = workflow.definition.stages ?? [];
  const set = (name: string, value: string) => { setTyped((current) => ({ ...current, [name]: value })); setProblem(undefined); };
  const start = () => {
    const result = launchInputs(workflow, typed);
    if ("problem" in result) setProblem(result.problem);
    else onStart(result.inputs);
  };
  const note = blocked ?? problem ?? error ?? (starting ? "Starting…" : "It runs in this chat. You can keep talking while it works.");
  return <SheetDialog title={workflow.name} subtitle={stages.length === 0 ? "Saved workflow" : `Saved workflow, ${String(stages.length)} stages`}
    back={{ label: "All workflows", onPress: onBack }} closeLabel="Close the plan" onClose={onClose}
    footer={<ActionFooter note={note} actions={[{ label: "Start workflow", onPress: start, tone: "primary", disabled: starting || blocked !== undefined }]} />}>
    {workflow.description !== undefined && <Lede>{workflow.description}</Lede>}
    <WorkflowInputFields inputs={inputs} values={typed} onChange={set} />
    {stages.length > 0 && <RouteMap label="What happens" steps={routeSteps(stages, undefined)} />}
  </SheetDialog>;
}
