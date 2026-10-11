import { z } from "zod";
import type { PiMessage } from "../contracts";
import type { IssueProposal, IssueProposalOutcome } from "./issueProposal";

export const ISSUE_PROPOSAL_TYPE = "forgerie.issue-proposal";
export const ISSUE_PROPOSAL_OUTCOME_TYPE = "forgerie.issue-proposal-outcome";
const outcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("created"), number: z.number().int().positive(), title: z.string(), url: z.string().url() }),
  z.object({ state: z.literal("dismissed") }),
]);
const proposalSchema = z.object({
  proposalId: z.string().min(1), repo: z.string().min(1), title: z.string().min(1).max(256),
  body: z.string().max(65_000), labels: z.array(z.string().min(1).max(50)).max(20), outcome: outcomeSchema.optional(),
});

/** A proposal row. Private server routing data does not reach the artifact. */
export function issueProposalOf(message: PiMessage): IssueProposal | undefined {
  if (message.role !== "custom" || message.customType !== ISSUE_PROPOSAL_TYPE) return undefined;
  const result = z.object({ proposal: proposalSchema }).safeParse(message.details);
  return result.success ? result.data.proposal : undefined;
}

/** A decision folds into its proposal; it is never a transcript row of its own. */
export function issueProposalDecisionOf(message: PiMessage): { proposalId: string; outcome: IssueProposalOutcome } | undefined {
  if (message.role !== "custom" || message.customType !== ISSUE_PROPOSAL_OUTCOME_TYPE) return undefined;
  const result = z.object({ proposalId: z.string().min(1), outcome: outcomeSchema }).safeParse(message.details);
  return result.success ? result.data : undefined;
}
