import { describe, expect, it } from "vitest";
import { DUPLICATE, FAILED, FAILED_ACT, FAILED_FINAL, FILED, FILING, OPEN, OPEN_GITHUB, DISMISSED, suggestion } from "../backlog/suggestions/fixtures/suggestions";
import { PROPOSAL, PROPOSAL_ENTRY, STARTED_PROPOSAL } from "../workflows/fixtures/proposals";
import { batchOf, gistOf, heldProposals, heldSuggestion, leftOutWords, proposalNoun } from "./proposalLedge";

const quiet = { pending: {}, problems: {}, last: {}, drafts: {} };

describe("what waits in the ledge", () => {
  it("lists open suggestions and open workflow proposals, newest first, and nothing filed, started or decided", () => {
    const newer = suggestion("sg-newer", { createdAt: "2026-10-28T10:00:00Z" });
    const held = heldProposals({ suggestions: [OPEN, FILED, DISMISSED, newer], view: quiet,
      messages: [{ workflowEntry: PROPOSAL_ENTRY }, { workflowEntry: PROPOSAL_ENTRY }, {}], proposals: [PROPOSAL] });
    expect(held.map((proposal) => proposal.key)).toEqual(["b:sg-newer", "b:sg-open", `p:${PROPOSAL.id}`]);
  });

  it("holds a workflow proposal only once the records say it is open", () => {
    const messages = [{ workflowEntry: PROPOSAL_ENTRY }];
    expect(heldProposals({ suggestions: [], view: quiet, messages, proposals: undefined })).toEqual([]);
    expect(heldProposals({ suggestions: [], view: quiet, messages, proposals: [STARTED_PROPOSAL] })).toEqual([]);
    expect(heldProposals({ suggestions: [], view: quiet, messages, proposals: [PROPOSAL], proposing: { id: PROPOSAL.id, action: "dismiss" } }))
      .toEqual([expect.objectContaining({ type: "workflow", title: PROPOSAL.name, status: "Dismissing…" })]);
  });

  it("names the kind by where it goes", () => {
    expect([heldSuggestion(OPEN, quiet).kind, heldSuggestion(OPEN_GITHUB, quiet).kind]).toEqual(["Backlog", "Issue"]);
  });

  it("says what is in flight", () => {
    expect(heldSuggestion(FILING, quiet).status).toBe("Filing…");
    expect(heldSuggestion(OPEN, { ...quiet, pending: { [OPEN.id]: "file-and-act" } }).status).toBe("Filing and starting…");
    expect(heldSuggestion(OPEN, { ...quiet, pending: { [OPEN.id]: "dismiss" } })).toEqual(expect.objectContaining({ status: "Dismissing…", busy: true }));
  });

  it("offers Retry for what failed, repeating the action that failed, and none when it cannot be retried", () => {
    expect(heldSuggestion(FAILED, quiet)).toEqual(expect.objectContaining({ retry: "file", problem: expect.stringContaining("502") }));
    expect(heldSuggestion(FAILED_ACT, quiet).retry).toBe("file-and-act");
    expect(heldSuggestion(FAILED_FINAL, quiet)).toEqual(expect.objectContaining({ retry: undefined, offer: false }));
    // A press that failed while the record stayed open retries that press.
    expect(heldSuggestion(OPEN, { ...quiet, problems: { [OPEN.id]: "Offline." }, last: { [OPEN.id]: "file-and-act" } }))
      .toEqual(expect.objectContaining({ retry: "file-and-act", problem: "Offline." }));
  });

  it("sends a duplicate to its card, where the matches show", () => {
    expect(heldSuggestion(DUPLICATE, quiet)).toEqual(expect.objectContaining({ duplicate: true, offer: false }));
  });

  it("uses the reader's draft for the title", () => {
    expect(heldSuggestion(OPEN, { ...quiet, drafts: { [OPEN.id]: { title: "Retry once", body: "" } } }).title).toBe("Retry once");
  });
});

describe("what the All menu acts on", () => {
  it("takes the ready suggestions, newest first, and counts what it leaves out and why", () => {
    const newer = suggestion("sg-newer", { createdAt: "2026-10-28T10:00:00Z" });
    const held = [...heldProposals({ suggestions: [OPEN, newer, DUPLICATE, FAILED, FAILED_FINAL], view: quiet,
      messages: [{ workflowEntry: PROPOSAL_ENTRY }], proposals: [PROPOSAL] }), heldSuggestion(OPEN_GITHUB, { ...quiet, pending: { [OPEN_GITHUB.id]: "file" } }), heldSuggestion(FILING, quiet)];
    const batch = batchOf(held);
    expect(batch).toEqual({ ids: ["sg-newer", OPEN.id], leftOut: { review: 1, failed: 2, filing: 2 } });
    expect(leftOutWords(batch)).toBe("Leaves out 5: 1 to review, 2 failed, 2 filing");
  });

  it("says nothing about a workflow, and nothing when it leaves nothing out", () => {
    const batch = batchOf(heldProposals({ suggestions: [OPEN], view: quiet, messages: [{ workflowEntry: PROPOSAL_ENTRY }], proposals: [PROPOSAL] }));
    expect(batch).toEqual({ ids: [OPEN.id], leftOut: { review: 0, failed: 0, filing: 0 } });
    expect(leftOutWords(batch)).toBeUndefined();
  });
});

describe("the words", () => {
  it("cuts a body to its first line, without Markdown's marks", () => {
    expect(gistOf("\n## Why\nmore")).toBe("Why");
    expect(gistOf("- one\n- two")).toBe("one");
    expect(gistOf("")).toBe("");
  });
  it("counts proposals", () => {
    expect([proposalNoun(1), proposalNoun(2)]).toEqual(["proposal", "proposals"]);
  });
});
