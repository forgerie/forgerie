// Saved workflows and their runs. The server side is src/server/sessions/durableWorkflowRuns.ts;
// the routes are src/server/sessions/workflowRoutes.ts; the stop rules are src/shared/workflowStops.ts.
import { z } from "zod";
import { stageViews, type StageView } from "@shared/workflowStops";
import { textOf, type PiMessage } from "../contracts";
import type { RouteState, RouteStep, RouteTrack } from "../ui/RouteMap";
import type { StageStripSegment } from "../ui/StageStrip";

const valueSchema = z.union([z.string(), z.boolean(), z.number()]);
const workerSchema = z.object({ name: z.string(), agent: z.string().optional(), model: z.string().optional() });
const stageSchema = z.object({
  id: z.string(), name: z.string(), does: z.string().optional(),
  stop: z.enum(["approve", "land"]).optional(), workers: z.array(workerSchema).optional(),
});
const inputSchema = z.object({ type: z.enum(["string", "boolean", "number"]), description: z.string().optional(),
  choices: z.array(valueSchema).optional(), default: valueSchema.optional() });
const stopStateSchema = z.object({
  state: z.enum(["open", "waiting", "approved"]), summary: z.string().optional(), note: z.string().optional(),
  requestedAt: z.number().optional(), decidedAt: z.number().optional(), landed: z.array(z.string()).optional(), round: z.number().optional(),
});
export const workflowRunSchema = z.object({
  id: z.string(), requestId: z.string(), startedAt: z.number(),
  definition: z.object({ name: z.string(), path: z.string(), sha256: z.string(), text: z.string() }),
  inputs: z.record(z.string(), valueSchema),
  state: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("running") }),
    z.object({ kind: z.literal("finished"), outcome: z.enum(["completed", "failed", "stopped"]), result: z.string(), finishedAt: z.number() }),
  ]),
  stages: z.array(stageSchema).optional(),
  stops: z.record(z.string(), stopStateSchema).optional(),
  children: z.array(z.object({
    conversationId: z.number(), reporterId: z.number(), name: z.string(), stage: z.string().optional(),
    state: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("working") }),
      z.object({ kind: z.literal("settled"), outcome: z.enum(["answered", "failed", "stopped"]), result: z.string(), delivered: z.boolean(), deliveryError: z.string().optional() }),
    ]),
  })),
});
export const workflowRunsSchema = z.array(workflowRunSchema);
export const workflowInventorySchema = z.object({
  workflows: z.array(z.object({ name: z.string(), path: z.string(), sha256: z.string(), description: z.string().optional(),
    definition: z.object({ version: z.literal(1), inputs: z.record(z.string(), inputSchema).optional(), stages: z.array(stageSchema).optional() }) })),
  diagnostics: z.array(z.object({ name: z.string(), path: z.string(), error: z.string() })),
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowStage = z.infer<typeof stageSchema>;
export type WorkflowInput = z.infer<typeof inputSchema>;
export type SavedWorkflow = z.infer<typeof workflowInventorySchema>["workflows"][number];
export type WorkflowInputs = Record<string, string | boolean | number>;
export type StopDecision = "approve" | "changes" | "land";

/** The server's event when any workflow record of this session changes. */
export const WORKFLOW_RUNS_CHANGED_EVENT = "workflow_runs_changed";
/** The transcript entry the server writes when the agent asks the user to decide at a stop. */
export const WORKFLOW_STOP_TYPE = "forgerie.workflow-stop";

/** Something a workflow did, as the parent's transcript records it. */
export type WorkflowEntry =
  | { kind: "started"; runId: string; text: string }
  | { kind: "stop"; runId: string; stage: string; stageName: string; stop: "approve" | "land"; summary: string; workflow: string; round: number }
  | { kind: "decided"; workflow: string; text: string };
export type StopEntry = Extract<WorkflowEntry, { kind: "stop" }>;

const str = (record: Record<string, unknown>, key: string) => typeof record[key] === "string" ? record[key] : "";
const recordOf = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
const STARTED = /^Workflow run ([a-f0-9]{64})\n\n([\s\S]*)$/u;
const DECIDED = /^\[workflow ([a-z0-9][a-z0-9-]*)\] ([\s\S]*)$/u;

/** A workflow's row in the transcript, or undefined for any other message. */
export function workflowEntryOf(message: PiMessage): WorkflowEntry | undefined {
  if (message.role === "user") {
    const text = textOf(message);
    const started = STARTED.exec(text);
    if (started) return { kind: "started", runId: started[1]!, text: started[2]! };
    const decided = DECIDED.exec(text);
    // The second line tells the agent what to do next; the reader needs only the first.
    if (decided) return { kind: "decided", workflow: decided[1]!, text: decided[2]!.split("\n")[0]!.trim() };
    return undefined;
  }
  if (message.role !== "custom" || message.customType !== WORKFLOW_STOP_TYPE) return undefined;
  const details = recordOf(message.details);
  const stop = str(details, "stop") === "land" ? "land" : "approve";
  return { kind: "stop", runId: str(details, "runId"), stage: str(details, "stage"), stageName: str(details, "stageName"), stop,
    summary: str(details, "summary"), workflow: str(details, "workflow"), round: typeof details["round"] === "number" ? details["round"] : 0 };
}

/** The run a session has running now: the newest unfinished one. */
export function activeRun(runs: readonly WorkflowRun[]): WorkflowRun | undefined {
  return runs.find((run) => run.state.kind === "running");
}

/** How each stage reads now. A finished run reads as done when it completed, and keeps its stops otherwise. */
export function viewsOf(run: WorkflowRun): Record<string, StageView> {
  const views = stageViews(run);
  if (run.state.kind === "running") return views;
  const completed = run.state.outcome === "completed";
  return Object.fromEntries(Object.entries(views).map(([id, view]) => [id, completed ? "done" : view === "working" ? "next" : view]));
}

/** Whether a stop card is the one the run is waiting on now. An older round of the same stop is closed. */
export function stopIsOpen(run: WorkflowRun | undefined, entry: StopEntry): boolean {
  const stop = run?.stops?.[entry.stage];
  return run?.state.kind === "running" && stop?.state === "waiting" && (stop.round ?? 0) === entry.round;
}

/**
 * What became of a stop card once the user decided, for its closed state. A decision raises the stop's round by one,
 * so the card of round r reads the decision of round r + 1. A note from an older round is not kept.
 */
export function stopOutcome(run: WorkflowRun | undefined, entry: StopEntry): string {
  if (run === undefined) return "This run is no longer in the session's records.";
  const stop = run.stops?.[entry.stage];
  const round = stop?.round ?? 0;
  if (stop !== undefined && round === entry.round + 1 && stop.state === "approved") {
    if (entry.stop === "approve") return `Approved by you${stop.note === undefined ? "." : `: ${stop.note}`}`;
    return stop.landed === undefined || stop.landed.length === 0 ? "Landed. No branch had commits." : `Landed ${stop.landed.join(", ")}.`;
  }
  if (stop !== undefined && round === entry.round + 1 && stop.state === "open" && stop.note !== undefined) return `You asked for changes: ${stop.note}`;
  if (round > entry.round) return "You asked for changes.";
  return run.state.kind === "finished" ? "The workflow ended before you decided." : "Closed.";
}

/** One line of status for the strip above the composer. */
export function runStatus(run: WorkflowRun): string {
  if (run.state.kind === "finished") return run.state.outcome === "completed" ? "Finished" : run.state.outcome === "failed" ? "Failed" : "Stopped";
  const stages = run.stages ?? [];
  const views = viewsOf(run);
  const waiting = stages.find((stage) => views[stage.id] === "waiting");
  if (waiting) return `${waiting.name}, waiting for you`;
  const working = stages.filter((stage) => views[stage.id] === "working");
  if (working.length === 0) return stages.length === 0 ? "Running" : "Working";
  const busy = run.children.filter((child) => child.state.kind === "working" && working.some((stage) => stage.id === child.stage)).length;
  return `${working.map((stage) => stage.name).join(", ")}${busy > 0 ? `, ${String(busy)} working` : ""}`;
}

/** Inputs a launch needs, from the workflow's declared defaults and what the reader typed. */
export function launchInputs(workflow: SavedWorkflow, typed: Readonly<Record<string, string>>): { inputs: WorkflowInputs } | { problem: string } {
  const inputs: WorkflowInputs = {};
  for (const [name, input] of Object.entries(workflow.definition.inputs ?? {})) {
    const raw = typed[name];
    if (raw === undefined || raw.trim() === "") {
      if (input.default === undefined) return { problem: `Fill in ${name}.` };
      continue;
    }
    const value = input.type === "boolean" ? raw === "true" : input.type === "number" ? Number(raw) : raw;
    if (typeof value === "number" && !Number.isFinite(value)) return { problem: `${name} must be a number.` };
    inputs[name] = value;
  }
  return { inputs };
}

/** What a run's children look like to the route: their branch and whether they wait on the reader. */
export interface ChildLook { name: string; agent: string | null; branch?: string | undefined; asking: boolean }

/**
 * The route as RouteMap steps. Declared workers are tracks even before they start; children the agent added are
 * tracks of the stage they joined. `open` makes a started worker's track open that child.
 */
export function routeSteps(stages: readonly WorkflowStage[], run: WorkflowRun | undefined, children: readonly ChildLook[] = [],
  open?: (name: string) => void): RouteStep[] {
  const views = run === undefined ? undefined : viewsOf(run);
  return stages.map((stage) => {
    const state: RouteState = views?.[stage.id] ?? "next";
    const stop = run?.stops?.[stage.id];
    const word = stage.stop === undefined || stop?.state !== "approved" ? undefined
      : stage.stop === "land" ? `Landed ${String(stop.landed?.length ?? 0)} ${stop.landed?.length === 1 ? "branch" : "branches"}` : "Approved by you";
    const records = run?.children.filter((child) => child.stage === stage.id) ?? [];
    const names = [...(stage.workers ?? []).map((worker) => worker.name), ...records.map((child) => child.name)].filter((name, index, all) => all.indexOf(name) === index);
    const tracks: RouteTrack[] = names.map((name) => {
      const declared = stage.workers?.find((worker) => worker.name === name);
      const mine = records.filter((child) => child.name === name);
      const look = children.find((child) => child.name === name);
      const trackState: RouteState = look?.asking === true ? "waiting" : mine.some((child) => child.state.kind === "working") ? "working"
        : mine.length > 0 ? "done" : "next";
      const lines = [declared?.agent ?? look?.agent ?? (mine.length > 0 ? "general helper" : undefined), declared?.model, look?.branch].filter((line) => line !== undefined);
      return { key: name, name, state: trackState, lines, ...(mine.length > 0 && open !== undefined ? { label: `Open ${name}`, onPress: () => open(name) } : {}) };
    });
    return { key: stage.id, name: stage.name, state, ...(stage.stop === undefined ? {} : { mine: true }), ...(word === undefined ? {} : { word }),
      ...(stage.does === undefined ? {} : { does: stage.does }), ...(tracks.length === 0 ? {} : { tracks }) };
  });
}

/** The route as StageStrip segments: one bar per stage, one lane per worker of a stage with several. */
export function stripSegments(run: WorkflowRun): StageStripSegment[] {
  const views = viewsOf(run);
  return (run.stages ?? []).map((stage) => {
    const view = views[stage.id] ?? "next";
    const workers = stage.workers ?? [];
    if (workers.length < 2) return { key: stage.id, lanes: [view] };
    return { key: stage.id, lanes: workers.map((worker) => {
      const mine = run.children.filter((child) => child.name === worker.name);
      return mine.some((child) => child.state.kind === "working") ? "working" : mine.length > 0 || view === "done" ? "done" : view === "working" ? "next" : view;
    }) };
  });
}

/** How many stops wait on the reader in this run. */
export function waitingStops(run: WorkflowRun | undefined): number {
  return run?.state.kind === "running" ? Object.values(run.stops ?? {}).filter((stop) => stop.state === "waiting").length : 0;
}
