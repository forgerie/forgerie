/**
 * The rules for a workflow's stops: the stages that name the user.
 *
 * Forgerie enforces only these. The agent decides how to run the stages between them, so the route it draws for
 * those stages can drift from what happened. A stop cannot be skipped: work that belongs after an unapproved stop
 * is refused, and a run cannot finish as completed while a stop is unapproved.
 *
 * Pure functions over plain records, shared by the server (enforcement) and the browser (drawing).
 */
import type { WorkflowRun, WorkflowStage, WorkflowStopState } from "./workflowRuns.js";

type StagedRun = Pick<WorkflowRun, "stages" | "stops"> & { children: readonly Pick<WorkflowRun["children"][number], "name" | "stage" | "state">[] };

export function stopOf(run: Pick<WorkflowRun, "stops">, stage: string): WorkflowStopState {
  return run.stops?.[stage] ?? { state: "open" };
}

/** The first stop the user has not approved. Nothing after it may start. */
export function heldAt(run: Pick<WorkflowRun, "stages" | "stops">): WorkflowStage | undefined {
  return (run.stages ?? []).find((stage) => stage.stop !== undefined && stopOf(run, stage.id).state !== "approved");
}

/** Problems in a declared route. Empty when the route is valid. */
export function routeProblems(stages: readonly WorkflowStage[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const workers = new Set<string>();
  stages.forEach((stage, index) => {
    if (ids.has(stage.id)) problems.push(`Stage id ${stage.id} is used twice`);
    ids.add(stage.id);
    if (stage.stop !== undefined && stage.workers !== undefined) problems.push(`Stop stage ${stage.id} cannot declare workers; the user is its actor`);
    if (stage.stop === "land" && index !== stages.length - 1) problems.push(`Land stage ${stage.id} must be the last stage`);
    for (const worker of stage.workers ?? []) {
      if (workers.has(worker.name)) problems.push(`Worker ${worker.name} is declared in two stages`);
      workers.add(worker.name);
    }
  });
  return problems;
}

/**
 * The stage a child request belongs to. A declared worker belongs to its own stage. Any other child belongs to the
 * last agent stage before the stop the run is held at, or to the last agent stage when every stop is approved.
 */
export function stageForChild(run: Pick<WorkflowRun, "stages" | "stops">, name: string): WorkflowStage | undefined {
  const stages = run.stages ?? [];
  const declared = stages.find((stage) => stage.workers?.some((worker) => worker.name === name) === true);
  if (declared !== undefined) return declared;
  const held = heldAt(run);
  const before = held === undefined ? stages : stages.slice(0, stages.indexOf(held));
  return before.filter((stage) => stage.stop === undefined).at(-1);
}

/** The worker a stage declares under this name, if any. Its model is the user's choice, so it wins over the agent's. */
export function declaredWorker(run: Pick<WorkflowRun, "stages">, name: string): NonNullable<WorkflowStage["workers"]>[number] | undefined {
  for (const stage of run.stages ?? []) {
    const worker = stage.workers?.find((candidate) => candidate.name === name);
    if (worker !== undefined) return worker;
  }
  return undefined;
}

export type ChildAdmission = { kind: "admitted"; stage?: string } | { kind: "refused"; reason: string };

/** Whether the agent may start or message a child now. Runs without stages admit everything, as before. */
export function admitChild(run: Pick<WorkflowRun, "stages" | "stops" | "definition">, name: string): ChildAdmission {
  const stages = run.stages ?? [];
  if (stages.length === 0) return { kind: "admitted" };
  const held = heldAt(run);
  const stage = stageForChild(run, name);
  if (held !== undefined && (stage === undefined || stages.indexOf(stage) > stages.indexOf(held))) {
    const waiting = stopOf(run, held.id).state === "waiting";
    return { kind: "refused", reason: `Workflow ${run.definition.name} is held at the stop "${held.name}". ${waiting
      ? "The user has not decided yet. Their decision arrives as a new message; do not start later work until then."
      : `Finish the work for this stop, then call workflow_stop with stage "${held.id}" and wait for the user.`}` };
  }
  return stage === undefined ? { kind: "admitted" } : { kind: "admitted", stage: stage.id };
}

/** Why the agent may not ask for this stop now, or undefined when it may. */
export function stopRequestProblem(run: StagedRun, stageId: string): string | undefined {
  const stages = run.stages ?? [];
  const stage = stages.find((candidate) => candidate.id === stageId);
  if (stage === undefined) return `This workflow has no stage "${stageId}"`;
  if (stage.stop === undefined) return `Stage "${stage.name}" is not a stop. Only stop stages wait for the user`;
  const state = stopOf(run, stage.id).state;
  if (state === "approved") return `The user already approved "${stage.name}"`;
  const held = heldAt(run);
  if (held !== undefined && held.id !== stage.id) return `Stop "${held.name}" comes first`;
  if (stage.stop === "land" && run.children.some((child) => child.state.kind === "working")) return "Wait for every child to finish before asking the user to land";
  return undefined;
}

/** Why a run cannot finish as completed, or undefined when it can. Failed and stopped runs may finish at any stop. */
export function completionProblem(run: Pick<WorkflowRun, "stages" | "stops">): string | undefined {
  const held = heldAt(run);
  return held === undefined ? undefined : `The user has not approved the stop "${held.name}". A completed run passes every stop; finish as failed or stopped instead`;
}

/**
 * A stage as a reader sees it now. Stops come from their recorded state. Agent stages are inferred from their
 * children, so they can drift: the furthest agent stage with children before the held stop is the one at work.
 */
export type StageView = "done" | "working" | "waiting" | "next";
export function stageViews(run: StagedRun): Record<string, StageView> {
  const stages = run.stages ?? [];
  const held = heldAt(run);
  const heldIndex = held === undefined ? stages.length : stages.indexOf(held);
  const heldWaiting = held !== undefined && stopOf(run, held.id).state === "waiting";
  const isAgent = (index: number) => stages[index]?.stop === undefined;
  const hasChildren = (index: number) => run.children.some((child) => child.stage === stages[index]?.id);
  let lastApproved = -1;
  for (let index = 0; index < heldIndex; index++) if (stages[index]?.stop !== undefined) lastApproved = index;
  // Only agent stages between the last approved stop and the held stop can be at work.
  let frontier = -1;
  for (let index = lastApproved + 1; index < heldIndex; index++) if (isAgent(index) && hasChildren(index)) frontier = index;
  if (frontier === -1) frontier = stages.findIndex((_stage, index) => index > lastApproved && index < heldIndex && isAgent(index));
  const views: Record<string, StageView> = {};
  stages.forEach((stage, index) => {
    if (stage.stop !== undefined) {
      const state = stopOf(run, stage.id).state;
      // An open held stop is at work only while no agent stage stands between it and the last approved stop.
      views[stage.id] = state === "approved" ? "done" : state === "waiting" ? "waiting" : index === heldIndex && frontier === -1 ? "working" : "next";
      return;
    }
    if (index > heldIndex) views[stage.id] = "next";
    else if (run.children.some((child) => child.stage === stage.id && child.state.kind === "working")) views[stage.id] = "working";
    else if (index < lastApproved) views[stage.id] = "done";
    else if (index < frontier) views[stage.id] = "done";
    else if (index === frontier) views[stage.id] = heldWaiting ? "done" : "working";
    else views[stage.id] = heldWaiting ? "done" : "next";
  });
  return views;
}
