// What in a session's transcript waits on the reader right now: a child agent's open question, a workflow stop
// the run is waiting at, and a gated action waiting for approval. The session pins these above the composer so they
// never scroll out of sight. A workflow proposal waits in the ledge at the input instead (session/proposalLedge.ts).
import type { ChildEntry } from "./childAgents/childAgentsModel";
import { askerOf, type GatedAction, type GatedActionEntry } from "./gatedActions/gatedActionsModel";
import { stopIsOpen, type StopEntry, type WorkflowEntry, type WorkflowRun } from "./workflows/workflowsModel";

export type WaitingItem =
  | { kind: "question"; id: string; entry: Extract<ChildEntry, { kind: "question" }> }
  | { kind: "stop"; id: string; entry: StopEntry }
  | { kind: "gated"; id: string; entry: GatedActionEntry };

/**
 * The open items, oldest first. `messages` are folded, so an answered question already carries its answer. A gated
 * action pins only once its record says it waits, so an old one never flashes in the dock while they load. While the
 * gated actions cannot be read, a gated action pins unless a record read earlier says it was decided: a real wait must
 * stay in reach, and one that was already decided shows until a read answers.
 */
export function waitingItems(messages: readonly { id: string; childEntry?: ChildEntry | undefined; workflowEntry?: WorkflowEntry | undefined;
  gatedAction?: GatedActionEntry | undefined }[], runs: readonly WorkflowRun[],
  gated: { records?: readonly GatedAction[] | undefined; readFailed?: boolean | undefined } = {}): WaitingItem[] {
  const items: WaitingItem[] = [];
  for (const message of messages) {
    const child = message.childEntry;
    if (child?.kind === "question" && child.answer === undefined && child.cancelled !== true) items.push({ kind: "question", id: message.id, entry: child });
    const flow = message.workflowEntry;
    if (flow?.kind === "stop" && stopIsOpen(runs.find((run) => run.id === flow.runId), flow)) items.push({ kind: "stop", id: message.id, entry: flow });
    const action = message.gatedAction;
    const record = action === undefined ? undefined : gated.records?.find((candidate) => candidate.id === action.id);
    if (action !== undefined && (record === undefined ? gated.readFailed === true : record.state.kind === "waiting")) {
      items.push({ kind: "gated", id: message.id, entry: action });
    }
  }
  return items;
}

/** The key a waiting item is pinned under, so its place in the thread can keep one quiet line instead. */
export function pinKey(item: WaitingItem): string {
  switch (item.kind) {
    case "question": return `q:${item.entry.questionId}`;
    case "stop": return `s:${item.entry.runId}/${item.entry.stage}/${String(item.entry.round)}`;
    case "gated": return `g:${item.entry.id}`;
  }
}

/** What an item is, in a few words, for the folded dock's line. */
export function waitingName(item: WaitingItem): string {
  switch (item.kind) {
    case "question": return `${item.entry.childName}'s question`;
    case "stop": return item.entry.stageName;
    case "gated": return `approval for ${askerOf(item.entry.by)}`;
  }
}

/** The dock's heading. */
export function waitingLabel(count: number): string {
  return `${String(count)} waiting for you`;
}
