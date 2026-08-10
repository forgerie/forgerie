/**
 * Delegated `pi-subagents` runs, derived from one session's own transcript.
 *
 * A session owns the agents it delegated. The evidence for that ownership is
 * structural: the agent appears inside a `subagent` tool call in this session's
 * messages. It is deliberately *not* `parentSessionPath` — a session forked by
 * hand carries that too, and remains a first-class session of its own.
 *
 * `pi-subagents` is not a dependency of this app. It is a Pi extension that may
 * or may not be installed, and its payload arrives here as `unknown` on the
 * `details` of a tool execution. Every field is therefore optional and every
 * parse failure costs detail rather than throwing: a run whose details cannot be
 * read is still a run.
 */

import type { ChatLine, ChatPart, ToolExecutionPart } from "./components/shared";

export type DelegatedAgentState = "pending" | "running" | "done" | "failed" | "detached";

/** `partial` means the run finished with some agents done and some failed. */
export type DelegatedRunState = "running" | "done" | "failed" | "partial";

export interface DelegatedAgent {
  readonly index: number;
  readonly name: string;
  readonly state: DelegatedAgentState;
  /** Current tool while running; result summary or error once finished. */
  readonly detail?: string;
  readonly elapsedMs?: number;
  readonly task?: string;
  readonly output?: string;
  /**
   * The session the agent wrote, reported by the run's own result.
   *
   * Present only once an agent finishes: a run in flight reports progress, and
   * progress carries no file. Commands that need a transcript are therefore
   * unavailable while the agent is still working, which is honest -- there is
   * nothing to open yet.
   */
  readonly sessionFile?: string;
}

export interface DelegatedRunCounts {
  readonly total: number;
  readonly running: number;
  readonly done: number;
  readonly failed: number;
}

export interface DelegatedRun {
  /**
   * Short, stable run identity. `pi-subagents` supplies an 8-character run id,
   * but a run observed only through `tool.start` has none, and the raw tool call
   * id can exceed 100 characters — long enough to push a row off a 499px screen.
   * Both cases collapse to the same short shape so rows stay one line.
   */
  readonly id: string;
  /** Agent name when every child shares one, otherwise a bare count. */
  readonly label: string;
  /** True while the tool call is still in flight, so control is still meaningful. */
  readonly live: boolean;
  readonly state: DelegatedRunState;
  readonly counts: DelegatedRunCounts;
  readonly agents: readonly DelegatedAgent[];
  /**
   * Provenance kept but not yet rendered: an async or detached run can outlive
   * the parent's attention, and a later iteration needs this to find it.
   */
  readonly asyncId?: string;
  readonly context?: string;
}

/**
 * Newest run first. Reads only the loaded transcript window — callers that can
 * see `messagePageStart > 0` must say so rather than implying completeness.
 */
export function deriveDelegatedRuns(messages: readonly ChatLine[]): DelegatedRun[] {
  const runs: DelegatedRun[] = [];
  for (const line of messages) {
    for (const part of line.parts) {
      const run = runFromPart(part);
      if (run !== undefined) runs.push(run);
    }
  }
  return runs.reverse();
}

function runFromPart(part: ChatPart): DelegatedRun | undefined {
  if (part.type !== "toolExecution" || part.toolName !== "subagent") return undefined;
  if (isManagementCall(part)) return undefined;

  const details = asRecord(part.details);
  // Live progress is richer than results and exists first; the call arguments
  // are the last resort, before any agent has reported anything.
  const agents = firstNonEmpty(
    agentsFromProgress(details),
    agentsFromResults(details),
    agentsFromArgs(asRecord(part.args)),
  );
  if (agents.length === 0) return undefined;

  const live = part.status === "pending" || part.status === "running";
  const counts = countAgents(agents);
  const asyncId = stringField(details, "asyncId");
  const context = stringField(details, "context");
  return {
    id: runIdentity(stringField(details, "runId"), part.toolCallId),
    label: runLabel(agents),
    live,
    state: runState(live, counts),
    counts,
    agents,
    ...(asyncId === undefined ? {} : { asyncId }),
    ...(context === undefined ? {} : { context }),
  };
}

/**
 * Management actions (`list`, `status`, `doctor`, …) share the tool name but
 * delegate nothing, so they must not appear as runs with zero agents.
 */
function isManagementCall(part: ToolExecutionPart): boolean {
  return stringField(asRecord(part.args), "action") !== undefined;
}

function firstNonEmpty(...candidates: readonly DelegatedAgent[][]): DelegatedAgent[] {
  return candidates.find((candidate) => candidate.length > 0) ?? [];
}

function agentsFromProgress(details: Record<string, unknown> | undefined): DelegatedAgent[] {
  const progress = arrayField(details, "progress");
  if (progress === undefined) return [];
  const agents: DelegatedAgent[] = [];
  for (const [position, entry] of progress.entries()) {
    const record = asRecord(entry);
    const name = stringField(record, "agent");
    if (name === undefined) continue;
    const state = progressState(stringField(record, "status"));
    const detail = state === "failed"
      ? stringField(record, "error") ?? "failed"
      : currentToolLabel(record);
    const elapsedMs = numberField(record, "durationMs");
    const task = stringField(record, "task");
    agents.push({
      index: numberField(record, "index") ?? position,
      name,
      state,
      ...(detail === undefined ? {} : { detail }),
      ...(elapsedMs === undefined ? {} : { elapsedMs }),
      ...(task === undefined ? {} : { task }),
    });
  }
  return agents;
}

function progressState(status: string | undefined): DelegatedAgentState {
  switch (status) {
    case "running": return "running";
    case "completed": return "done";
    case "failed": return "failed";
    case "detached": return "detached";
    case "pending":
    case undefined:
    default: return "pending";
  }
}

/** `grep src/main/kotlin` reads better on one line than the tool name alone. */
function currentToolLabel(record: Record<string, unknown> | undefined): string | undefined {
  const tool = stringField(record, "currentTool");
  if (tool === undefined) return undefined;
  const args = stringField(record, "currentToolArgs");
  return args === undefined ? tool : `${tool} ${args}`;
}

/**
 * Names taken from the call itself. This is the only evidence available between
 * dispatch and the first progress update, and it carries no state of its own.
 */
function agentsFromArgs(args: Record<string, unknown> | undefined): DelegatedAgent[] {
  const specs = [
    ...expandTaskSpecs(arrayField(args, "tasks")),
    ...expandChainSpecs(arrayField(args, "chain")),
  ];
  const single = stringField(args, "agent");
  if (specs.length === 0 && single !== undefined) {
    specs.push({ name: single, ...optionalTask(args) });
  }
  return specs.map((spec, index) => ({
    index,
    name: spec.name,
    state: "pending" as const,
    ...(spec.task === undefined ? {} : { task: spec.task }),
  }));
}

interface AgentSpec {
  readonly name: string;
  readonly task?: string;
}

function expandTaskSpecs(tasks: unknown[] | undefined): AgentSpec[] {
  const specs: AgentSpec[] = [];
  for (const entry of tasks ?? []) {
    const record = asRecord(entry);
    const name = stringField(record, "agent");
    if (name === undefined) continue;
    const copies = Math.max(1, numberField(record, "count") ?? 1);
    for (let copy = 0; copy < copies; copy += 1) specs.push({ name, ...optionalTask(record) });
  }
  return specs;
}

function expandChainSpecs(chain: unknown[] | undefined): AgentSpec[] {
  const specs: AgentSpec[] = [];
  for (const entry of chain ?? []) {
    const record = asRecord(entry);
    const parallel = arrayField(record, "parallel");
    if (parallel !== undefined) {
      specs.push(...expandTaskSpecs(parallel));
      continue;
    }
    const name = stringField(record, "agent");
    if (name !== undefined) specs.push({ name, ...optionalTask(record) });
  }
  return specs;
}

function optionalTask(record: Record<string, unknown> | undefined): { task?: string } {
  const task = stringField(record, "task");
  return task === undefined ? {} : { task };
}

function agentsFromResults(details: Record<string, unknown> | undefined): DelegatedAgent[] {
  const results = arrayField(details, "results");
  if (results === undefined) return [];
  const agents: DelegatedAgent[] = [];
  for (const [index, entry] of results.entries()) {
    const record = asRecord(entry);
    const name = stringField(record, "agent");
    if (name === undefined) continue;
    const failed = numberField(record, "exitCode") !== 0;
    const error = stringField(record, "error");
    const output = stringField(record, "output");
    const detail = failed ? error ?? "failed" : summarise(output);
    const task = stringField(record, "task");
    const state: DelegatedAgentState = record?.["detached"] === true
      ? "detached"
      : failed ? "failed" : "done";
    const sessionFile = stringField(record, "sessionFile");
    agents.push({
      index,
      name,
      state,
      ...(detail === undefined ? {} : { detail }),
      ...(task === undefined ? {} : { task }),
      ...(output === undefined ? {} : { output }),
      ...(sessionFile === undefined ? {} : { sessionFile }),
    });
  }
  return agents;
}

/**
 * States only what the run recorded. A shared agent name is a fact; a role
 * inferred from a name substring is a guess, and `eb2ca573` — reviewers plus a
 * researcher plus a strategist — is why guessing is not allowed here.
 */
function runLabel(agents: readonly DelegatedAgent[]): string {
  const distinct = new Set(agents.map((agent) => agent.name));
  if (distinct.size !== 1) return `${String(agents.length)} agents`;
  const [name] = [...distinct];
  return agents.length === 1 ? String(name) : `${String(name)} ×${String(agents.length)}`;
}

function countAgents(agents: readonly DelegatedAgent[]): DelegatedRunCounts {
  let running = 0;
  let done = 0;
  let failed = 0;
  for (const agent of agents) {
    if (agent.state === "running") running += 1;
    else if (agent.state === "done") done += 1;
    else if (agent.state === "failed") failed += 1;
  }
  return { total: agents.length, running, done, failed };
}

function runState(live: boolean, counts: DelegatedRunCounts): DelegatedRunState {
  if (live) return "running";
  if (counts.failed === 0) return "done";
  if (counts.done === 0) return "failed";
  return "partial";
}

/** First non-empty line of an agent's output, kept short enough for one row. */
function summarise(output: string | undefined): string | undefined {
  const firstLine = output?.split("\n").map((line) => line.trim()).find((line) => line !== "");
  if (firstLine === undefined) return undefined;
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

// ---------------------------------------------------------------------------
// Defensive readers. `details` is `unknown` off the wire; nothing here throws.
// ---------------------------------------------------------------------------

/**
 * Prefer the extension's own run id. Otherwise reduce the tool call id to the
 * same 8-character shape: keep only word characters, drop a leading `call_`,
 * and take the tail so ids that share a long common prefix stay distinct.
 */
function runIdentity(runId: string | undefined, toolCallId: string | undefined): string {
  if (runId !== undefined && runId !== "") return runId;
  if (toolCallId === undefined || toolCallId === "") return "unknown";
  // Short ids are already readable; shortening them only mangles them.
  if (toolCallId.length <= MAX_READABLE_RUN_ID) return toolCallId;
  const cleaned = toolCallId.replace(/^call_/, "").replace(/[^A-Za-z0-9]/g, "");
  if (cleaned === "") return "unknown";
  // Tail, not head: provider call ids share long common prefixes.
  return cleaned.slice(-8);
}

const MAX_READABLE_RUN_ID = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function arrayField(record: Record<string, unknown> | undefined, key: string): unknown[] | undefined {
  const value = record?.[key];
  return Array.isArray(value) ? value : undefined;
}
