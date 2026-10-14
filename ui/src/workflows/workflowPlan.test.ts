import { describe, expect, it } from "vitest";
import { planDocument, planOf, planTitle } from "./workflowPlan";
import { PROPOSAL_STAGES, PROSE_PROPOSAL } from "./fixtures/proposals";
import { RICH_TEXT } from "./fixtures/sheet";

describe("a workflow's plan", () => {
  it("splits the prose at its top-level headings and ties each section to the stage it names", () => {
    const plan = planOf(RICH_TEXT, PROPOSAL_STAGES);
    expect(plan.overview).toMatch(/^The settings page fetches each setting on its own\./u);
    expect(plan.overview).not.toContain("description:");
    expect(plan.sections.map((section) => [section.stage, section.title])).toEqual([
      ["shape", "Shape"], ["port", "Port the API and the page"], ["review", "Review"], ["land", "Land"]]);
    expect(plan.sections[1]?.body).toContain("```files");
  });

  it("names a stage by its id, its name, or \"Stage: id\", keeps the rest of the heading, and leaves other sections unlinked", () => {
    const plan = planDocument("# Stage: port (two branches)\nBoth at once.\n# review\nA fresh pair of eyes.\n# Notes\nNothing else.", PROPOSAL_STAGES);
    expect(plan.sections.map((section) => [section.stage, section.title])).toEqual([
      ["port", "Port the API and the page (two branches)"], ["review", "Review"], [undefined, "Notes"]]);
  });

  it("moves deeper headings up under the section's own, and ignores a heading inside a code fence", () => {
    const plan = planDocument("# Shape\n## Inputs\nText.\n```md\n# not a heading\n```\n### Detail\nMore.", PROPOSAL_STAGES);
    expect(plan.sections).toHaveLength(1);
    expect(plan.sections[0]?.body).toBe("### Inputs\nText.\n```md\n# not a heading\n```\n#### Detail\nMore.");
  });

  it("reads prose without headings as all overview", () => {
    expect(planOf(PROSE_PROPOSAL.text, [])).toEqual({ overview: PROSE_PROPOSAL.text, sections: [] });
  });

  it("titles the sheet with a short description, and with the name otherwise", () => {
    expect(planTitle(RICH_TEXT, "settings-store-port")).toBe("Port settings to the shared store");
    expect(planTitle(`---\ndescription: "${"a".repeat(91)}"\n---\nText`, "long")).toBe("long");
    expect(planTitle("No frontmatter.", "plain")).toBe("plain");
  });
});
