import type { SessionActivity } from "./api";
import type { ChatLine } from "./components/shared";

/**
 * The transcript's liveness line.
 *
 * While a turn runs, the transcript shows how long it has been working and what
 * it is doing right now, instead of streaming every tool call into view. That
 * answers "is it alive" and "roughly where is it" without asking the reader to
 * follow the output itself.
 */

/**
 * What stretch of work the transcript is timing.
 *
 * Compaction is a phase of its own rather than a continuation of the turn that
 * triggered it. The elapsed clock restarts when the phase changes, so
 * "compacting history" never inherits the finished turn's minutes and claim a
 * duration that never happened.
 */
export type LivenessPhase = "working" | "compacting";

export function livenessPhase(input: { isCompacting: boolean; indicatorActive: boolean }): LivenessPhase | undefined {
  if (input.isCompacting) return "compacting";
  return input.indicatorActive ? "working" : undefined;
}

/** Elapsed time, coarse on purpose: this is reassurance, not a stopwatch. */
export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60)}m`;
}

/**
 * The step the transcript is running right now.
 *
 * Prefers the newest tool call in the transcript, because that names the work
 * in the reader's own terms ("read archive.ts"). The activity feed is the
 * fallback: its label describes the transport ("tool execution update"), which
 * tells the reader nothing they wanted to know.
 */
export function livenessStep(
  messages: readonly ChatLine[],
  activity: SessionActivity | undefined,
  fallback: string,
): string {
  const tool = latestToolStep(messages);
  if (tool !== undefined) return tool;
  const detail = activity?.detail?.trim();
  if (detail !== undefined && detail !== "") return detail;
  const label = activity?.label.trim();
  if (label !== undefined && label !== "") return label;
  return fallback.trim();
}

/**
 * Longest step we will show. A tool summary can be a whole shell command, and
 * the liveness line is a glance, not a record -- the fold holds the full text.
 */
const MAX_STEP_LENGTH = 44;

function clampStep(step: string): string {
  const collapsed = step.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= MAX_STEP_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_STEP_LENGTH - 1).trimEnd()}…`;
}

/** The newest tool call in the transcript, named for a reader. */
export function latestToolStep(messages: readonly ChatLine[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parts = messages[index]?.parts ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part === undefined) continue;
      if (part.type !== "toolCall" && part.type !== "toolExecution") continue;
      const summary = part.summary.trim();
      const name = part.toolName.trim();
      if (summary !== "" && name !== "") return clampStep(`${name} ${summary}`);
      if (name !== "") return clampStep(name);
      if (summary !== "") return clampStep(summary);
    }
  }
  return undefined;
}
