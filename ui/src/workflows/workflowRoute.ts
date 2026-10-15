// The reader's edits to a workflow's route before it starts, and what they mean. A model change is a setting: the
// plan's prose does not name models, so the run can start with it, and the start sends it as `models`. Adding or
// removing a stage or a worker changes what the plan describes, so the agent must update the plan first: those
// changes go to it as a note through the proposal's changes route.
import type { SessionModel } from "../contracts";
import type { WorkflowStage } from "./workflowsModel";

export type Worker = NonNullable<WorkflowStage["workers"]>[number];

/**
 * The models a start or a launch sends, by worker name: `"provider/id[:level]"`, or null for the default: the agent file's model, else the session's.
 * The server refuses an unknown worker or a malformed model.
 */
export type ModelChoices = Record<string, string | null>;

/** `"provider/id:level"`, as a worker's model is written. */
export interface ModelSpec { provider: string; id: string; level?: string | undefined }

export function parseModel(spec: string | undefined): ModelSpec | undefined {
  const match = spec === undefined ? null : /^([^/\s]+)\/([^:\s]+)(?::(\S+))?$/u.exec(spec);
  return match?.[1] === undefined || match[2] === undefined ? undefined : { provider: match[1], id: match[2], level: match[3] };
}

export const modelText = (spec: ModelSpec) => `${spec.provider}/${spec.id}${spec.level === undefined ? "" : `:${spec.level}`}`;

/** The session's model a spec names, with its display name when the list knows it. */
export function modelOf(spec: string | undefined, known: readonly SessionModel[] = []): SessionModel | undefined {
  const parsed = parseModel(spec);
  if (parsed === undefined) return undefined;
  return known.find((model) => model.provider === parsed.provider && model.id === parsed.id) ?? { provider: parsed.provider, id: parsed.id };
}

/** "Claude Sonnet 5", or "its default model" for none: the agent file's, else the session's. */
export function modelName(spec: string | undefined, known: readonly SessionModel[] = []): string {
  const model = modelOf(spec, known);
  return model === undefined ? "its default model" : model.name ?? model.id ?? spec ?? "";
}

/** A stage with these workers; with none, the stage has no workers field. */
export function withWorkers(stage: WorkflowStage, workers: readonly Worker[]): WorkflowStage {
  const copy = { ...stage };
  if (workers.length === 0) delete copy.workers; else copy.workers = [...workers];
  return copy;
}

/** A worker on this model; without one, it runs on its agent file's model, else the session's. */
export function withModel(worker: Worker, model: string | undefined): Worker {
  const copy = { ...worker };
  if (model === undefined) delete copy.model; else copy.model = model;
  return copy;
}

/** The route with one worker on another model. */
export function setWorkerModel(stages: readonly WorkflowStage[], name: string, model: string | undefined): WorkflowStage[] {
  return stages.map((stage) => stage.workers?.some((worker) => worker.name === name) === true
    ? withWorkers(stage, (stage.workers ?? []).map((worker) => worker.name === name ? withModel(worker, model) : worker)) : stage);
}

export type RouteChange =
  | { kind: "model"; stage: string; worker: string; from: string | undefined; to: string | undefined }
  | { kind: "add-stage"; stage: string; name: string; after: string | undefined }
  | { kind: "remove-stage"; stage: string; name: string }
  | { kind: "add-worker"; stage: string; worker: string; agent: string | undefined }
  | { kind: "remove-worker"; stage: string; worker: string };

/** Every difference between the agent's route and the reader's, in route order. Removed stages come first. */
export function routeChanges(original: readonly WorkflowStage[], edited: readonly WorkflowStage[]): RouteChange[] {
  const changes: RouteChange[] = [];
  for (const stage of original) if (!edited.some((s) => s.id === stage.id)) changes.push({ kind: "remove-stage", stage: stage.id, name: stage.name });
  edited.forEach((stage, index) => {
    const before = original.find((s) => s.id === stage.id);
    if (before === undefined) { changes.push({ kind: "add-stage", stage: stage.id, name: stage.name, after: edited[index - 1]?.id }); return; }
    const was = before.workers ?? [];
    const now = stage.workers ?? [];
    for (const worker of was) if (!now.some((w) => w.name === worker.name)) changes.push({ kind: "remove-worker", stage: stage.id, worker: worker.name });
    for (const worker of now) {
      const old = was.find((w) => w.name === worker.name);
      if (old === undefined) changes.push({ kind: "add-worker", stage: stage.id, worker: worker.name, agent: worker.agent });
      else if (old.model !== worker.model) changes.push({ kind: "model", stage: stage.id, worker: worker.name, from: old.model, to: worker.model });
    }
  });
  return changes;
}

/** Changes the plan's prose must follow: every change but a model. */
export const reshapes = (changes: readonly RouteChange[]) => changes.filter((change) => change.kind !== "model");

/**
 * The models to start with: each worker whose model the reader changed, and nothing else. Undefined when no model
 * changed, so the start body stays as it was. A worker the reader added has no run yet and is not sent.
 */
export function modelChoices(changes: readonly RouteChange[]): ModelChoices | undefined {
  const models = changes.flatMap((change) => change.kind === "model" ? [[change.worker, change.to ?? null] as const] : []);
  return models.length === 0 ? undefined : Object.fromEntries(models);
}

/** One line per change, as the agent reads it in the note and the reader sees it above the plan. */
export function changeLine(change: RouteChange, stages: readonly WorkflowStage[], known: readonly SessionModel[] = []): string {
  const stageName = (id: string) => stages.find((stage) => stage.id === id)?.name ?? id;
  switch (change.kind) {
    case "model": return `\`${change.worker}\` in ${stageName(change.stage)} runs on ${modelName(change.to, known)}, not ${modelName(change.from, known)}.`;
    case "add-stage": return `New stage ${change.name}${change.after === undefined ? ", first" : `, after ${stageName(change.after)}`}.`;
    case "remove-stage": return `Removed stage ${change.name}.`;
    case "add-worker": return `New worker \`${change.worker}\` (${change.agent ?? "general helper"}) in ${stageName(change.stage)}.`;
    case "remove-worker": return `Removed worker \`${change.worker}\` from ${stageName(change.stage)}.`;
  }
}

/** The note that asks the agent to rewrite the plan: one line per change, model changes too, so the new proposal keeps them. */
export function changesNote(changes: readonly RouteChange[], stages: readonly WorkflowStage[], known: readonly SessionModel[] = []): string {
  return changes.length === 0 ? "" : ["Change the route:", ...changes.map((change) => `- ${changeLine(change, stages, known)}`)].join("\n");
}

/** A worker name that no stage uses yet: the agent's first word, then a number. */
export function freeWorkerName(stages: readonly WorkflowStage[], agent: string | undefined): string {
  const taken = new Set(stages.flatMap((stage) => (stage.workers ?? []).map((worker) => worker.name)));
  const base = agent?.split("-")[0] || "helper";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
}

/** A stage id, from its name, that no stage uses yet. */
export function freeStageId(stages: readonly WorkflowStage[], name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "stage";
  const taken = new Set(stages.map((stage) => stage.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
}

/** The route with a new stage after `after`, or first. */
export function addStage(stages: readonly WorkflowStage[], after: string | undefined, name: string): WorkflowStage[] {
  const stage: WorkflowStage = { id: freeStageId(stages, name), name };
  const at = after === undefined ? 0 : stages.findIndex((s) => s.id === after) + 1;
  return [...stages.slice(0, at), stage, ...stages.slice(at)];
}

/** The route with a new worker at the end of a stage. `agent` undefined is a general helper. */
export function addWorker(stages: readonly WorkflowStage[], stageId: string, agent: string | undefined): WorkflowStage[] {
  const name = freeWorkerName(stages, agent);
  return stages.map((stage) => stage.id === stageId ? withWorkers(stage, [...stage.workers ?? [], { name, ...(agent === undefined ? {} : { agent }) }]) : stage);
}

export function removeWorker(stages: readonly WorkflowStage[], stageId: string, name: string): WorkflowStage[] {
  return stages.map((stage) => stage.id === stageId ? withWorkers(stage, (stage.workers ?? []).filter((worker) => worker.name !== name)) : stage);
}

/** The route with one change taken back and the rest kept. */
export function undoChange(original: readonly WorkflowStage[], edited: readonly WorkflowStage[], change: RouteChange): WorkflowStage[] {
  switch (change.kind) {
    case "add-stage": return edited.filter((stage) => stage.id !== change.stage);
    case "remove-stage": {
      const stage = original.find((s) => s.id === change.stage);
      if (stage === undefined) return [...edited];
      // It goes back after the nearest earlier stage that is still there.
      const earlier = original.slice(0, original.indexOf(stage)).map((s) => s.id).reverse().find((id) => edited.some((s) => s.id === id));
      const at = earlier === undefined ? 0 : edited.findIndex((s) => s.id === earlier) + 1;
      return [...edited.slice(0, at), stage, ...edited.slice(at)];
    }
    case "add-worker": return removeWorker(edited, change.stage, change.worker);
    case "remove-worker": return edited.map((stage) => {
      if (stage.id !== change.stage) return stage;
      const was = original.find((s) => s.id === stage.id)?.workers ?? [];
      const worker = was.find((w) => w.name === change.worker);
      if (worker === undefined) return stage;
      const now = stage.workers ?? [];
      // The agent's order, with the reader's own additions after it.
      return withWorkers(stage, [...was.filter((w) => w === worker || now.some((n) => n.name === w.name)).map((w) => now.find((n) => n.name === w.name) ?? w),
        ...now.filter((n) => !was.some((w) => w.name === n.name))]);
    });
    case "model": return setWorkerModel(edited, change.worker, change.from);
  }
}
