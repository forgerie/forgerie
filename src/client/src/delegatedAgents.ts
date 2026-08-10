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
  readonly task?: string;
  readonly output?: string;
}

export interface DelegatedRunCounts {
  readonly total: number;
  readonly running: number;
  readonly done: number;
  readonly failed: number;
}

export interface DelegatedRun {
  readonly id: string;
  /** Agent name when every child shares one, otherwise a bare count. */
  readonly label: string;
  /** True while the tool call is still in flight, so control is still meaningful. */
  readonly live: boolean;
  readonly state: DelegatedRunState;
  readonly counts: DelegatedRunCounts;
  readonly agents: readonly DelegatedAgent[];
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
  const agents = agentsFromResults(details);
  if (agents.length === 0) return undefined;

  const live = part.status === "pending" || part.status === "running";
  const counts = countAgents(agents);
  return {
    id: stringField(details, "runId") ?? part.toolCallId ?? "unknown",
    label: runLabel(agents),
    live,
    state: runState(live, counts),
    counts,
    agents,
  };
}

/**
 * Management actions (`list`, `status`, `doctor`, …) share the tool name but
 * delegate nothing, so they must not appear as runs with zero agents.
 */
function isManagementCall(part: ToolExecutionPart): boolean {
  return stringField(asRecord(part.args), "action") !== undefined;
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
    agents.push({
      index,
      name,
      state: failed ? "failed" : "done",
      ...(detail === undefined ? {} : { detail }),
      ...(task === undefined ? {} : { task }),
      ...(output === undefined ? {} : { output }),
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
