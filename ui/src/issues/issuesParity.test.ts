import { describe, expect, expectTypeOf, it } from "vitest";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { FileIssueResultSchema, type FileIssueResult as SharedFileIssueResult } from "@shared/fileIssues";
import {
  ISSUE_PROPOSAL_OUTCOME_TYPE, ISSUE_PROPOSAL_TYPE, LegacyIssueProposalDecisionSchema, LegacyIssueProposalRecordSchema, readLegacyIssueEntry,
  type LegacyIssueProposalDecision as SharedDecision, type LegacyIssueProposalRecord as SharedRecord,
} from "@shared/legacyIssueProposals";
import { fileIssueResultSchema, type FileIssueResult } from "./fileIssueResult";
import {
  legacyIssueProposalDecisionSchema, legacyIssueProposalRecordSchema, OLD_ISSUE_OUTCOME_TYPE, OLD_ISSUE_PROPOSAL_TYPE, oldIssueOutcomeOf, oldIssueProposalOf,
} from "./oldIssueProposal";
import type { z } from "zod";
import { DUPLICATE, FILED, LABEL_WARNING } from "./fixtures/issues";

/** Both sides must take and refuse the same values. */
function agree(name: string, zod: { safeParse: (value: unknown) => { success: boolean } }, typebox: TSchema, samples: readonly unknown[]) {
  for (const sample of samples) expect(zod.safeParse(sample).success, `${name}: ${JSON.stringify(sample)?.slice(0, 120) ?? String(sample)}`).toBe(Check(typebox, sample));
}

describe("file_issue results mirror the server's schema (src/shared/fileIssues.ts)", () => {
  it("has the server's type", () => {
    expectTypeOf<FileIssueResult>().toEqualTypeOf<SharedFileIssueResult>();
  });

  it("takes and refuses the same results", () => {
    const match = DUPLICATE.matches[0]!;
    const { agentFiled: _agentFiled, ...unlabelled } = FILED;
    void _agentFiled;
    agree("result", fileIssueResultSchema, FileIssueResultSchema, [
      FILED, { ...FILED, agentFiled: false, labelWarning: LABEL_WARNING }, DUPLICATE, { ...DUPLICATE, matches: [] }, { ...FILED, url: "" }, { ...FILED, title: "" },
      // Refused by both.
      { ...FILED, number: 0 }, { ...FILED, number: 1.5 }, { ...FILED, agentFiled: "yes" }, { ...FILED, labelWarning: 1 }, { ...FILED, url: undefined }, unlabelled,
      { ...FILED, state: "filed" }, { ...DUPLICATE, matches: [{ ...match, state: "merged" }] }, { ...DUPLICATE, matches: [{ ...match, number: -1 }] },
      { ...DUPLICATE, repo: undefined }, { ...DUPLICATE, matches: undefined }, null, "Filed", [],
    ]);
  });
});

type Strict<T> = T extends z.ZodType<infer U> ? U : never;
describe("old issue proposals mirror the server's reader (src/shared/legacyIssueProposals.ts)", () => {
  const record = { proposal: { proposalId: "p1", repo: "owner/repo", title: "Fix", body: "Details", labels: ["bug"] }, targetCwd: "/srv/repo" };
  const created = { state: "created", number: 38, title: "Fix", url: "https://github.com/owner/repo/issues/38" };
  const records: unknown[] = [
    record, { ...record, proposal: { ...record.proposal, outcome: created } }, { ...record, proposal: { ...record.proposal, outcome: { state: "dismissed" } } },
    { ...record, proposal: { ...record.proposal, labels: [] } },
    // Refused by both.
    { ...record, targetCwd: "" }, { proposal: record.proposal }, { ...record, proposal: { ...record.proposal, title: "" } },
    { ...record, proposal: { ...record.proposal, title: "x".repeat(257) } }, { ...record, proposal: { ...record.proposal, labels: [""] } },
    { ...record, proposal: { ...record.proposal, outcome: { state: "created", number: 0, title: "Fix", url: "u" } } },
    { ...record, proposal: { ...record.proposal, outcome: { state: "merged" } } }, null, "x", {},
  ];
  const decisions: unknown[] = [
    { proposalId: "p1", outcome: created }, { proposalId: "p1", outcome: { state: "dismissed" } },
    // Refused by both.
    { proposalId: "", outcome: created }, { proposalId: "p1" }, { proposalId: "p1", outcome: { ...created, url: undefined } }, { outcome: created }, null,
  ];

  it("has the server's names and types", () => {
    expect(OLD_ISSUE_PROPOSAL_TYPE).toBe(ISSUE_PROPOSAL_TYPE);
    expect(OLD_ISSUE_OUTCOME_TYPE).toBe(ISSUE_PROPOSAL_OUTCOME_TYPE);
    expectTypeOf<Strict<typeof legacyIssueProposalRecordSchema>>().toEqualTypeOf<SharedRecord>();
    expectTypeOf<Strict<typeof legacyIssueProposalDecisionSchema>>().toEqualTypeOf<SharedDecision>();
  });

  it("takes and refuses the same entries", () => {
    agree("record", legacyIssueProposalRecordSchema, LegacyIssueProposalRecordSchema, records);
    agree("decision", legacyIssueProposalDecisionSchema, LegacyIssueProposalDecisionSchema, decisions);
  });

  it("reads every entry the server reads, to the same id, title and outcome", () => {
    expect(records.filter((details) => readLegacyIssueEntry(ISSUE_PROPOSAL_TYPE, details)).length).toBe(4);
    expect(decisions.filter((details) => readLegacyIssueEntry(ISSUE_PROPOSAL_OUTCOME_TYPE, details)).length).toBe(2);
    for (const details of records) {
      const shared = readLegacyIssueEntry(ISSUE_PROPOSAL_TYPE, details) as SharedRecord | undefined;
      if (shared === undefined) continue;
      const { proposalId, title, outcome } = shared.proposal;
      expect(oldIssueProposalOf({ role: "custom", customType: ISSUE_PROPOSAL_TYPE, content: "", details })).toEqual({ proposalId, title,
        ...(outcome === undefined ? {} : { outcome: outcome.state === "dismissed" ? outcome : { state: "created", number: outcome.number, url: outcome.url } }) });
    }
    for (const details of decisions) {
      const shared = readLegacyIssueEntry(ISSUE_PROPOSAL_OUTCOME_TYPE, details) as SharedDecision | undefined;
      const ours = oldIssueOutcomeOf({ role: "custom", customType: ISSUE_PROPOSAL_OUTCOME_TYPE, content: "", details });
      // The reader is looser than the server's schema on purpose: an entry the server refuses may still fold in.
      if (shared === undefined) continue;
      expect(ours).toEqual({ proposalId: shared.proposalId,
        outcome: shared.outcome.state === "dismissed" ? shared.outcome : { state: "created", number: shared.outcome.number, url: shared.outcome.url } });
    }
  });
});
