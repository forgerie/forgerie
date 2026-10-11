import { randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import { ISSUE_PROPOSAL_TYPE, ISSUE_PROPOSAL_OUTCOME_TYPE, IssueProposalRecordSchema, IssueProposalDecisionSchema,
  type IssueProposal, type IssueProposalInput, type IssueProposalOutcome, type IssueProposalRecord } from "../../shared/issueProposals.js";

/** Replay only the current branch. The lock below owns ordering, never proposal state. */
export function issueProposalsFromBranch(branch: readonly unknown[]): Map<string, IssueProposalRecord> {
  const proposals = new Map<string, IssueProposalRecord>();
  for (const entry of branch) {
    if (typeof entry !== "object" || entry === null || !("type" in entry) || entry.type !== "custom_message" || !("details" in entry) || !("customType" in entry)) continue;
    if (entry.customType === ISSUE_PROPOSAL_TYPE && Check(IssueProposalRecordSchema, entry.details)) {
      proposals.set(entry.details.proposal.proposalId, structuredClone(entry.details));
    } else if (entry.customType === ISSUE_PROPOSAL_OUTCOME_TYPE && Check(IssueProposalDecisionSchema, entry.details)) {
      const record = proposals.get(entry.details.proposalId);
      if (record !== undefined && record.proposal.outcome === undefined) record.proposal.outcome = structuredClone(entry.details.outcome);
    }
  }
  return proposals;
}

export class IssueProposalError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export interface IssueProposalSession {
  id: string;
  branch(): readonly unknown[];
  /** Persists a custom message and publishes it without starting a turn. */
  append(message: { customType: string; content: string; details: unknown }): Promise<void>;
}
export type IssueProposalDecisionResult =
  | { status: "not-found" }
  | { status: "already-decided"; outcome: IssueProposalOutcome }
  | { status: "decided"; outcome: IssueProposalOutcome };

export class IssueProposals {
  private readonly decisions = new Map<string, Promise<unknown>>();
  constructor(private readonly deps: {
    prepare(cwd: string, input: IssueProposalInput): Promise<string>;
    create(repo: string, sessionId: string, input: IssueProposalInput): Promise<Extract<IssueProposalOutcome, { state: "created" }>>;
    id?: () => string;
  }) {}

  async propose(session: IssueProposalSession, targetCwd: string, input: IssueProposalInput): Promise<IssueProposal> {
    const repo = await this.deps.prepare(targetCwd, input);
    const proposal: IssueProposal = { proposalId: (this.deps.id ?? randomUUID)(), repo, title: input.title, body: input.body, labels: [...input.labels ?? []] };
    await session.append({ customType: ISSUE_PROPOSAL_TYPE, content: `Proposed issue ${proposal.proposalId} on ${repo}: ${input.title}. The user decides whether to create it.`, details: { proposal, targetCwd } });
    return proposal;
  }

  async decide(session: IssueProposalSession, proposalId: string, decision: "create" | "dismiss"): Promise<IssueProposalDecisionResult> {
    const key = `${session.id}:${proposalId}`;
    const previous = this.decisions.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async (): Promise<IssueProposalDecisionResult> => {
      const record = issueProposalsFromBranch(session.branch()).get(proposalId);
      if (record === undefined) return { status: "not-found" };
      if (record.proposal.outcome !== undefined) return { status: "already-decided", outcome: record.proposal.outcome };
      const { proposal } = record;
      let outcome: IssueProposalOutcome = { state: "dismissed" };
      if (decision === "create") {
        try { outcome = await this.deps.create(proposal.repo, session.id, { title: proposal.title, body: proposal.body, labels: proposal.labels }); }
        catch (error) { throw new IssueProposalError(502, error instanceof Error ? error.message : String(error)); }
      }
      const content = outcome.state === "created"
        ? `The user created issue #${String(outcome.number)} from proposal ${proposalId}: ${outcome.url}`
        : `The user dismissed issue proposal ${proposalId}`;
      await session.append({ customType: ISSUE_PROPOSAL_OUTCOME_TYPE, content, details: { proposalId, outcome } });
      return { status: "decided", outcome };
    });
    this.decisions.set(key, operation);
    try { return await operation; }
    finally { if (this.decisions.get(key) === operation) this.decisions.delete(key); }
  }
}
