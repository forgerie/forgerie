// What the agent proposed that still waits on the reader, as the ledge above the input bar lists it: open backlog
// suggestions and open workflow proposals, newest first. Pure: the session binding reads the stores and passes their
// snapshots in; the ledge draws what this returns. A filed, started or decided proposal leaves the ledge; the thread
// keeps its card as the record.
import type { Suggestion } from "../backlog/suggestions/suggestionsApi";
import type { SuggestionPress } from "../backlog/suggestions/suggestionsStore";
import { isOpen, rowState, wordsOf, type SuggestionAction, type SuggestionDraft } from "../backlog/suggestions/suggestionsModel";
import type { ProposalAction, ProposalEntry, WorkflowEntry, WorkflowProposal } from "../workflows/workflowsModel";

interface Held {
  /** Unique across both kinds, and stable while the proposal waits. */
  key: string;
  id: string;
  title: string;
  /** One line about it, from its body or summary. */
  gist: string;
  /** When it was proposed, in ms. Orders the ledge. */
  at: number;
  /** Work in flight, in place of the actions. */
  status?: string | undefined;
}
export type HeldSuggestion = Held & {
  type: "suggestion";
  /** `Issue` for a GitHub destination, `Backlog` for the Markdown folder. */
  kind: "Issue" | "Backlog";
  /** Why the last attempt failed. */
  problem?: string | undefined;
  /** File and File and act are on offer. */
  offer: boolean;
  /** The action Retry repeats, after a failure it can retry. Absent: no Retry. */
  retry?: SuggestionAction | undefined;
  /** A close match exists, and the card is where the reader decides. */
  duplicate: boolean;
  busy: boolean;
};
export type HeldWorkflow = Held & { type: "workflow"; entry: ProposalEntry };
export type HeldProposal = HeldSuggestion | HeldWorkflow;

/**
 * What the ledge's All menu acts on: the suggestions File and act would take now, newest first, and how many it leaves
 * out and why. A close match waits for its card, a failure for its Retry, and work in flight for itself. Workflows are
 * not suggestions, so they are neither in it nor left out of it.
 */
export interface ProposalBatch {
  ids: string[];
  leftOut: { review: number; failed: number; filing: number };
}
export function batchOf(proposals: readonly HeldProposal[]): ProposalBatch {
  const suggestions = proposals.filter((proposal): proposal is HeldSuggestion => proposal.type === "suggestion");
  const inFlight = (proposal: HeldSuggestion) => proposal.busy || proposal.status !== undefined;
  return {
    ids: suggestions.filter((proposal) => proposal.offer && proposal.retry === undefined && !proposal.duplicate && !inFlight(proposal)).map((proposal) => proposal.id),
    leftOut: {
      review: suggestions.filter((proposal) => proposal.duplicate && !inFlight(proposal)).length,
      failed: suggestions.filter((proposal) => !proposal.duplicate && (proposal.retry !== undefined || !proposal.offer) && !inFlight(proposal)).length,
      filing: suggestions.filter(inFlight).length,
    },
  };
}
/** What the All menu's heading says it leaves out, such as "Leaves out 3: 1 to review, 1 failed, 1 filing". Undefined: nothing. */
export function leftOutWords({ leftOut }: ProposalBatch): string | undefined {
  const parts = [[leftOut.review, "to review"], [leftOut.failed, "failed"], [leftOut.filing, "filing"]] as const;
  const named = parts.filter(([count]) => count > 0);
  if (named.length === 0) return undefined;
  const total = named.reduce((sum, [count]) => sum + count, 0);
  return `Leaves out ${String(total)}: ${named.map(([count, words]) => `${String(count)} ${words}`).join(", ")}`;
}

/** What the ledge's handle and stack call a count of proposals. */
export const proposalNoun = (count: number) => count === 1 ? "proposal" : "proposals";

/** The first line of a body, without Markdown's heading and list marks, for a one-line gist. */
export function gistOf(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find((part) => part !== "") ?? "";
  return line.replace(/^(?:#{1,6}\s+|[-*+]\s+|>\s*)/u, "");
}

const PROPOSAL_PENDING: Record<ProposalAction, string> = { start: "Starting…", changes: "Sending…", dismiss: "Dismissing…", here: "Starting here…" };

/** An open suggestion as the ledge shows it. */
export function heldSuggestion(suggestion: Suggestion, view: { pending: Readonly<Record<string, SuggestionPress>>; problems: Readonly<Record<string, string>>;
  last: Readonly<Record<string, SuggestionAction>>; drafts: Readonly<Record<string, SuggestionDraft>> }): HeldSuggestion {
  const { busy, filing, problem, offer } = rowState(suggestion, view.pending, view.problems);
  const state = suggestion.state;
  const press = view.pending[suggestion.id];
  const acting = press === "file-and-act" || (press === undefined && state.kind === "filing" && state.action === "file-and-act");
  const words = wordsOf(suggestion, view.drafts[suggestion.id]);
  const failedAction = state.kind === "failed" ? state.action : undefined;
  // Retry repeats what failed: the server's record says which action, else the last one pressed here.
  const retry = problem === undefined || (state.kind === "failed" && !state.retryable) ? undefined : failedAction ?? view.last[suggestion.id] ?? "file";
  const at = Date.parse(suggestion.createdAt);
  return {
    type: "suggestion", key: `b:${suggestion.id}`, id: suggestion.id, kind: suggestion.destination.provider === "github" ? "Issue" : "Backlog",
    title: words.title, gist: gistOf(words.body), at: Number.isNaN(at) ? 0 : at,
    status: filing ? acting ? "Filing and starting…" : "Filing…" : press === "dismiss" ? "Dismissing…" : undefined,
    problem, offer, retry, duplicate: state.kind === "duplicate", busy,
  };
}

/**
 * Every open proposal, newest first. A suggestion is open until it is filed or dismissed. A workflow proposal shows
 * only once the session's records say it is open, so an old one never flashes in while they load.
 */
export function heldProposals({ suggestions, view, messages, proposals, proposing }: {
  suggestions: readonly Suggestion[] | undefined;
  view: Parameters<typeof heldSuggestion>[1];
  messages: readonly { workflowEntry?: WorkflowEntry | undefined }[];
  proposals: readonly WorkflowProposal[] | undefined;
  proposing?: { id: string; action: ProposalAction } | undefined;
}): HeldProposal[] {
  const held: HeldProposal[] = (suggestions ?? []).filter((suggestion) => isOpen(suggestion.state)).map((suggestion) => heldSuggestion(suggestion, view));
  const seen = new Set<string>();
  for (const message of messages) {
    const entry = message.workflowEntry;
    if (entry?.kind !== "proposal" || seen.has(entry.proposalId)) continue;
    const record = proposals?.find((proposal) => proposal.id === entry.proposalId);
    if (record?.state.kind !== "open") continue;
    seen.add(entry.proposalId);
    held.push({ type: "workflow", key: `p:${entry.proposalId}`, id: entry.proposalId, entry, title: record.name || entry.name,
      gist: gistOf(entry.summary || record.summary), at: record.createdAt,
      status: proposing?.id === entry.proposalId ? PROPOSAL_PENDING[proposing.action] : undefined });
  }
  return held.sort((a, b) => b.at - a.at);
}
