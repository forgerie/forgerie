// A running (or finished) workflow as the run mode of the sheet shows it: where each stage stands, each worker's runs
// as tally blocks, and the line that says where each one is. Reads the run record and what the session knows of the
// run's children. The worker's live record comes from the child agents store when the reader opens it.
import type { BlockTone } from "../ui/BlockRun";
import { retryCount, retryWait } from "../childAgents/childAgentsModel";
import { deliveryNote, deliveryProblem, viewsOf, type ChildLook, type StopEntry, type WorkflowRun, type WorkflowStage } from "./workflowsModel";

/** Where a stage stands. `current` is at work; `waiting` waits on the reader. */
export type StageProgress = "done" | "current" | "waiting" | "next";

export interface LiveWorker {
  /** Unique in the run: "stage/name". */
  key: string;
  name: string;
  agent?: string | undefined;
  /** The model it runs on now, with the reader's override. Undefined: its agent file's model, else the session's. */
  model?: string | undefined;
  /** Declared in the route, so its model can change. A child the agent added is not. */
  declared: boolean;
  /** One block per run of this worker, oldest first. A declared worker that has not started is one hollow block. */
  tones: readonly BlockTone[];
  status: string;
  /** A turn is in progress: a model change applies from its next turn. */
  busy: boolean;
  started: boolean;
  /** The latest run's conversation, which opens its record. */
  conversationId?: number | undefined;
  /** Why its report did not reach the agent, though nothing failed. */
  note?: string | undefined;
  /** Why its report never reached the agent: a failure. */
  problem?: string | undefined;
  /** A model error Forgerie retries on its own. */
  retry?: ChildLook["retry"];
}

export interface LiveStage {
  stage: WorkflowStage;
  progress: StageProgress;
  /** One line under the stage's name, when it has no workers to list. */
  status?: string | undefined;
  workers: readonly LiveWorker[];
  /** A stop's own block: hollow until reached, solid live while it waits, ink once passed. */
  stopTone?: BlockTone | undefined;
}

const PROGRESS = { done: "done", working: "current", waiting: "waiting", next: "next" } as const;
type Child = WorkflowRun["children"][number];

function toneOf(child: Child, look: ChildLook | undefined): BlockTone {
  if (child.state.kind === "working") return look?.asking === true ? "needs" : "live";
  return child.state.outcome === "failed" ? "bad" : child.state.outcome === "stopped" ? "faint" : "plain";
}

const runs = (count: number) => count > 1 ? `, ${String(count)} runs` : "";

function workerStatus(mine: readonly Child[], look: ChildLook | undefined, progress: StageProgress, now: number): string {
  const last = mine.at(-1);
  if (last === undefined) return progress === "next" ? "Not started" : "Starts when the agent sends its task";
  const working = last.state.kind === "working";
  // A settled worker can take a follow-up message; the session's child says so before the run's record does.
  if (working || look?.busy === true || look?.asking === true) {
    if (look?.asking === true) return "Waiting for your answer";
    if (look?.retry !== undefined) return `${retryCount(look.retry)}. ${retryWait(look.retry, now)}`;
    if (!working) return "Working on a follow-up";
    return mine.length > 1 ? `Working, run ${String(mine.length)}` : "Working";
  }
  const outcome = last.state.kind === "settled" && last.state.outcome === "failed" ? "Failed"
    : last.state.kind === "settled" && last.state.outcome === "stopped" ? "Stopped" : "Done";
  return `${outcome}${runs(mine.length)}`;
}

/** The session's child for a worker's latest run: by its conversation when the session names it, else by the worker's name. */
function lookOf(looks: readonly ChildLook[], name: string, last: Child | undefined): ChildLook | undefined {
  return looks.find((look) => last !== undefined && look.conversationId === last.conversationId) ?? looks.find((look) => look.name === name);
}

/**
 * What a worker's runs say, with the session's child where it knows more: a settled worker that took a follow-up
 * message is busy again, so Stop reaches it, and its follow-up counts as one more block.
 */
function workerFacts(name: string, mine: readonly Child[], looks: readonly ChildLook[], progress: StageProgress, now: number, active: boolean) {
  const last = mine.at(-1);
  const current = lookOf(looks, name, last);
  // A child can keep working outside this run, or its live event can arrive after the final run record.
  const look = active || current === undefined ? current : { ...current, busy: false, asking: false, retry: undefined };
  const working = last?.state.kind === "working";
  const followUp = last !== undefined && !working && (look?.busy === true || look?.asking === true);
  const tones: BlockTone[] = mine.map((child) => toneOf(child, look));
  if (followUp) tones.push(look?.asking === true ? "needs" : "live");
  return {
    look, tones, status: workerStatus(mine, look, progress, now),
    busy: last === undefined ? false : look?.busy ?? working, started: mine.length > 0, conversationId: last?.conversationId,
    note: last?.state.kind === "settled" && !followUp ? deliveryNote(last.state) : undefined,
    problem: last?.state.kind === "settled" ? deliveryProblem(last.state) : undefined,
    retry: working || followUp ? look?.retry : undefined,
  };
}

function stopStatus(stage: WorkflowStage, run: WorkflowRun): string {
  const stop = run.stops?.[stage.id];
  if (run.state.kind === "finished" && stop?.state !== "approved") return "Not decided before the run ended";
  if (stop?.state === "waiting") return stage.stop === "land" ? "Waiting for you to land" : "Waiting for your approval";
  if (stop?.state === "approved") {
    if (stage.stop !== "land") return "Approved by you";
    const landed = stop.landed?.length ?? 0;
    return `Landed ${String(landed)} ${landed === 1 ? "branch" : "branches"}`;
  }
  return stage.stop === "land" ? "You land the branches" : "You approve";
}

/**
 * The run's route, live. Declared workers are listed even before they start; a child the agent added joins the stage
 * it ran in. `looks` is what the session's child agents say about each name.
 */
export function liveRoute(run: WorkflowRun, looks: readonly ChildLook[] = [], now = 0): LiveStage[] {
  const views = viewsOf(run);
  return (run.stages ?? []).map((stage) => {
    const progress: StageProgress = PROGRESS[views[stage.id] ?? "next"];
    const records = run.children.filter((child) => child.stage === stage.id);
    const names = [...(stage.workers ?? []).map((worker) => worker.name), ...records.map((child) => child.name)]
      .filter((name, index, all) => all.indexOf(name) === index);
    const workers = names.map((name): LiveWorker => {
      const declared = stage.workers?.find((worker) => worker.name === name);
      const { look, tones, ...facts } = workerFacts(name, records.filter((child) => child.name === name), looks, progress, now, run.state.kind !== "finished");
      return { key: `${stage.id}/${name}`, name, agent: declared?.agent ?? look?.agent ?? undefined, model: declared?.model, declared: declared !== undefined,
        tones: tones.length === 0 ? ["faint"] : tones, ...facts };
    });
    const stopTone: BlockTone | undefined = stage.stop === undefined ? undefined : progress === "waiting" ? "needs" : progress === "done" ? "plain" : "faint";
    const status = stage.stop !== undefined ? stopStatus(stage, run) : workers.length === 0 ? stage.does : undefined;
    return { stage, progress, status, workers, stopTone };
  });
}

/**
 * Workers of a run without stages: every child the agent started, in one list. Such a run declares no workers, so
 * none of them can change model.
 */
export function proseWorkers(run: WorkflowRun, looks: readonly ChildLook[] = [], now = 0): LiveWorker[] {
  const names = run.children.map((child) => child.name).filter((name, index, all) => all.indexOf(name) === index);
  return names.map((name) => {
    const { look, ...facts } = workerFacts(name, run.children.filter((child) => child.name === name), looks, "current", now, run.state.kind !== "finished");
    return { key: `/${name}`, name, agent: look?.agent ?? undefined, declared: false, ...facts };
  });
}

/** The stop that waits on the reader now, as the card the chat shows for it. */
export function waitingStop(run: WorkflowRun): StopEntry | undefined {
  if (run.state.kind !== "running") return undefined;
  const stage = (run.stages ?? []).find((candidate) => candidate.stop !== undefined && run.stops?.[candidate.id]?.state === "waiting");
  const stop = stage === undefined ? undefined : run.stops?.[stage.id];
  if (stage?.stop === undefined || stop === undefined) return undefined;
  return { kind: "stop", runId: run.id, stage: stage.id, stageName: stage.name, stop: stage.stop, summary: stop.summary ?? "",
    workflow: run.definition.name, round: stop.round ?? 0 };
}

/** "58 min", "2 h 5 min": a span of time in whole minutes. */
function span(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${String(minutes)} min`;
  const rest = minutes % 60;
  return `${String(Math.floor(minutes / 60))} h${rest === 0 ? "" : ` ${String(rest)} min`}`;
}

/** "Ran for 58 min": how long a finished run took. */
export const ranFor = (startedAt: number, finishedAt: number) => `Ran for ${span(finishedAt - startedAt)}`;

/** "Started 23 min ago", "Started 2 h 5 min ago". */
export function startedAgo(startedAt: number, now: number): string {
  return now - startedAt < 60_000 ? "Started just now" : `Started ${span(now - startedAt)} ago`;
}

/** What a model change does to this worker, said where the reader makes it. */
export function modelTiming(worker: Pick<LiveWorker, "busy" | "started">): string {
  if (worker.busy) return "From its next turn. The turn in progress finishes on its current model.";
  return worker.started ? "From its next turn." : "It starts on this model.";
}
