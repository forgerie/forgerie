// Mockup only. The reader's edits to a proposed route, and what they mean
// for the plan. A model change is a setting: the plan's prose does not name
// models, so the run can start with it. Adding or removing a stage or a
// worker changes what the plan describes, so the agent must update the plan
// before the run starts.
import type { SessionModel } from "../../contracts";
import type { WorkflowStage } from "../workflowsModel";

export type Worker = NonNullable<WorkflowStage["workers"]>[number];

/** The agents a worker can run as. The same list the child-agent tool offers. */
export const AGENTS = ["scout", "researcher", "reviewer", "full-stack-engineer", "design-engineer", "worker", "delegate", "sweeper", "evidence-auditor",
  "creative-director", "creative-technologist"] as const;

/** Models the picker offers in the mockup. A build reads Pi's list. */
export const MODELS: SessionModel[] = [
  { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5", reasoning: true },
  { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true },
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: true },
  { provider: "openai", id: "gpt-5", name: "GPT-5", reasoning: true },
  { provider: "openai", id: "gpt-5-mini", name: "GPT-5 mini", reasoning: true },
  { provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", reasoning: true },
];

/** "provider/id:level", as the child-agent tool takes it. */
export interface ModelSpec { provider: string; id: string; level?: string | undefined }
export function parseModel(spec: string | undefined): ModelSpec | undefined {
  const match = spec === undefined ? null : /^([^/\s]+)\/([^:\s]+)(?::(\S+))?$/u.exec(spec);
  return match?.[1] === undefined || match[2] === undefined ? undefined : { provider: match[1], id: match[2], level: match[3] };
}
export const modelText = (spec: ModelSpec) => `${spec.provider}/${spec.id}${spec.level === undefined ? "" : `:${spec.level}`}`;
export function sessionModelOf(spec: string | undefined): SessionModel | undefined {
  const parsed = parseModel(spec);
  if (parsed === undefined) return undefined;
  return MODELS.find((model) => model.provider === parsed.provider && model.id === parsed.id) ?? { provider: parsed.provider, id: parsed.id };
}
export const modelName = (spec: string | undefined) => { const model = sessionModelOf(spec); return model === undefined ? "the session's model" : model.name ?? model.id ?? ""; };

/** A stage with these workers; with none, the stage has no workers field. */
export function withWorkers(stage: WorkflowStage, workers: readonly Worker[]): WorkflowStage {
  const copy = { ...stage };
  if (workers.length === 0) delete copy.workers; else copy.workers = [...workers];
  return copy;
}
/** A worker on this model; without one, it runs on the session's model. */
export function withModel(worker: Worker, model: string | undefined): Worker {
  const copy = { ...worker };
  if (model === undefined) delete copy.model; else copy.model = model;
  return copy;
}

export type RouteChange =
  | { kind: "model"; stage: string; worker: string; from: string | undefined; to: string | undefined }
  | { kind: "add-stage"; stage: string; name: string; after: string | undefined }
  | { kind: "remove-stage"; stage: string; name: string }
  | { kind: "add-worker"; stage: string; worker: string; agent: string | undefined }
  | { kind: "remove-worker"; stage: string; worker: string };

/** Every difference between the agent's route and the reader's, in route order. */
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

/** Changes the plan's prose must follow. Model changes are not among them. */
export const reshapes = (changes: readonly RouteChange[]) => changes.filter((change) => change.kind !== "model");

/** One line per change, as the note the agent receives and the reader sees. */
export function changeLine(change: RouteChange, stages: readonly WorkflowStage[]): string {
  const stageName = (id: string) => stages.find((stage) => stage.id === id)?.name ?? id;
  switch (change.kind) {
    case "model": return `\`${change.worker}\` in ${stageName(change.stage)} runs on ${modelName(change.to)}, not ${modelName(change.from)}.`;
    case "add-stage": return `New stage ${change.name}${change.after === undefined ? ", first" : `, after ${stageName(change.after)}`}.`;
    case "remove-stage": return `Removed stage ${change.name}.`;
    case "add-worker": return `New worker \`${change.worker}\` (${change.agent ?? "general helper"}) in ${stageName(change.stage)}.`;
    case "remove-worker": return `Removed worker \`${change.worker}\` from ${stageName(change.stage)}.`;
  }
}

/** A worker name that no stage uses yet: the agent's name, then a number. */
export function freeWorkerName(stages: readonly WorkflowStage[], agent: string): string {
  const taken = new Set(stages.flatMap((stage) => (stage.workers ?? []).map((worker) => worker.name)));
  const base = agent.split("-")[0] ?? agent;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
}

/** A stage id from its name that no stage uses yet. */
export function freeStageId(stages: readonly WorkflowStage[], name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "stage";
  const taken = new Set(stages.map((stage) => stage.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}-${String(n)}`)) return `${base}-${String(n)}`;
}

/** The route with one change taken back, the rest kept. */
export function undoChange(original: readonly WorkflowStage[], edited: readonly WorkflowStage[], change: RouteChange): WorkflowStage[] {
  switch (change.kind) {
    case "add-stage": return edited.filter((stage) => stage.id !== change.stage);
    case "remove-stage": {
      const stage = original.find((s) => s.id === change.stage);
      if (stage === undefined) return [...edited];
      // Back after the nearest earlier stage that is still there.
      const earlier = original.slice(0, original.indexOf(stage)).map((s) => s.id).reverse().find((id) => edited.some((s) => s.id === id));
      const at = earlier === undefined ? 0 : edited.findIndex((s) => s.id === earlier) + 1;
      return [...edited.slice(0, at), stage, ...edited.slice(at)];
    }
    case "add-worker": return edited.map((stage) => stage.id !== change.stage ? stage : withWorkers(stage, (stage.workers ?? []).filter((w) => w.name !== change.worker)));
    case "remove-worker": return edited.map((stage) => {
      if (stage.id !== change.stage) return stage;
      const was = original.find((s) => s.id === stage.id)?.workers ?? [];
      const worker = was.find((w) => w.name === change.worker);
      if (worker === undefined) return stage;
      const now = stage.workers ?? [];
      return withWorkers(stage, was.filter((w) => w === worker || now.some((n) => n.name === w.name)).map((w) => now.find((n) => n.name === w.name) ?? w)
        .concat(now.filter((n) => !was.some((w) => w.name === n.name))));
    });
    case "model": return edited.map((stage) => stage.id !== change.stage ? stage
      : withWorkers(stage, (stage.workers ?? []).map((w) => w.name === change.worker ? withModel(w, change.from) : w)));
  }
}
