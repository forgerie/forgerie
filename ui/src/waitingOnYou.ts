// What in a session's transcript waits on the reader right now: a child agent's open question, a workflow stop
// the run is waiting at, and a workflow proposal still open. The session pins these above the composer so they never scroll out of sight.
import type { ChildEntry } from "./childAgents/childAgentsModel";
import { stopIsOpen, type ProposalEntry, type StopEntry, type WorkflowEntry, type WorkflowProposal, type WorkflowRun } from "./workflows/workflowsModel";

export type WaitingItem =
  | { kind: "question"; id: string; entry: Extract<ChildEntry, { kind: "question" }> }
  | { kind: "stop"; id: string; entry: StopEntry }
  | { kind: "proposal"; id: string; entry: ProposalEntry };

/**
 * The open items, oldest first. `messages` are folded, so an answered question already carries its answer. A proposal
 * pins only once the session's records say it is open, so an old one never flashes in the dock while they load.
 */
export function waitingItems(messages: readonly { id: string; childEntry?: ChildEntry | undefined; workflowEntry?: WorkflowEntry | undefined }[],
  runs: readonly WorkflowRun[], proposals: readonly WorkflowProposal[] = []): WaitingItem[] {
  const items: WaitingItem[] = [];
  for (const message of messages) {
    const child = message.childEntry;
    if (child?.kind === "question" && child.answer === undefined && child.cancelled !== true) items.push({ kind: "question", id: message.id, entry: child });
    const flow = message.workflowEntry;
    if (flow?.kind === "stop" && stopIsOpen(runs.find((run) => run.id === flow.runId), flow)) items.push({ kind: "stop", id: message.id, entry: flow });
    if (flow?.kind === "proposal" && proposals.some((proposal) => proposal.id === flow.proposalId && proposal.state.kind === "open")) {
      items.push({ kind: "proposal", id: message.id, entry: flow });
    }
  }
  return items;
}

/** The dock's heading. */
export function waitingLabel(count: number): string {
  return `${String(count)} waiting for you`;
}
