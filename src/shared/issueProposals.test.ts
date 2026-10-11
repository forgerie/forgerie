import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { IssueProposalInputSchema, IssueProposalOutcomeSchema, IssueProposalRouteBodySchema } from "./issueProposals.js";

describe("issue proposal contracts", () => {
  it("bounds the title, Markdown body, and existing-label list", () => {
    const input = { title: "x".repeat(256), body: "x".repeat(65_000), labels: Array.from({ length: 20 }, () => "x".repeat(50)) };
    expect(Check(IssueProposalInputSchema, input)).toBe(true);
    expect(Check(IssueProposalInputSchema, { title: "Fix", body: "" })).toBe(true);
    for (const invalid of [{ ...input, title: "" }, { ...input, title: "x".repeat(257) }, { ...input, body: "x".repeat(65_001) },
      { ...input, labels: [""] }, { ...input, labels: ["x".repeat(51)] }, { ...input, labels: [...input.labels, "extra"] }, { title: "Fix" }]) {
      expect(Check(IssueProposalInputSchema, invalid)).toBe(false);
    }
  });
  it("accepts only supported outcomes and a cwd-only route body", () => {
    expect(Check(IssueProposalOutcomeSchema, { state: "created", number: 38, title: "Fix", url: "https://github.com/o/r/issues/38" })).toBe(true);
    expect(Check(IssueProposalOutcomeSchema, { state: "dismissed" })).toBe(true);
    expect(Check(IssueProposalOutcomeSchema, { state: "failed", error: "Unavailable" })).toBe(false);
    expect(Check(IssueProposalRouteBodySchema, { cwd: "/repo" })).toBe(true);
    expect(Check(IssueProposalRouteBodySchema, { cwd: "/repo", title: "Changed" })).toBe(false);
  });
});
