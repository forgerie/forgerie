import { describe, expect, it } from "vitest";
import { matchesWorkflow, routeOf, routeSummary, workflowSource } from "./workflowPickerModel";
import { SAVED } from "./fixtures/runs";

const designBuildReview = SAVED[0]!;
const prose = SAVED[1]!;

describe("the workflow picker", () => {
  it("tells project files from profile files by the folder the server reads", () => {
    expect(workflowSource("/code/forgerie/.pi/prompts/pr-first.md")).toBe("project");
    expect(workflowSource("/home/me/.pi/agent/prompts/nightly-refine.md")).toBe("profile");
    expect(workflowSource("/home/me/.local/share/forgerie/agent/prompts/nightly-retro.md")).toBe("profile");
  });

  it("draws each stage with its agents and its stop", () => {
    const route = routeOf(designBuildReview);
    expect(route.length).toBeGreaterThan(0);
    expect(route.some((stage) => stage.stop)).toBe(true);
    expect(routeOf(prose)).toEqual([]);
  });

  it("sums a route in words", () => {
    expect(routeSummary([{ name: "Contract", agents: 0, stop: true }, { name: "Build", agents: 2, stop: false }, { name: "Land", agents: 0, stop: true }]))
      .toBe("3 stages, 2 agents, you decide at 2");
    expect(routeSummary([{ name: "Refine", agents: 1, stop: false }])).toBe("1 stage, 1 agent");
    expect(routeSummary([])).toBe("Prose only, no stages");
  });

  it("filters by name, description, or stage, ignoring case", () => {
    expect(matchesWorkflow(designBuildReview, "DESIGN")).toBe(true);
    expect(matchesWorkflow(designBuildReview, routeOf(designBuildReview)[0]!.name.toLowerCase())).toBe(true);
    expect(matchesWorkflow(prose, "researchers")).toBe(true);
    expect(matchesWorkflow(prose, "contract")).toBe(false);
    expect(matchesWorkflow(prose, "  ")).toBe(true);
  });
});
