import type { ManagedProcessInfo } from "@shared/apiTypes";
import type { StatusTone } from "../ui/StatusRow";

const STATUS_LABELS = {
  running: "Running", terminating: "Terminating", terminate_timeout: "Termination timed out", exited: "Exited", killed: "Killed",
} satisfies Record<ManagedProcessInfo["status"], string>;

/** One status phrase, the same in the list and in the process's own view. A failed exit names its code. */
export function processStatus(process: ManagedProcessInfo): string {
  if (process.endReason === "lost") return "Lost";
  if (process.status === "exited" && process.exitCode !== null && process.exitCode !== 0) return `Exited with ${String(process.exitCode)}`;
  return STATUS_LABELS[process.status];
}

/**
 * The tone of a process's mark. A failure is a non-zero exit or a spawn error. A lost process and a stop that timed
 * out take the warn tone: the process may still run outside Forgerie. A process stopped by a signal ended before it
 * finished.
 */
export function processTone(process: ManagedProcessInfo): StatusTone {
  if (process.endReason === "lost" || process.status === "terminate_timeout") return "retrying";
  if (process.status === "running" || process.status === "terminating") return "working";
  if (process.status === "killed" || process.endReason === "signal") return "stopped";
  if (process.endReason === "spawn_error" || process.success === false || (process.exitCode !== null && process.exitCode !== 0)) return "failed";
  return "quiet";
}

/** "12m", "3h": a span in the list's shorthand. */
function span(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${String(hours)}h` : `${String(Math.floor(hours / 24))}d`;
}

/** The row's readout: the pid and how long it has run while it runs, else how long ago it ended. */
export function processMeta(process: ManagedProcessInfo, now: number): string {
  if (process.endTime === null) return [process.pid > 0 ? `pid ${String(process.pid)}` : "", `up ${span(now - process.startTime)}`].filter(Boolean).join(", ");
  return `ended ${span(now - process.endTime)} ago`;
}
