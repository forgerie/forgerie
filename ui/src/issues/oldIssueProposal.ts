import { z } from "zod";
import { textOf, type PiMessage } from "../contracts";
import { issueLinkOf } from "./fileIssueResult";

/**
 * Old issue proposals. Before ADR 0002 an agent proposed an issue and the
 * reader created or dismissed it on a card. The card, its tool and its routes
 * are gone, but old transcripts still hold its two entries: the proposal, and
 * on the branch where the reader decided, the outcome. Each proposal now
 * reads as one quiet line that says what became of it. Nothing here can act.
 */
export const OLD_ISSUE_PROPOSAL_TYPE = "forgerie.issue-proposal";
export const OLD_ISSUE_OUTCOME_TYPE = "forgerie.issue-proposal-outcome";

/** What the reader decided. A created issue keeps its link only when the address is a web address. */
export type OldIssueOutcome = { state: "created"; number: number; url?: string } | { state: "dismissed" };

export interface OldIssueProposal {
  /** Pairs the proposal with its outcome entry. Absent when the entry is unreadable, so no outcome can fold in. */
  proposalId?: string;
  /** Absent when neither the entry's details nor its text name it. */
  title?: string;
  outcome?: OldIssueOutcome;
}

// Strict mirrors of src/shared/legacyIssueProposals.ts, for the parity test. The reader below is looser on purpose:
// it reads each field on its own, so an entry the server's schema refuses still shows as a line.
const legacyOutcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("created"), number: z.number().int().min(1), title: z.string(), url: z.string() }),
  z.object({ state: z.literal("dismissed") }),
]);
export const legacyIssueProposalRecordSchema = z.object({
  proposal: z.object({
    proposalId: z.string().min(1), repo: z.string().min(1), title: z.string().min(1).max(256), body: z.string().max(65_000),
    labels: z.array(z.string().min(1).max(50)).max(20), outcome: legacyOutcomeSchema.optional(),
  }),
  targetCwd: z.string().min(1),
});
export const legacyIssueProposalDecisionSchema = z.object({ proposalId: z.string().min(1), outcome: legacyOutcomeSchema });

const createdSchema = z.object({ state: z.literal("created"), number: z.number().int().positive(), url: z.unknown() });
const dismissedSchema = z.object({ state: z.literal("dismissed") });
const text = z.string().trim().min(1);
const record = z.record(z.string(), z.unknown());

/** An outcome, or undefined when the value is not one. A created outcome with a bad address keeps its number. */
function outcomeOf(value: unknown): OldIssueOutcome | undefined {
  const created = createdSchema.safeParse(value);
  if (created.success) {
    const url = issueLinkOf(created.data.url);
    return { state: "created", number: created.data.number, ...(url ? { url } : {}) };
  }
  return dismissedSchema.safeParse(value).success ? { state: "dismissed" } : undefined;
}

// The server wrote this text beside the details: "Proposed issue <id> on <owner/name>: <title>. The user decides whether to create it."
// A preview of a long history drops the details, so the text is the fallback for the id and the title.
const SENTENCE = /^Proposed issue (\S+) on \S+: ([\s\S]+?)\. The user decides whether to create it\.$/u;

/**
 * The old proposal an entry holds, or undefined for any other entry. Every
 * field is read on its own, so a malformed field costs only itself.
 */
export function oldIssueProposalOf(message: PiMessage): OldIssueProposal | undefined {
  if (message.role !== "custom" || message.customType !== OLD_ISSUE_PROPOSAL_TYPE) return undefined;
  const details = record.safeParse(message.details);
  const proposal = record.safeParse(details.success ? details.data["proposal"] : undefined);
  const fields = proposal.success ? proposal.data : {};
  const said = SENTENCE.exec(textOf(message).trim());
  const proposalId = text.safeParse(fields["proposalId"]).data ?? said?.[1];
  const title = text.safeParse(fields["title"]).data ?? said?.[2]?.trim();
  const outcome = outcomeOf(fields["outcome"]);
  return { ...(proposalId ? { proposalId } : {}), ...(title ? { title } : {}), ...(outcome ? { outcome } : {}) };
}

/** Whether an entry is an old outcome. Outcome entries never render; a readable one folds into its proposal. */
export const isOldIssueOutcome = (message: PiMessage): boolean => message.role === "custom" && message.customType === OLD_ISSUE_OUTCOME_TYPE;

/** The outcome an old outcome entry records, with the proposal it belongs to. Undefined when unreadable. */
export function oldIssueOutcomeOf(message: PiMessage): { proposalId: string; outcome: OldIssueOutcome } | undefined {
  if (!isOldIssueOutcome(message)) return undefined;
  const details = record.safeParse(message.details);
  if (!details.success) return undefined;
  const proposalId = text.safeParse(details.data["proposalId"]).data;
  const outcome = outcomeOf(details.data["outcome"]);
  return proposalId && outcome ? { proposalId, outcome } : undefined;
}
