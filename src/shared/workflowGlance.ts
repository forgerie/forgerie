import type { WorkflowRun } from "./workflowRuns.js";
import { stageViews, type StageView } from "./workflowStops.js";

/** done: finished. working: at work now. waiting: waits on the reader. failed: its worker failed. next: not reached. */
export type StageStripState = "done" | "working" | "waiting" | "failed" | "next";
/** One stage as a bar. A stage with several lanes, such as parallel workers, is stacked bars. */
export interface StageStripSegment { key: string; lanes: readonly StageStripState[] }

export interface WorkflowGlance {
  name: string;
  stages: StageStripState[];
  stage: string;
  waiting: number;
}

type StripRun = Pick<WorkflowRun, "stages" | "stops" | "children" | "state">;

/** Worst first: what a block shows when it stands for several lanes. */
const SEVERITY: readonly StageStripState[] = ["failed", "waiting", "working", "next", "done"];
/** The worst state among `states`; `done` when there are none. */
export function worstState(states: readonly StageStripState[]): StageStripState {
  return SEVERITY.find((state) => states.includes(state)) ?? "done";
}

/** How each stage reads now. A finished run reads as done when it completed, and keeps its stops otherwise. */
export function viewsOf(run: StripRun): Record<string, StageView> {
  const views = stageViews(run);
  if (run.state.kind !== "finished") return views;
  const completed = run.state.outcome === "completed";
  return Object.fromEntries(Object.entries(views).map(([id, view]) => [id, completed ? "done" : view === "working" || view === "waiting" ? "next" : view]));
}

/** The route as StageStrip segments: one bar per stage, one lane per worker of a stage with several. */
export function stripSegments(run: StripRun): StageStripSegment[] {
  const views = viewsOf(run);
  return (run.stages ?? []).map((stage) => {
    const view = views[stage.id] ?? "next";
    const workers = stage.workers ?? [];
    if (workers.length < 2) {
      const latest = run.children.filter((child) => child.stage === stage.id).at(-1);
      const failed = view !== "working" && latest?.state.kind === "settled" && latest.state.outcome === "failed";
      return { key: stage.id, lanes: [failed ? "failed" : view] };
    }
    return { key: stage.id, lanes: workers.map((worker) => {
      const latest = run.children.filter((child) => child.name === worker.name).at(-1);
      if (latest?.state.kind === "working") return "working";
      if (latest?.state.kind === "settled") return latest.state.outcome === "failed" ? "failed" : "done";
      return view === "done" ? "done" : view === "working" ? "next" : view;
    }) };
  });
}

/** How many stops wait on the reader in this run. */
export function waitingStops(run: Pick<WorkflowRun, "state" | "stops" | "stall"> | undefined): number {
  if (run?.state.kind !== "running") return 0;
  return Object.values(run.stops ?? {}).filter((stop) => stop.state === "waiting").length + (run.stall?.state === "flagged" ? 1 : 0);
}

/** The active workflow's route and user waits, shared by session status and the inbox. */
export function workflowGlance(run: WorkflowRun): WorkflowGlance | undefined {
  if (run.state.kind !== "running") return undefined;
  const stages = run.stages ?? [];
  const views = stageViews(run);
  const waiting = stages.find((stage) => views[stage.id] === "waiting");
  const stalledChild = run.stall?.state === "flagged" ? run.children.filter((child) => child.name === run.stall?.child).at(-1) : undefined;
  const current = waiting ?? (run.stall?.state === "flagged"
    ? stages.find((stage) => stage.id === stalledChild?.stage)
    : stages.find((stage) => views[stage.id] === "working"));
  return { name: run.definition.name, stages: stripSegments(run).map((segment) => worstState(segment.lanes)),
    stage: current?.name ?? "", waiting: waitingStops(run) };
}
