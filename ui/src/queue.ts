import type { SessionStatus } from "./contracts";
import { isCompactCommand, type CompactionState } from "./compaction";

/** Pi owns the queue. The client reads it from status and never keeps its own copy. */
export type QueuedMessage = SessionStatus["queuedMessages"][number];
export type QueueKind = QueuedMessage["kind"] | "compaction";

/**
 * What a draft can do while the session works. A follow-up waits for the run
 * (or a compaction) to finish. A steer reaches the agent after its current
 * step, so it only makes sense while the agent responds and nothing waits in
 * front of it. A shell command alone needs neither: Pi starts a prompt at once.
 *
 * `agentRunning` is the transcript's view. An `agent.start` event can arrive
 * before status reports streaming, and the bar must not refuse a send then.
 * Sending a behavior Pi no longer needs is harmless: an idle Pi ignores it.
 */
export interface WorkingSend { queue: boolean; steer: boolean }
export function workingSend(status: SessionStatus | undefined, compaction: CompactionState, agentRunning = false): WorkingSend {
  const compacting = status?.isCompacting === true
    || compaction.type === "checking" || compaction.type === "queued" || compaction.type === "running";
  const streaming = status?.isStreaming === true || agentRunning;
  return { queue: streaming || compacting, steer: streaming && !compacting };
}

export function queueKindOf(message: QueuedMessage): QueueKind {
  return message.kind === "followUp" && isCompactCommand(message.text) ? "compaction" : message.kind;
}

/** Pi drops a text-only message that matches one already waiting. */
export function isAlreadyQueued(status: SessionStatus | undefined, text: string): boolean {
  return status?.queuedMessages.some((message) => message.text === text) === true;
}
