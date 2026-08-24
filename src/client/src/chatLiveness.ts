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

/**
 * The two clocks a live transcript needs.
 *
 * `turnStartedAt` answers how long the whole reply has taken. `stepStartedAt`
 * answers how long the thing named on the liveness row has taken. Keeping both
 * avoids the old lie where a fresh verify step inherited the six minutes spent
 * on every step before it. `lastActivityAt` is the silence clock: it advances
 * without resetting step age when the daemon publishes another event for the
 * same visible step.
 */
export interface LivenessClock {
  readonly phase: LivenessPhase;
  readonly turnStartedAt: string;
  readonly step: string;
  readonly stepStartedAt: string;
  readonly activityMarker?: string;
  readonly lastActivityAt: string;
}

export interface LivenessClockInput {
  readonly phase: LivenessPhase | undefined;
  readonly step: string;
  readonly activityAt?: string;
}

export interface LivenessTiming {
  readonly turnElapsedMs: number;
  readonly stepElapsedMs: number;
  readonly silentElapsedMs: number;
  readonly beatMs: number;
  readonly stuck: boolean;
}

export function livenessPhase(input: { isCompacting: boolean; indicatorActive: boolean }): LivenessPhase | undefined {
  if (input.isCompacting) return "compacting";
  return input.indicatorActive ? "working" : undefined;
}

/**
 * Advance the clocks when ChatView observes a new state.
 *
 * The observation time, rather than `Date.now()` hidden inside this function,
 * is an explicit dependency so phase and step transitions are deterministic in
 * tests. Activity timestamps are identity markers: a new one refreshes the
 * silence clock but never pretends the step itself restarted.
 */
export function advanceLivenessClock(
  previous: LivenessClock | undefined,
  input: LivenessClockInput,
  observedAt: string,
): LivenessClock | undefined {
  if (input.phase === undefined) return undefined;
  const activityMarker = validIso(input.activityAt);
  if (previous?.phase !== input.phase) {
    return {
      phase: input.phase,
      turnStartedAt: observedAt,
      step: input.step,
      stepStartedAt: observedAt,
      ...(activityMarker === undefined ? {} : { activityMarker }),
      lastActivityAt: activityMarker ?? observedAt,
    };
  }
  if (previous.step !== input.step) {
    return {
      phase: input.phase,
      turnStartedAt: previous.turnStartedAt,
      step: input.step,
      stepStartedAt: observedAt,
      ...(activityMarker === undefined ? {} : { activityMarker }),
      lastActivityAt: activityMarker ?? observedAt,
    };
  }
  if (activityMarker !== undefined && activityMarker !== previous.activityMarker) {
    return { ...previous, activityMarker, lastActivityAt: activityMarker };
  }
  return previous;
}

/** A short beat for local file work; a long one for processes and orchestration. */
export function livenessBeatMs(step: string): number {
  const verb = step.trim().split(/\s+/u)[0]?.toLowerCase();
  if (verb === "read" || verb === "edit" || verb === "write") return 10_000;
  return 60_000;
}

/** The observable timing state at one instant. */
export function livenessTiming(clock: LivenessClock, now: number): LivenessTiming {
  const turnElapsedMs = elapsed(clock.turnStartedAt, now);
  const stepElapsedMs = elapsed(clock.stepStartedAt, now);
  const silentElapsedMs = elapsed(clock.lastActivityAt, now);
  const beatMs = livenessBeatMs(clock.step);
  return {
    turnElapsedMs,
    stepElapsedMs,
    silentElapsedMs,
    beatMs,
    stuck: stepElapsedMs >= beatMs && silentElapsedMs >= beatMs,
  };
}

function elapsed(startedAt: string, now: number): number {
  const started = Date.parse(startedAt);
  return Number.isFinite(started) ? Math.max(0, now - started) : 0;
}

function validIso(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

export interface ReplyStreamingInput {
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly isBashRunning: boolean;
  readonly awaitingUserInput: boolean;
  readonly activity: Pick<SessionActivity, "phase" | "label"> | undefined;
}

/**
 * Whether the newest assistant prose is still receiving content.
 *
 * Session streaming covers the whole agent loop, including tools and waits.
 * Answer promotion needs the narrower message-delivery phase. Activity is the
 * authoritative live signal when present; status covers reconnect snapshots
 * that arrive before the current activity event.
 */
export function replyIsStreaming(input: ReplyStreamingInput): boolean {
  if (input.isCompacting || input.isBashRunning || input.awaitingUserInput) return false;
  if (input.activity === undefined) return input.isStreaming;
  return input.activity.phase === "active"
    && (input.activity.label === "message started" || input.activity.label === "receiving response");
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
