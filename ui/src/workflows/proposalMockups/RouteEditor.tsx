// Mockup only. The route in the rail, which the reader can change before the
// run starts. Each worker's model can change at any time. With Edit on,
// stages and workers can be added and removed; the plan then needs an update.
import { Fragment, useRef, useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { ModelPicker, type ModelBinding, type PickerOpen } from "../../ui/ModelPicker";
import { thinkingLevelsFor } from "../../newSession";
import type { WorkflowStage } from "../workflowsModel";
import { AGENTS, freeStageId, freeWorkerName, MODELS, modelName, modelText, parseModel, sessionModelOf, withModel, withWorkers, type Worker } from "./routeEdits";

/** One worker's model, as the composer's picker shows it. Without a model, the worker runs on the session's. */
function WorkerModel({ worker, proposed, disabled, onChange }: {
  worker: Worker; proposed: string | undefined; disabled: boolean; onChange: (model: string | undefined) => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<PickerOpen>();
  const spec = parseModel(worker.model);
  const model = sessionModelOf(worker.model);
  const binding: ModelBinding = {
    model, thinkingLevel: spec?.level, disabled, emptyLabel: "Session's model",
    listModels: async () => MODELS, listThinkingLevels: async () => thinkingLevelsFor(model),
    onModel: async (provider, id) => onChange(modelText({ provider, id, level: spec?.level })),
    onThinkingLevel: async (level) => { if (spec !== undefined) onChange(modelText({ ...spec, level })); },
  };
  const edited = worker.model !== proposed;
  return <span ref={anchor} className="pm-worker-model" data-edited={edited || undefined}>
    <ModelPicker binding={binding} anchor={anchor} open={open} onOpenChange={setOpen} />
    {edited && !disabled && <button type="button" className="pm-reset" title={`The agent proposed ${modelName(proposed)}`}
      onClick={() => onChange(proposed)}>Use the agent's</button>}
  </span>;
}

type Form = { kind: "stage"; after: string | undefined } | { kind: "worker"; stage: string };

function AddStageForm({ onAdd, onCancel }: { onAdd: (name: string, does: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [does, setDoes] = useState("");
  return <form className="pm-route-form" onSubmit={(event) => { event.preventDefault(); if (name.trim() !== "") onAdd(name.trim(), does.trim()); }}>
    <input className="pm-input pm-input-plain" aria-label="Stage name" placeholder="Stage name" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
    <input className="pm-input pm-input-plain" aria-label="What the stage does" placeholder="What it does" value={does} onChange={(event) => setDoes(event.target.value)} />
    <div className="pm-route-form-actions">
      <button type="submit" className="pm-small-button" data-tone="primary" disabled={name.trim() === ""}>Add stage</button>
      <button type="button" className="pm-small-button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function AddWorkerForm({ onAdd, onCancel }: { onAdd: (agent: string) => void; onCancel: () => void }) {
  const [agent, setAgent] = useState<string>("worker");
  return <form className="pm-route-form" onSubmit={(event) => { event.preventDefault(); onAdd(agent); }}>
    <select className="pm-input pm-input-plain" aria-label="Agent" autoFocus value={agent} onChange={(event) => setAgent(event.target.value)}>
      {AGENTS.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
    <div className="pm-route-form-actions">
      <button type="submit" className="pm-small-button" data-tone="primary">Add worker</button>
      <button type="button" className="pm-small-button" onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

const Blocks = ({ stage }: { stage: WorkflowStage }) => {
  const workers = stage.workers ?? [];
  return <span className="pm-marks">
    {workers.length > 0 && <span className="pm-blocks" aria-hidden>{workers.map((worker) => <span key={worker.name} className="pm-block" />)}</span>}
    {stage.stop !== undefined && <span className="pm-you">You</span>}
  </span>;
};

/** The route. `original` is the agent's; `stages` is the reader's copy. */
export function RouteEditor({ original, stages, onChange, editing, onEditing, disabled, current, onJump }: {
  original: readonly WorkflowStage[]; stages: readonly WorkflowStage[]; onChange: (stages: WorkflowStage[]) => void;
  editing: boolean; onEditing: (editing: boolean) => void; disabled: boolean;
  current?: string | undefined; onJump?: ((id: string) => void) | undefined;
}) {
  const [form, setForm] = useState<Form>();
  const before = (id: string) => original.find((stage) => stage.id === id);
  const update = (id: string, change: (stage: WorkflowStage) => WorkflowStage) => onChange(stages.map((stage) => stage.id === id ? change(stage) : stage));
  const setWorkers = (id: string, workers: Worker[]) => update(id, (stage) => withWorkers(stage, workers));
  const addStage = (after: string | undefined, name: string, does: string) => {
    const stage: WorkflowStage = { id: freeStageId(stages, name), name, ...(does === "" ? {} : { does }) };
    const at = after === undefined ? 0 : stages.findIndex((s) => s.id === after) + 1;
    onChange([...stages.slice(0, at), stage, ...stages.slice(at)]);
    setForm(undefined);
  };
  const insert = (after: string | undefined) => !editing ? null
    : form?.kind === "stage" && form.after === after ? <li className="pm-route-insert"><AddStageForm onAdd={(name, does) => addStage(after, name, does)} onCancel={() => setForm(undefined)} /></li>
    : <li className="pm-route-insert"><button type="button" className="pm-add" onClick={() => setForm({ kind: "stage", after })}><PlusIcon aria-hidden />Add a stage here</button></li>;

  return <>
    <div className="pm-route-head">
      <h3 className="pm-section-label">Route</h3>
      {!disabled && <button type="button" className="pm-text-button" aria-pressed={editing} onClick={() => { onEditing(!editing); setForm(undefined); }}>
        {editing ? "Done" : "Edit stages"}</button>}
    </div>
    <ol className="pm-route" role="list" data-editing={editing || undefined}>
      {insert(undefined)}
      {stages.map((stage, index) => {
        const was = before(stage.id);
        const workers = stage.workers ?? [];
        const head = <>
          <span className="pm-route-num">{index + 1}</span>
          <span className="pm-route-text">
            <span className="pm-route-name">{stage.name}{was === undefined && <span className="pm-new">New</span>}</span>
            {workers.length === 0 && <span className="pm-route-who" data-does={stage.stop === undefined && stage.does !== undefined || undefined}>
              {stage.stop === "land" ? "You land the branches" : stage.stop !== undefined ? "You approve" : stage.does ?? "This chat"}</span>}
          </span>
          <Blocks stage={stage} />
        </>;
        return <Fragment key={stage.id}><li className="pm-route-item" data-current={current === stage.id || undefined}>
          <div className="pm-route-row">
            {onJump === undefined ? <div className="pm-route-stage">{head}</div>
              : <button type="button" className="pm-route-stage" aria-current={current === stage.id ? "location" : undefined} onClick={() => onJump(stage.id)}>{head}</button>}
            {editing && <button type="button" className="pm-icon-small" aria-label={`Remove stage ${stage.name}`} title={`Remove stage ${stage.name}`}
              onClick={() => onChange(stages.filter((s) => s.id !== stage.id))}><XIcon aria-hidden /></button>}
          </div>
          {workers.length > 0 && <ul className="pm-worker-list" role="list">
            {workers.map((worker) => {
              const proposed = was?.workers?.find((w) => w.name === worker.name);
              return <li key={worker.name} className="pm-worker-row">
                <span className="pm-block" aria-hidden />
                <span className="pm-worker-who"><code>{worker.name}</code> {worker.agent ?? "general helper"}
                  {proposed === undefined && <span className="pm-new">New</span>}</span>
                {editing && <button type="button" className="pm-icon-small" aria-label={`Remove worker ${worker.name}`} title={`Remove worker ${worker.name}`}
                  onClick={() => setWorkers(stage.id, workers.filter((w) => w.name !== worker.name))}><XIcon aria-hidden /></button>}
                <WorkerModel worker={worker} proposed={proposed === undefined ? worker.model : proposed.model} disabled={disabled}
                  onChange={(model) => setWorkers(stage.id, workers.map((w) => w.name === worker.name ? withModel(w, model) : w))} />
              </li>;
            })}
          </ul>}
          {editing && (form?.kind === "worker" && form.stage === stage.id
            ? <AddWorkerForm onCancel={() => setForm(undefined)} onAdd={(agent) => {
              setWorkers(stage.id, [...workers, { name: freeWorkerName(stages, agent), agent }]); setForm(undefined);
            }} />
            : <button type="button" className="pm-add pm-add-worker" onClick={() => setForm({ kind: "worker", stage: stage.id })}><PlusIcon aria-hidden />Add a worker</button>)}
        </li>{insert(stage.id)}</Fragment>;
      })}
    </ol>
  </>;
}
