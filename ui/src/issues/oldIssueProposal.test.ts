import { describe, expect, it } from "vitest";
import { convertMessage, fromHistory, markPosition, reduceEvent, seedTranscript, threadMessageIdAt } from "../transcript";
import { oldIssueOutcomeOf, oldIssueProposalOf } from "./oldIssueProposal";
import type { PiMessage } from "../contracts";

// The two entries exactly as the removed proposal tool wrote them.
const proposal = { proposalId: "p1", repo: "owner/repo", title: "Fix the draft loss", body: "Details", labels: ["bug"] };
const offered: PiMessage = { role: "custom", customType: "forgerie.issue-proposal",
  content: "Proposed issue p1 on owner/repo: Fix the draft loss. The user decides whether to create it.", details: { proposal, targetCwd: "/srv/repo" }, timestamp: 1 };
const created = { state: "created" as const, number: 38, title: "Fix the draft loss", url: "https://github.com/owner/repo/issues/38" };
const decided: PiMessage = { role: "custom", customType: "forgerie.issue-proposal-outcome", content: "Created #38", details: { proposalId: "p1", outcome: created }, timestamp: 2 };
const dismissed: PiMessage = { ...decided, content: "Dismissed", details: { proposalId: "p1", outcome: { state: "dismissed" } } };
const shown = { proposalId: "p1", title: "Fix the draft loss" };
const createdLine = { ...shown, outcome: { state: "created", number: 38, url: created.url } };
const custom = (message: PiMessage) => convertMessage(fromHistory([message]).messages[0]!).metadata?.custom;

describe("old issue proposal entries", () => {
  it("reads a proposal with no outcome as one system row naming its title", () => {
    expect(oldIssueProposalOf(offered)).toEqual(shown);
    const transcript = fromHistory([offered]);
    expect(transcript.messages).toHaveLength(1);
    expect(convertMessage(transcript.messages[0]!)).toMatchObject({ role: "system", metadata: { custom: { oldIssueProposal: shown } } });
  });

  it("folds a created or a dismissed outcome into its proposal, on reload and live, without a row of its own", () => {
    for (const [outcome, line] of [[decided, createdLine], [dismissed, { ...shown, outcome: { state: "dismissed" } }]] as const) {
      const history = fromHistory([offered, outcome]);
      const live = reduceEvent(fromHistory([offered]), { type: "message.end", message: outcome });
      for (const transcript of [history, live]) {
        expect(transcript.messages).toHaveLength(1);
        expect(convertMessage(transcript.messages[0]!).metadata?.custom).toEqual({ oldIssueProposal: line });
      }
    }
  });

  it("renders an outcome entry as nothing, even with no proposal or unreadable details", () => {
    expect(fromHistory([decided]).messages).toHaveLength(0);
    for (const details of [null, "x", {}, { proposalId: "p1" }, { proposalId: "p1", outcome: { state: "merged" } }, { proposalId: 1, outcome: created }]) {
      const outcome = { ...decided, details };
      expect(fromHistory([outcome]).messages).toHaveLength(0);
      expect(fromHistory([offered, outcome]).messages[0]?.oldIssueProposal).toEqual(shown);
      expect(oldIssueOutcomeOf(outcome)).toBeUndefined();
    }
  });

  it("folds only the outcome with the proposal's id, and keeps the first outcome on the branch", () => {
    const other = { ...decided, details: { proposalId: "p2", outcome: created } };
    expect(fromHistory([offered, other]).messages[0]?.oldIssueProposal).toEqual(shown);
    expect(fromHistory([offered, decided, dismissed]).messages[0]?.oldIssueProposal).toEqual(createdLine);
  });

  it("reads each field on its own, so a malformed field costs only itself", () => {
    const withDetails = (details: unknown): PiMessage => ({ ...offered, details });
    // The details name no title: the text the server wrote beside them does.
    expect(oldIssueProposalOf(withDetails(null))).toEqual(shown);
    expect(oldIssueProposalOf(withDetails("broken"))).toEqual(shown);
    expect(oldIssueProposalOf(withDetails({ proposal: { ...proposal, title: 7 } }))).toEqual(shown);
    expect(oldIssueProposalOf(withDetails({ proposal: { ...proposal, title: "  " } }))).toEqual(shown);
    // Neither names one: the line still says a proposal was here.
    expect(oldIssueProposalOf({ role: "custom", customType: "forgerie.issue-proposal", content: "", details: null })).toEqual({});
    expect(oldIssueProposalOf({ role: "custom", customType: "forgerie.issue-proposal", content: [{ type: "image" }], details: [1, 2] })).toEqual({});
    // A broken outcome inside the proposal is dropped; a created one without a web address keeps its number.
    expect(oldIssueProposalOf(withDetails({ proposal: { ...proposal, outcome: { state: "created", number: -1 } } }))).toEqual(shown);
    for (const url of ["javascript:alert(1)", "not a url", 38, undefined]) {
      expect(oldIssueProposalOf(withDetails({ proposal: { ...proposal, outcome: { ...created, url } } })))
        .toEqual({ ...shown, outcome: { state: "created", number: 38 } });
    }
    expect(oldIssueProposalOf(withDetails({ proposal: { ...proposal, outcome: created } }))).toEqual(createdLine);
  });

  it("does not read other entries as old proposals", () => {
    expect(oldIssueProposalOf({ role: "custom", customType: "forgerie.workflow-proposal", content: "", details: { proposal } })).toBeUndefined();
    expect(oldIssueProposalOf({ role: "user", content: offered.content as string })).toBeUndefined();
    expect(oldIssueOutcomeOf(offered)).toBeUndefined();
  });

  it("keeps one row when a join replays the proposal event after loading history", () => {
    const transcript = seedTranscript([{ ...offered, timestamp: undefined }, { ...decided, timestamp: undefined }], null, 4, false,
      [{ type: "message.end", seq: 3, message: offered }, { type: "message.end", seq: 4, message: decided }]);
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0]?.oldIssueProposal).toEqual(createdLine);
  });

  it("keeps search positions and marked metadata when an outcome folds into its proposal", () => {
    const transcript = fromHistory([{ role: "user", content: "Find this defect" }, offered, decided, { role: "assistant", content: "I kept working" }]);
    expect(transcript.messages.map((message) => message.position)).toEqual([0, 1, 3]);
    expect(threadMessageIdAt(transcript.messages, 3)).toBe("history-3");
    expect(threadMessageIdAt(transcript.messages, 2)).toBeUndefined();
    expect(convertMessage(markPosition(transcript.messages, 1)[1]!).metadata?.custom).toEqual({ oldIssueProposal: createdLine, marked: true });
  });

  it("never crashes the transcript on any details", () => {
    for (const details of [undefined, null, 0, "", [], {}, { proposal: null }, { proposal: [] }, { proposal: { outcome: "created" } }]) {
      expect(custom({ ...offered, content: "", details })).toEqual({ oldIssueProposal: {} });
    }
  });
});
