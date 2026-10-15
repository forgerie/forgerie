// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowProposalCard } from "./WorkflowProposalCard";
import { CHANGES_PROPOSAL, DISMISSED_PROPOSAL, PROPOSAL, PROPOSAL_ENTRY, REPLACED_PROPOSAL, STARTED_PROPOSAL } from "./fixtures/proposals";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

const button = (name: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === name);
const text = () => document.body.textContent ?? "";

describe("a proposed workflow in the thread", () => {
  it("shows the name, the overview, the route at a glance, and Review while open", async () => {
    const onReview = vi.fn();
    await act(async () => root.render(<WorkflowProposalCard entry={PROPOSAL_ENTRY} proposal={PROPOSAL} read onReview={onReview} />));
    expect(text()).toContain("settings-store-port");
    expect(text()).toContain("Proposed workflow");
    expect(text()).toContain("agree the shape");
    expect(text()).toContain("4 stages · 3 workers · 2 stops");
    expect(document.querySelector(".decision-card")?.hasAttribute("data-open")).toBe(true);
    // Review is the card's one action, which a short container moves to the title line.
    expect(document.querySelector(".decision-card-action")?.textContent).toBe("Review");
    await act(async () => { button("Review")?.click(); });
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("renders open from its entry before the records arrive", async () => {
    await act(async () => root.render(<WorkflowProposalCard entry={PROPOSAL_ENTRY} read={false} onReview={() => {}} />));
    expect(button("Review")).toBeDefined();
  });

  it.each([
    [STARTED_PROPOSAL, "Started"],
    [CHANGES_PROPOSAL, "You asked for changes: Split the review in two"],
    [DISMISSED_PROPOSAL, "Dismissed"],
    [REPLACED_PROPOSAL, "Replaced by a newer proposal"],
    [{ ...PROPOSAL, state: { kind: "here" as const, decidedAt: 1 } }, "Done here, without workers"],
    [undefined, "no longer in the session's records"],
  ])("closes to one line once decided", async (proposal, line) => {
    await act(async () => root.render(<WorkflowProposalCard entry={PROPOSAL_ENTRY} proposal={proposal} read onReview={() => {}} />));
    expect(button("Review")).toBeUndefined();
    expect(document.querySelector(".decision-card-closed")?.textContent).toContain(line);
  });

  it.each([
    [{ kind: "saved" as const, name: "design-build-review", changes: "None" }, "Based on design-build-review"],
    [{ kind: "new" as const, reason: "None fits." }, "New workflow"],
  ])("names where the proposal comes from", async (basis, kicker) => {
    await act(async () => root.render(<WorkflowProposalCard entry={{ ...PROPOSAL_ENTRY, basis }} read={false} onReview={() => {}} />));
    expect(text()).toContain(kicker);
    expect(text()).not.toContain("Proposed workflow");
  });

  it("offers no actions in a read-only transcript", async () => {
    await act(async () => root.render(<WorkflowProposalCard entry={PROPOSAL_ENTRY} proposal={PROPOSAL} read />));
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(text()).toContain("Waiting for a decision.");
  });
});
