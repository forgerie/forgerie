import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { OptionPicker } from "../ui/OptionPicker";
import { RouteList, type RouteListStep } from "../ui/RouteList";
import { TextButton } from "../ui/TextButton";
import { TextSubmit } from "../ui/TextSubmit";
import { WorkerModelPicker, type WorkerModels } from "./WorkerModelPicker";
import { addStage, addWorker, removeWorker, setWorkerModel } from "./workflowRoute";
import type { WorkflowStage } from "./workflowsModel";

/** The agent a worker runs as when the reader names none. */
const HELPER = "general helper";

/** Each stop's words, as the route says them before the run. */
const stopWords = (stage: WorkflowStage) => stage.stop === "land" ? "You land the branches" : "You approve";

/**
 * Shape: a workflow's route before it starts. Each stage lists its workers by name and agent, each a hollow block
 * (planned) with its model in the composer's picker. A stop is the reader's own block. A stage opens its section of
 * the plan. With `editable`, Edit stages lets the reader add and remove stages and workers; a land stop stays last,
 * and a stop takes no workers. A route with no stages says so, and Edit stages can add the first.
 */
export function WorkflowRouteEditor({ original, stages, onChange, editable, editing, onEditing, disabled, here, onJump, models, resetLabel, agents }: {
  /** The route as proposed. */
  original: readonly WorkflowStage[];
  /** The reader's copy. */
  stages: readonly WorkflowStage[];
  onChange: (stages: WorkflowStage[]) => void;
  editable: boolean;
  editing: boolean;
  onEditing: (editing: boolean) => void;
  disabled: boolean;
  /** The stage whose section the plan shows. */
  here?: string | undefined;
  onJump?: ((stage: string) => void) | undefined;
  models: WorkerModels;
  /** The words of the way back to a worker's proposed model. */
  resetLabel: string;
  /** The agents a new worker can run as. */
  agents: readonly string[];
}) {
  const [adding, setAdding] = useState<{ after: string | undefined }>();
  const edit = editing && editable && !disabled;
  const steps = stages.map((stage, index): RouteListStep => {
    const was = original.find((candidate) => candidate.id === stage.id);
    const workers = stage.workers ?? [];
    return {
      key: stage.id, number: index + 1, name: stage.name, added: was === undefined,
      detail: workers.length > 0 ? undefined : stage.stop !== undefined ? stopWords(stage) : stage.does,
      stopTone: stage.stop === undefined ? undefined : "faint", stopLabel: stage.stop === undefined ? undefined : stopWords(stage),
      here: here === stage.id, onPress: onJump === undefined ? undefined : () => onJump(stage.id),
      remove: edit ? { label: `Remove stage ${stage.name}`, onPress: () => onChange(stages.filter((candidate) => candidate.id !== stage.id)) } : undefined,
      items: workers.map((worker) => {
        const proposed = was?.workers?.find((candidate) => candidate.name === worker.name);
        return {
          key: worker.name, name: worker.name, kind: worker.agent ?? HELPER, tones: ["faint"], blocksLabel: "Not started", added: proposed === undefined,
          edited: proposed !== undefined && proposed.model !== worker.model,
          remove: edit ? { label: `Remove worker ${worker.name}`, onPress: () => onChange(removeWorker(stages, stage.id, worker.name)) } : undefined,
          control: <WorkerModelPicker worker={worker.name} model={worker.model} models={models} disabled={disabled}
            reset={proposed === undefined ? undefined : { to: proposed.model, label: resetLabel }}
            onChange={(model) => onChange(setWorkerModel(stages, worker.name, model))} />,
        };
      }),
      after: edit && stage.stop === undefined ? <OptionPicker label="Add a worker" placeholder="Add a worker" icon={<PlusIcon aria-hidden />}
        search={agents.length > 8 ? "Find an agent" : undefined}
        options={[{ id: "", name: HELPER }, ...agents.map((agent) => ({ id: agent, name: agent }))]}
        onChoose={(agent) => onChange(addWorker(stages, stage.id, agent === "" ? undefined : agent))} /> : undefined,
    };
  });
  const lastIsLand = stages.at(-1)?.stop === "land";
  const gap = !edit ? undefined : (after: string | undefined) => {
    if (lastIsLand && after === stages.at(-1)?.id) return null;
    if (adding !== undefined && adding.after === after) return <>
      <TextSubmit label="New stage" placeholder="Stage name" action="Add stage" pending={false}
        onSubmit={async (name) => { onChange(addStage(stages, after, name)); setAdding(undefined); }} />
      <TextButton label="Cancel" onPress={() => setAdding(undefined)} />
    </>;
    return <TextButton label={stages.length === 0 ? "Add a stage" : "Add a stage here"} icon={<PlusIcon aria-hidden />} onPress={() => setAdding({ after })} />;
  };
  return <RouteList label="Route" steps={steps} gap={gap}
    empty={edit ? "No stages yet. Add the first one." : "No stages. The agent follows the plan's prose. Edit stages to give it a route."}
    action={editable && !disabled ? { label: editing ? "Done" : "Edit stages", pressed: editing, onPress: () => { onEditing(!editing); setAdding(undefined); } } : undefined} />;
}
