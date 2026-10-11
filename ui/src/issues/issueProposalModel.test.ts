import { describe, expect, it } from "vitest";
import { convertMessage, fromHistory, markPosition, reduceEvent, seedTranscript, threadMessageIdAt } from "../transcript";
import { issueProposalOf } from "./issueProposalModel";
import type { PiMessage } from "../contracts";

const proposal = { proposalId: "p1", repo: "owner/repo", title: "Fix", body: "Details", labels: ["bug"] };
const offered: PiMessage = { role: "custom", customType: "forgerie.issue-proposal", content: "Proposed issue", details: { proposal }, timestamp: 1 };
const outcome = { state: "created" as const, number: 38, title: "Fix", url: "https://github.com/owner/repo/issues/38" };
const decided: PiMessage = { role: "custom", customType: "forgerie.issue-proposal-outcome", content: "Created", details: { proposalId: "p1", outcome }, timestamp: 2 };

describe("issue proposal transcript", () => {
  it("carries an open proposal artifact on one system row", () => {
    expect(issueProposalOf(offered)).toEqual(proposal);
    const transcript = fromHistory([offered]);
    expect(transcript.messages).toHaveLength(1);
    expect(convertMessage(transcript.messages[0]!)).toMatchObject({ role: "system", metadata: { custom: { issueProposal: proposal } } });
  });
  it("folds the decision into the proposal without adding a row, live and on reload", () => {
    const history = fromHistory([offered, decided]);
    const live = reduceEvent(fromHistory([offered]), { type: "message.end", message: decided });
    for (const transcript of [history, live]) {
      expect(transcript.messages).toHaveLength(1);
      expect(convertMessage(transcript.messages[0]!).metadata?.custom).toEqual({ issueProposal: { ...proposal, outcome } });
    }
    expect(fromHistory([offered]).messages[0]?.issueProposal?.outcome).toBeUndefined();
    expect(fromHistory([decided]).messages).toHaveLength(0);
  });
  it("keeps one decided row when a join replays the proposal event after loading history", () => {
    const transcript = seedTranscript([{ ...offered, timestamp: undefined }, { ...decided, timestamp: undefined }], null, 4, false,
      [{ type: "message.end", seq: 3, message: offered }, { type: "message.end", seq: 4, message: decided }]);
    expect(transcript.messages).toHaveLength(1);
    expect(transcript.messages[0]?.issueProposal?.outcome).toEqual(outcome);
  });
  it("keeps search positions and marked metadata when an outcome folds into its proposal", () => {
    const transcript = fromHistory([{ role: "user", content: "Find this defect" }, offered, decided, { role: "assistant", content: "I kept working" }]);
    expect(transcript.messages.map((message) => message.position)).toEqual([0, 1, 3]);
    expect(threadMessageIdAt(transcript.messages, 3)).toBe("history-3");
    expect(threadMessageIdAt(transcript.messages, 2)).toBeUndefined();
    const marked = markPosition(transcript.messages, 1);
    expect(convertMessage(marked[1]!).metadata?.custom).toEqual({ issueProposal: { ...proposal, outcome }, marked: true });
    const live = reduceEvent({ ...fromHistory([offered]), messages: markPosition(fromHistory([offered]).messages, 0) }, { type: "message.end", message: decided });
    expect(live.messages[0]).toMatchObject({ position: 0, marked: true, issueProposal: { ...proposal, outcome } });
  });
  it("rejects malformed proposal data", () => {
    expect(issueProposalOf({ ...offered, details: { proposal: { ...proposal, title: "" } } })).toBeUndefined();
  });
});
