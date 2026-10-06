import type { SessionStatus } from "./contracts";

/**
 * How much of the model's context window the session uses, as a whole percent.
 * Pi measures it from the last reply, so it is unknown before the first reply
 * and again after a compaction until the next one.
 */
export type ContextUse = { type: "unknown" } | { type: "known"; percent: number; high: boolean };

/**
 * The last fifth of the window. A guess, not Pi's compaction point: that point
 * depends on Pi settings the status does not send. With the default reserve it
 * lies above 90% of any window, so 80% gives some warning before it.
 */
export const HIGH_CONTEXT_PERCENT = 80;

export function contextUse(status: SessionStatus | undefined): ContextUse {
  const percent = status?.contextUsage?.percent;
  if (percent === undefined || percent === null || !Number.isFinite(percent)) return { type: "unknown" };
  const rounded = Math.min(100, Math.max(0, Math.round(percent)));
  return { type: "known", percent: rounded, high: rounded >= HIGH_CONTEXT_PERCENT };
}
