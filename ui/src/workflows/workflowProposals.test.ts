import { describe, expect, it } from "vitest";
import { proposalGlance, proposalLaunchInputs, proposalInputs, proposalIsOpen, proposalOutcome, proseOf, workflowEntryOf, workflowProposalsSchema } from "./workflowsModel";
import { CHANGES_PROPOSAL, DISMISSED_PROPOSAL, PROPOSAL, PROPOSAL_STAGES, PROSE_PROPOSAL, REPLACED_PROPOSAL, STARTED_PROPOSAL } from "./fixtures/proposals";
import { STAGES } from "./fixtures/runs";

describe("a workflow proposal from the server", () => {
  it("parses every state, and refuses a record without its definition or with an unknown state", () => {
    const list = [PROPOSAL, STARTED_PROPOSAL, CHANGES_PROPOSAL, DISMISSED_PROPOSAL, REPLACED_PROPOSAL, PROSE_PROPOSAL];
    expect(workflowProposalsSchema.parse(JSON.parse(JSON.stringify(list)))).toEqual(list);
    expect(workflowProposalsSchema.safeParse([{ ...PROPOSAL, definition: undefined }]).success).toBe(false);
    expect(workflowProposalsSchema.safeParse([{ ...PROPOSAL, state: { kind: "approved" } }]).success).toBe(false);
    expect(workflowProposalsSchema.safeParse([{ ...PROPOSAL, definition: { version: 2 } }]).success).toBe(false);
  });
});

describe("a proposal in the transcript", () => {
  const message = (details: unknown) => ({ role: "custom" as const, customType: "forgerie.workflow-proposal", content: "", details });
  it("reads the card from the entry alone", () => {
    expect(workflowEntryOf(message({ proposalId: "wp-1", name: "port", summary: "Port it.", stages: PROPOSAL_STAGES })))
      .toEqual({ kind: "proposal", proposalId: "wp-1", name: "port", summary: "Port it.", stages: PROPOSAL_STAGES });
  });
  it("keeps the card when the stages or the summary cannot be read, and drops it without an id", () => {
    expect(workflowEntryOf(message({ proposalId: "wp-1", name: "port", stages: [{ name: "no id" }] })))
      .toEqual({ kind: "proposal", proposalId: "wp-1", name: "port", summary: "", stages: [] });
    expect(workflowEntryOf(message({ name: "port" }))).toBeUndefined();
    expect(workflowEntryOf({ role: "custom", customType: "forgerie.issue-proposal", content: "", details: { proposalId: "wp-1", name: "x" } })).toBeUndefined();
  });
});

describe("a proposal at a glance", () => {
  it("counts stages, distinct workers by name, and stops", () => {
    expect(proposalGlance(PROPOSAL_STAGES)).toBe("4 stages · 3 workers · 2 stops");
    expect(proposalGlance(STAGES)).toBe("4 stages · 3 workers · 2 stops");
    // The same worker in two stages counts once.
    expect(proposalGlance([{ id: "a", name: "A", workers: [{ name: "w" }] }, { id: "b", name: "B", workers: [{ name: "w" }], stop: "approve" }]))
      .toBe("2 stages · 1 worker · 1 stop");
    expect(proposalGlance([{ id: "a", name: "A" }])).toBe("1 stage");
    expect(proposalGlance([])).toBe("Prose only, no stages");
  });
});

describe("a proposal card's state", () => {
  it("stays open until the records say otherwise", () => {
    expect(proposalIsOpen(undefined, false)).toBe(true);
    expect(proposalIsOpen(undefined, true)).toBe(false);
    expect(proposalIsOpen(PROPOSAL, true)).toBe(true);
    expect(proposalIsOpen(STARTED_PROPOSAL, false)).toBe(false);
  });
  it("says what became of it", () => {
    expect(proposalOutcome(STARTED_PROPOSAL)).toBe("Started");
    expect(proposalOutcome(CHANGES_PROPOSAL)).toBe(`You asked for changes: ${CHANGES_PROPOSAL.state.kind === "changes" ? CHANGES_PROPOSAL.state.note : ""}`);
    expect(proposalOutcome(DISMISSED_PROPOSAL)).toBe("Dismissed");
    expect(proposalOutcome(REPLACED_PROPOSAL)).toBe("Replaced by a newer proposal");
    expect(proposalOutcome(undefined)).toContain("no longer");
  });
});

describe("a proposal's inputs", () => {
  it("puts the task first, starts at the agent's values, then the defaults", () => {
    const { inputs, values } = proposalInputs({ ...PROPOSAL, definition: { version: 1, inputs: { rounds: { type: "number", default: 2 }, task: { type: "string" }, base: { type: "string", default: "main" } } },
      inputs: { task: "Port it.", rounds: 3 } });
    expect(inputs.map(([name]) => name)).toEqual(["task", "rounds", "base"]);
    expect(values).toEqual({ task: "Port it.", rounds: "3", base: "main" });
  });
  it("shows a value the agent filled that the definition does not declare, typed by its value", () => {
    const { inputs, values } = proposalInputs({ definition: { version: 1 }, inputs: { careful: true, task: "Find the flake." } });
    expect(inputs).toEqual([["task", { type: "string" }], ["careful", { type: "boolean" }]]);
    expect(values).toEqual({ task: "Find the flake.", careful: "true" });
    expect(proposalLaunchInputs(inputs, { ...values, careful: "false" }, new Set(["task", "careful"]))).toEqual({ inputs: { task: "Find the flake.", careful: false } });
  });
});

describe("the inputs a proposal starts with", () => {
  const SUFFIX = ["suffix", { type: "string" }] as const;
  const WITH_DEFAULT = ["suffix", { type: "string", default: ".ts" }] as const;
  it("sends an empty string the agent filled, though the input has no default", () => {
    expect(proposalLaunchInputs([SUFFIX], { suffix: "" }, new Set(["suffix"]))).toEqual({ inputs: { suffix: "" } });
  });
  it("sends an empty string the reader left in place of a default, and leaves an untouched input to its default", () => {
    expect(proposalLaunchInputs([WITH_DEFAULT], { suffix: "" }, new Set(["suffix"]))).toEqual({ inputs: { suffix: "" } });
    expect(proposalLaunchInputs([WITH_DEFAULT], { suffix: ".ts" }, new Set())).toEqual({ inputs: {} });
  });
  it("asks for an input with no value and no default, and refuses a number that is not one", () => {
    expect(proposalLaunchInputs([SUFFIX], { suffix: "" }, new Set())).toEqual({ problem: "Fill in suffix." });
    expect(proposalLaunchInputs([["rounds", { type: "number", default: 2 }]], { rounds: "" }, new Set(["rounds"]))).toEqual({ problem: "rounds must be a number." });
    expect(proposalLaunchInputs([["rounds", { type: "number" }]], { rounds: "3" }, new Set(["rounds"]))).toEqual({ inputs: { rounds: 3 } });
  });
});

describe("a proposal's instructions", () => {
  it("drop the frontmatter and keep the prose", () => {
    expect(proseOf(PROPOSAL.text).startsWith("# Port settings to the shared store")).toBe(true);
    expect(proseOf("No frontmatter here.\n\n---\n\nA rule.")).toBe("No frontmatter here.\n\n---\n\nA rule.");
  });
});
