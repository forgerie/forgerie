import { Type, type Static } from "typebox";

export const ISSUE_PROPOSAL_TYPE = "forgerie.issue-proposal";
export const ISSUE_PROPOSAL_OUTCOME_TYPE = "forgerie.issue-proposal-outcome";
export const IssueProposalInputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 256 }),
  body: Type.String({ maxLength: 65_000 }),
  labels: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 50 }), { maxItems: 20 })),
}, { additionalProperties: false });
export type IssueProposalInput = Static<typeof IssueProposalInputSchema>;
export const IssueProposalOutcomeSchema = Type.Union([
  Type.Object({ state: Type.Literal("created"), number: Type.Integer({ minimum: 1 }), title: Type.String(), url: Type.String() }),
  Type.Object({ state: Type.Literal("dismissed") }),
]);
export type IssueProposalOutcome = Static<typeof IssueProposalOutcomeSchema>;
export const IssueProposalSchema = Type.Object({
  proposalId: Type.String({ minLength: 1 }), repo: Type.String({ minLength: 1 }),
  title: IssueProposalInputSchema.properties.title, body: IssueProposalInputSchema.properties.body,
  labels: Type.Array(Type.String({ minLength: 1, maxLength: 50 }), { maxItems: 20 }),
  outcome: Type.Optional(IssueProposalOutcomeSchema),
});
export type IssueProposal = Static<typeof IssueProposalSchema>;
export const IssueProposalRecordSchema = Type.Object({ proposal: IssueProposalSchema, targetCwd: Type.String({ minLength: 1 }) });
export type IssueProposalRecord = Static<typeof IssueProposalRecordSchema>;
export const IssueProposalDecisionSchema = Type.Object({ proposalId: Type.String({ minLength: 1 }), outcome: IssueProposalOutcomeSchema });
export const IssueProposalRouteBodySchema = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });
