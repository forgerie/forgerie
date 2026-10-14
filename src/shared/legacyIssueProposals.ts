import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

/** Read-only compatibility for historical branch custom messages. See docs/file-issues.md. */
export const ISSUE_PROPOSAL_TYPE = "forgerie.issue-proposal";
export const ISSUE_PROPOSAL_OUTCOME_TYPE = "forgerie.issue-proposal-outcome";
const LegacyIssueProposalOutcomeSchema = Type.Union([
  Type.Object({ state: Type.Literal("created"), number: Type.Integer({ minimum: 1 }), title: Type.String(), url: Type.String() }),
  Type.Object({ state: Type.Literal("dismissed") }),
]);
const LegacyIssueProposalSchema = Type.Object({
  proposalId: Type.String({ minLength: 1 }), repo: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1, maxLength: 256 }), body: Type.String({ maxLength: 65_000 }),
  labels: Type.Array(Type.String({ minLength: 1, maxLength: 50 }), { maxItems: 20 }),
  outcome: Type.Optional(LegacyIssueProposalOutcomeSchema),
});
export const LegacyIssueProposalRecordSchema = Type.Object({ proposal: LegacyIssueProposalSchema, targetCwd: Type.String({ minLength: 1 }) });
export type LegacyIssueProposalRecord = Static<typeof LegacyIssueProposalRecordSchema>;
export const LegacyIssueProposalDecisionSchema = Type.Object({ proposalId: Type.String({ minLength: 1 }), outcome: LegacyIssueProposalOutcomeSchema });
export type LegacyIssueProposalDecision = Static<typeof LegacyIssueProposalDecisionSchema>;
export function readLegacyIssueEntry(customType: unknown, details: unknown): LegacyIssueProposalRecord | LegacyIssueProposalDecision | undefined {
  if (customType === ISSUE_PROPOSAL_TYPE && Check(LegacyIssueProposalRecordSchema, details)) return details;
  if (customType === ISSUE_PROPOSAL_OUTCOME_TYPE && Check(LegacyIssueProposalDecisionSchema, details)) return details;
  return undefined;
}
