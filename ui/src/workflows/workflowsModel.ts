// Saved workflows and their runs. The server side is src/server/sessions/durableWorkflowRuns.ts;
// the routes are src/server/sessions/workflowRoutes.ts; the stop rules are src/shared/workflowStops.ts.
import { z } from "zod";
import { stageViews, type StageView } from "@shared/workflowStops";
import { textOf, type PiMessage } from "../contracts";
import type { StageStripSegment } from "../ui/StageStrip";
import type { ChildRetry } from "../childAgents/childAgentsModel";

const valueSchema = z.union([z.string(), z.boolean(), z.number()]);
/** A declared worker. Without a model it runs on its agent file's model, else the session's. */
interface DeclaredWorker { name: string; agent?: string | undefined; model?: string }
/**
 * The server writes `model: null` for a worker the reader put back on its default model, at start or during a run. The
 * browser has one form for that: no model.
 */
const workerSchema = z.object({ name: z.string(), agent: z.string().optional(), model: z.string().nullable().optional() })
  .transform(({ model, ...worker }): DeclaredWorker => model === null || model === undefined ? worker : { ...worker, model });
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
/**
 * Whether the child's report reached the parent (src/shared/workflowRuns.ts, WorkflowChildDeliverySchema).
 * `duplicate`: the parent already had this answer, so it was not sent again. `aborted`: the child was stopped before
 * it reported. Neither is a failure. `false` with a `deliveryError` is one: the reporter failed, and says why.
 */
export const deliveredSchema = z.union([z.boolean(), z.literal("duplicate"), z.literal("aborted")]);
export const workflowRunSchema = z.object({
  id: z.string(), requestId: z.string(), startedAt: z.number(),
  definition: z.object({ name: z.string(), path: z.string(), sha256: z.string(), text: z.string() }),
  inputs: z.record(z.string(), valueSchema),
  state: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("running") }),
    z.object({ kind: z.literal("stopping") }),
    z.object({ kind: z.literal("finished"), outcome: z.enum(["completed", "failed", "stopped"]), result: z.string(), finishedAt: z.number() }),
  ]),
  stages: z.array(stageSchema).optional(),
  stops: z.record(z.string(), stopStateSchema).optional(),
  children: z.array(z.object({
    conversationId: z.number(), reporterId: z.number(), name: z.string(), stage: z.string().optional(),
    state: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("working") }),
      z.object({ kind: z.literal("settled"), outcome: z.enum(["answered", "failed", "stopped"]), result: z.string(), delivered: deliveredSchema,
        deliveryError: z.string().optional() }),
    ]),
  })),
});
export const workflowRunsSchema = z.array(workflowRunSchema);
const definitionSchema = z.object({ version: z.literal(1), inputs: z.record(z.string(), inputSchema).optional(), stages: z.array(stageSchema).optional() });
export const workflowInventorySchema = z.object({
  workflows: z.array(z.object({ name: z.string(), path: z.string(), sha256: z.string(), description: z.string().optional(), definition: definitionSchema,
    /** The whole file, and its prose without the frontmatter. */
    text: z.string().optional(), body: z.string().optional() })),
  diagnostics: z.array(z.object({ name: z.string(), path: z.string(), error: z.string() })),
});
/** Where a proposal comes from: a saved workflow it adapts, with what changed, or a new plan, with why none fit. */
const basisSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), name: z.string(), changes: z.string() }),
  z.object({ kind: z.literal("new"), reason: z.string() }),
]);
export type ProposalBasis = z.infer<typeof basisSchema>;
/** A workflow the agent wrote for the current task. It lives in the session's records, never in the repository. */
export const workflowProposalSchema = z.object({
  id: z.string(), name: z.string(), summary: z.string(), text: z.string(), sha256: z.string(), createdAt: z.number(),
  definition: definitionSchema,
  /** The agent's pre-filled values. */
  inputs: z.record(z.string(), valueSchema),
  state: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("open") }),
    z.object({ kind: z.literal("started"), runId: z.string(), decidedAt: z.number() }),
    z.object({ kind: z.literal("changes"), note: z.string(), decidedAt: z.number() }),
    z.object({ kind: z.literal("dismissed"), decidedAt: z.number() }),
    z.object({ kind: z.literal("replaced"), by: z.string(), decidedAt: z.number() }),
    z.object({ kind: z.literal("here"), decidedAt: z.number() }),
  ]),
  /** Absent on proposals made before the agent had to consider saved workflows. */
  basis: basisSchema.optional(),
});
/** Newest first, as the server lists them. */
export const workflowProposalsSchema = z.array(workflowProposalSchema);
export type WorkflowRun = z.infer<typeof workflowRunSchema>;
export type WorkflowStage = z.infer<typeof stageSchema>;
export type WorkflowInput = z.infer<typeof inputSchema>;
export type SavedWorkflow = z.infer<typeof workflowInventorySchema>["workflows"][number];
export type WorkflowProposal = z.infer<typeof workflowProposalSchema>;
export type WorkflowInputs = Record<string, string | boolean | number>;
export type StopDecision = "approve" | "changes" | "land";
/** What the reader can do with an open proposal. */
export type ProposalAction = "start" | "changes" | "dismiss" | "here";

/** The server's event when any workflow record of this session changes. */
export const WORKFLOW_RUNS_CHANGED_EVENT = "workflow_runs_changed";
/** The transcript entry the server writes when the agent asks the user to decide at a stop. */
export const WORKFLOW_STOP_TYPE = "forgerie.workflow-stop";
/** The transcript entry the server writes when the agent proposes a workflow for the current task. */
export const WORKFLOW_PROPOSAL_TYPE = "forgerie.workflow-proposal";

/** Something a workflow did, as the parent's transcript records it. */
export type WorkflowEntry =
  | { kind: "started"; runId: string; text: string }
  | { kind: "stop"; runId: string; stage: string; stageName: string; stop: "approve" | "land"; summary: string; workflow: string; round: number }
  | { kind: "decided"; workflow: string; text: string }
  | { kind: "proposal"; proposalId: string; name: string; summary: string; stages: WorkflowStage[]; basis?: ProposalBasis | undefined };
export type StopEntry = Extract<WorkflowEntry, { kind: "stop" }>;
export type ProposalEntry = Extract<WorkflowEntry, { kind: "proposal" }>;
const proposalDetailsSchema = z.object({ proposalId: z.string().min(1), name: z.string(), summary: z.string().catch(""), stages: z.array(stageSchema).catch([]),
  basis: basisSchema.optional().catch(undefined) });

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
  if (message.role === "custom" && message.customType === WORKFLOW_PROPOSAL_TYPE) {
    const details = proposalDetailsSchema.safeParse(message.details);
    return details.success ? { kind: "proposal", ...details.data } : undefined;
  }
  if (message.role !== "custom" || message.customType !== WORKFLOW_STOP_TYPE) return undefined;
  const details = recordOf(message.details);
  const stop = str(details, "stop") === "land" ? "land" : "approve";
  return { kind: "stop", runId: str(details, "runId"), stage: str(details, "stage"), stageName: str(details, "stageName"), stop,
    summary: str(details, "summary"), workflow: str(details, "workflow"), round: typeof details["round"] === "number" ? details["round"] : 0 };
}

/** The run a session has running now: the newest unfinished one. */
export function activeRun(runs: readonly WorkflowRun[]): WorkflowRun | undefined {
  return runs.find((run) => run.state.kind !== "finished");
}

/** How each stage reads now. A finished run reads as done when it completed, and keeps its stops otherwise. */
export function viewsOf(run: WorkflowRun): Record<string, StageView> {
  const views = stageViews(run);
  if (run.state.kind !== "finished") return views;
  const completed = run.state.outcome === "completed";
  return Object.fromEntries(Object.entries(views).map(([id, view]) => [id, completed ? "done" : view === "working" || view === "waiting" ? "next" : view]));
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
  if (run.state.kind === "stopping") return "Stopping…";
  const stages = run.stages ?? [];
  const views = viewsOf(run);
  const waiting = stages.find((stage) => views[stage.id] === "waiting");
  if (waiting) return `${waiting.name}, waiting for you`;
  const working = stages.filter((stage) => views[stage.id] === "working");
  if (working.length === 0) return stages.length === 0 ? "Running" : "Working";
  const busy = run.children.filter((child) => child.state.kind === "working" && working.some((stage) => stage.id === child.stage)).length;
  return `${working.map((stage) => stage.name).join(", ")}${busy > 0 ? `, ${String(busy)} working` : ""}`;
}

/** Declared inputs are all a launch reads, so a trigger's workflow, which has no file around it, fits too. */
export interface DeclaresInputs { definition: { inputs?: Readonly<Record<string, WorkflowInput>> | undefined; readonly [field: string]: unknown } }

function coerceLaunchInput(name: string, input: WorkflowInput, raw: string): { value: WorkflowInputs[string] } | { problem: string } {
  if (input.type === "number") {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value)) return { problem: `${name} must be a number.` };
    return { value };
  }
  return { value: input.type === "boolean" ? raw === "true" : raw };
}

/** Inputs a launch needs, from the workflow's declared defaults and what the reader typed. */
export function launchInputs(workflow: DeclaresInputs, typed: Readonly<Record<string, string>>): { inputs: WorkflowInputs } | { problem: string } {
  const inputs: WorkflowInputs = {};
  for (const [name, input] of Object.entries(workflow.definition.inputs ?? {})) {
    const raw = typed[name];
    if (raw === undefined || raw.trim() === "") {
      if (input.default === undefined) return { problem: `Fill in ${name}.` };
      continue;
    }
    const coerced = coerceLaunchInput(name, input, raw);
    if ("problem" in coerced) return coerced;
    inputs[name] = coerced.value;
  }
  return { inputs };
}

/**
 * What a run's children look like to the route, as the session's child agents say now: their branch, whether they
 * wait on the reader, whether a turn is in progress (a direct follow-up too, which the run's record does not show),
 * and a retry Forgerie waits to make.
 */
export interface ChildLook {
  name: string; agent: string | null; branch?: string | undefined; asking: boolean; busy?: boolean | undefined; retry?: ChildRetry | undefined;
  /** The child's conversation, which ties it to one run of a worker. */
  conversationId?: number | undefined;
}

type Settled = Extract<WorkflowRun["children"][number]["state"], { kind: "settled" }>;
/**
 * The words the server wrote, before "duplicate" and "aborted" existed, for a report it held back on purpose. It was
 * one of the two, never a failure, so it reads as unsent and not as an error.
 */
const LEGACY_SUPPRESSED = "Completion report suppressed; no parent message was submitted.";

/** What became of a settled child's report, when it was not sent and that is no failure. */
export function deliveryNote(state: Pick<Settled, "delivered" | "deliveryError">): string | undefined {
  if (state.delivered === "duplicate") return "Duplicate report, not sent again";
  if (state.delivered === "aborted") return "Stopped before reporting";
  return state.delivered === false && state.deliveryError === LEGACY_SUPPRESSED ? "Report not sent" : undefined;
}

/** Why a settled child's report never reached the agent, when the reporter failed. */
export function deliveryProblem(state: Pick<Settled, "delivered" | "deliveryError">): string | undefined {
  return state.delivered === true || state.deliveryError === undefined || state.deliveryError === LEGACY_SUPPRESSED ? undefined
    : `Report not delivered: ${state.deliveryError}`;
}

/** The route as StageStrip segments: one bar per stage, one lane per worker of a stage with several. */
export function stripSegments(run: WorkflowRun): StageStripSegment[] {
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

const count = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** A proposal at a glance: "4 stages · 3 workers · 2 stops". Workers count once by name; a zero count of workers or stops is left out. */
export function proposalGlance(stages: readonly WorkflowStage[]): string {
  if (stages.length === 0) return "Prose only, no stages";
  const workers = new Set(stages.flatMap((stage) => (stage.workers ?? []).map((worker) => worker.name))).size;
  const stops = stages.filter((stage) => stage.stop !== undefined).length;
  return [count(stages.length, "stage", "stages"), workers === 0 ? undefined : count(workers, "worker", "workers"),
    stops === 0 ? undefined : count(stops, "stop", "stops")].filter((part) => part !== undefined).join(" · ");
}

/**
 * Whether a proposal card still waits on the reader. Before the session's proposals are first read, the card
 * trusts its transcript entry and stays open; once they are read, only a record in the open state keeps it open.
 */
export function proposalIsOpen(proposal: WorkflowProposal | undefined, read: boolean): boolean {
  return proposal === undefined ? !read : proposal.state.kind === "open";
}

/** What became of a proposal, for its closed card. */
export function proposalOutcome(proposal: WorkflowProposal | undefined): string {
  switch (proposal?.state.kind) {
    case undefined: return "This proposal is no longer in the session's records.";
    case "open": return "Waiting for a decision.";
    case "started": return "Started";
    case "changes": return `You asked for changes: ${proposal.state.note}`;
    case "dismissed": return "Dismissed";
    case "replaced": return "Replaced by a newer proposal";
    case "here": return "Done here, without workers";
  }
}

/** Where a proposal comes from, as the card's kicker: the saved workflow it adapts, or a new plan. */
export function proposalKicker(basis: ProposalBasis | undefined): string {
  return basis === undefined ? "Proposed workflow" : basis.kind === "saved" ? `Based on ${basis.name}` : "New workflow";
}

/**
 * The inputs a proposal asks for, in the order the sheet shows them: the task first, then the declared ones, then
 * any value the agent filled that the definition does not declare (typed by its value). Each starts at the agent's
 * value, else the declared default, else empty.
 */
export function proposalInputs(proposal: DeclaresInputs & Pick<WorkflowProposal, "inputs">): { inputs: [string, WorkflowInput][]; values: Record<string, string> } {
  const declared: [string, WorkflowInput][] = Object.entries(proposal.definition.inputs ?? {});
  const extra: [string, WorkflowInput][] = Object.entries(proposal.inputs).filter(([name]) => proposal.definition.inputs?.[name] === undefined)
    .map(([name, value]) => [name, { type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string" }]);
  const inputs = [...declared, ...extra].sort(([a], [b]) => Number(b === "task") - Number(a === "task"));
  const values = Object.fromEntries(inputs.map(([name, input]) => {
    const value = proposal.inputs[name] ?? input.default;
    return [name, value === undefined ? "" : String(value)];
  }));
  return { inputs, values };
}

/**
 * The inputs a proposal starts with. A value counts as given when the agent filled it or the reader edited it, and a
 * given value is sent as it stands, an empty string too. An input with no given value is left out, so the server
 * applies its default; one with no default must be filled in. The saved-workflow plan uses `launchInputs` instead.
 */
export function proposalLaunchInputs(inputs: readonly (readonly [string, WorkflowInput])[], values: Readonly<Record<string, string>>,
  given: ReadonlySet<string>): { inputs: WorkflowInputs } | { problem: string } {
  const result: WorkflowInputs = {};
  for (const [name, input] of inputs) {
    if (!given.has(name)) {
      if (input.default === undefined) return { problem: `Fill in ${name}.` };
      continue;
    }
    const coerced = coerceLaunchInput(name, input, values[name] ?? "");
    if ("problem" in coerced) return coerced;
    result[name] = coerced.value;
  }
  return { inputs: result };
}

/** A workflow file's prose: its text without the frontmatter, which the route already shows. */
export function proseOf(text: string): string {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/u, "").trim();
}

/** How many stops wait on the reader in this run. */
export function waitingStops(run: WorkflowRun | undefined): number {
  return run?.state.kind === "running" ? Object.values(run.stops ?? {}).filter((stop) => stop.state === "waiting").length : 0;
}
