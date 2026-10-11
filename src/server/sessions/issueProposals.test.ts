import { describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ISSUE_PROPOSAL_TYPE, ISSUE_PROPOSAL_OUTCOME_TYPE } from "../../shared/issueProposals.js";
import { issueProposalsFromBranch, IssueProposals } from "./issueProposals.js";

const proposal = { proposalId: "p1", repo: "owner/repo", title: "Fix", body: "Details", labels: ["bug"] };
const created = { state: "created" as const, number: 38, title: "Fix", url: "https://github.com/owner/repo/issues/38" };

describe("branch-owned issue proposals", () => {
  it("projects outcomes only on the branch that contains them", () => {
    const manager = SessionManager.inMemory("/repo");
    const offered = manager.appendCustomMessageEntry(ISSUE_PROPOSAL_TYPE, "Proposal", true, { proposal, targetCwd: "/repo" });
    manager.appendCustomMessageEntry(ISSUE_PROPOSAL_OUTCOME_TYPE, "Created", true, { proposalId: "p1", outcome: created });
    expect(issueProposalsFromBranch(manager.getBranch()).get("p1")?.proposal.outcome).toEqual(created);
    manager.branch(offered);
    expect(issueProposalsFromBranch(manager.getBranch()).get("p1")?.proposal).toEqual(proposal);
    manager.appendCustomMessageEntry(ISSUE_PROPOSAL_OUTCOME_TYPE, "Dismissed", true, { proposalId: "p1", outcome: { state: "dismissed" } });
    expect(issueProposalsFromBranch(manager.getBranch()).get("p1")?.proposal.outcome).toEqual({ state: "dismissed" });
    manager.resetLeaf();
    expect(issueProposalsFromBranch(manager.getBranch()).size).toBe(0);
  });

  it("serializes create against another create and dismiss, using the saved outcome", async () => {
    const manager = SessionManager.inMemory("/repo");
    manager.appendCustomMessageEntry(ISSUE_PROPOSAL_TYPE, "Proposal", true, { proposal, targetCwd: "/repo" });
    let calls = 0;
    const proposals = new IssueProposals({
      prepare: () => Promise.resolve("owner/repo"),
      create: async () => { calls++; await new Promise((resolve) => setTimeout(resolve, 10)); return created; },
      id: () => "p1",
    });
    const session = { id: "s1", branch: () => manager.getBranch(), append: (message: { customType: string; content: string; details: unknown }) => { manager.appendCustomMessageEntry(message.customType, message.content, true, message.details); return Promise.resolve(); } };
    const results = await Promise.all([proposals.decide(session, "p1", "create"), proposals.decide(session, "p1", "create"), proposals.decide(session, "p1", "dismiss")]);
    expect(calls).toBe(1);
    expect(results).toEqual([{ status: "decided", outcome: created }, { status: "already-decided", outcome: created }, { status: "already-decided", outcome: created }]);
  });
});
