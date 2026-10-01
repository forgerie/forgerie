import type { CommandOutput, SessionStatus } from "./contracts";

export type CompactionState = { type: "idle" } | { type: "checking" } | { type: "queued"; text: string } | { type: "running" }
  | { type: "finished"; outcome: "complete" | "cancelled" | "failed" | "unknown"; message: string };
export const idleCompaction: CompactionState = { type: "idle" };
export const isCompactCommand = (text: string) => /^\/compact(?:\s|$)/u.test(text);

export function compactionFromStatus(previous: CompactionState, status: SessionStatus): CompactionState {
  if (status.isCompacting) return { type: "running" };
  const queued = status.queuedMessages.find((message) => message.kind === "followUp" && isCompactCommand(message.text));
  if (queued) return { type: "queued", text: queued.text };
  if (previous.type === "checking" || previous.type === "queued" || previous.type === "running") return {
    type: "finished", outcome: "unknown", message: "Compaction is no longer active. Completion details are unavailable.",
  };
  return previous;
}

/** Pi's existing output contract has no command ID. Match only its documented compaction prefixes. */
export function compactionFromOutput(output: CommandOutput): CompactionState | undefined {
  const { level, message } = output;
  const outcome = level === "success" && /^Compaction complete\.(?:\n|$)/u.test(message) ? "complete"
    : level === "info" && message === "Compaction cancelled." ? "cancelled"
    : level === "error" && /^(?:Compaction failed:|Queued compaction failed to start:)/u.test(message) ? "failed" : undefined;
  return outcome ? { type: "finished", outcome, message } : undefined;
}
