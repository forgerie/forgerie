// What in a session's transcript waits on the reader right now: a child agent's open question and a workflow stop
// the run is waiting at. The session pins these above the composer so they never scroll out of sight.
import type { ChildEntry } from "./childAgents/childAgentsModel";
import { stopIsOpen, type StopEntry, type WorkflowEntry, type WorkflowRun } from "./workflows/workflowsModel";

export type WaitingItem =
  | { kind: "question"; id: string; entry: Extract<ChildEntry, { kind: "question" }> }
  | { kind: "stop"; id: string; entry: StopEntry };

/** The open items, oldest first. `messages` are folded, so an answered question already carries its answer. */
export function waitingItems(messages: readonly { id: string; childEntry?: ChildEntry | undefined; workflowEntry?: WorkflowEntry | undefined }[],
  runs: readonly WorkflowRun[]): WaitingItem[] {
  const items: WaitingItem[] = [];
  for (const message of messages) {
    const child = message.childEntry;
    if (child?.kind === "question" && child.answer === undefined && child.cancelled !== true) items.push({ kind: "question", id: message.id, entry: child });
    const flow = message.workflowEntry;
    if (flow?.kind === "stop" && stopIsOpen(runs.find((run) => run.id === flow.runId), flow)) items.push({ kind: "stop", id: message.id, entry: flow });
  }
  return items;
}

/** The dock's heading. */
export function waitingLabel(count: number): string {
  return `${String(count)} waiting for you`;
}
