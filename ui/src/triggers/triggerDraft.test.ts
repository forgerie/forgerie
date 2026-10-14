import { describe, expect, it } from "vitest";
import type { Trigger } from "@shared/triggers";
import { createOf, draftOf, draftProblems, emptyDraft, fieldOf, isDirty, problemList, updateOf } from "./triggerDraft";
import { CALIPER, docs, FORGERIE, HOST_ZONE, nightly, PI_MONO, triage, workflows } from "./fixtures/triggers";

const workflow = (name: string) => workflows.find((item) => item.name === name);

describe("the draft's problems", () => {
  it("names each missing choice in the page's order", () => {
    const problems = draftProblems({ ...emptyDraft(HOST_ZONE), repeat: "days", days: [] }, undefined);
    expect(problemList(problems)).toEqual(["Give the trigger a name.", "Choose at least one project, or All projects.", "Choose a workflow.", "Choose at least one day."]);
  });
  it("refuses a script workflow and an input the workflow needs", () => {
    expect(draftProblems({ ...draftOf(nightly), workflow: "nightly-report" }, workflow("nightly-report")).workflow).toMatch(/^Scripts cannot run on a schedule/);
    expect(draftProblems({ ...draftOf(nightly), inputs: { task: " " } }, workflow("refine-backlog")).inputs).toBe("Fill in task.");
    expect(draftProblems(draftOf(nightly), workflow("refine-backlog"))).toEqual({});
  });
  it("refuses a workflow that is not common to the target projects, with the reason it is given", () => {
    const draft = { ...draftOf(nightly), targets: { kind: "projects" as const, cwds: [FORGERIE, PI_MONO] } };
    expect(draftProblems(draft, undefined, "“refine-backlog” cannot run in every target project.").workflow).toBe("“refine-backlog” cannot run in every target project.");
    expect(draftProblems({ ...draft, targets: { kind: "all" } }, workflow("refine-backlog")).project).toBeUndefined();
  });
  it("maps a server field to the field it is about", () => {
    expect(["name", "schedule.at", "schedule.on", "schedule.timezone", "action.targets.cwds", "action.workflow", "action.inputs.task", "action.model", "missedGraceMinutes", "other"].map(fieldOf))
      .toEqual(["name", "time", "days", "timezone", "project", "workflow", "inputs", "model", "late", undefined]);
  });
});

describe("the request a draft becomes", () => {
  it("creates without an ID: the server picks it", () => {
    const create = createOf({ ...emptyDraft(HOST_ZONE), name: " Nightly refinement ", targets: { kind: "projects", cwds: [FORGERIE] }, workflow: "refine-backlog", inputs: { task: "Refine." } }, workflow("refine-backlog"));
    expect(create).toEqual({ name: "Nightly refinement", schedule: { kind: "daily", at: "03:00", timezone: HOST_ZONE },
      action: { kind: "workflow", targets: { kind: "projects", cwds: [FORGERIE] }, workflow: "refine-backlog", inputs: { task: "Refine." } }, missedGraceMinutes: 360 });
    expect("id" in create).toBe(false);
    expect(createOf({ ...draftOf(nightly), name: "Everywhere", targets: { kind: "all" } }, workflow("refine-backlog")).action.targets).toEqual({ kind: "all" });
  });
  it("sends the action when the target projects change, but not when only their order does", () => {
    const several = { ...nightly, action: { ...nightly.action, targets: { kind: "projects" as const, cwds: [FORGERIE, CALIPER] } } };
    expect(updateOf(several, { ...draftOf(several), targets: { kind: "projects", cwds: [CALIPER, FORGERIE] } }, workflow("refine-backlog"), 12)).toEqual({ baseRevision: 12 });
    expect(isDirty({ ...draftOf(several), targets: { kind: "projects", cwds: [CALIPER, FORGERIE] } }, draftOf(several))).toBe(false);
    expect(updateOf(several, { ...draftOf(several), targets: { kind: "all" } }, workflow("refine-backlog"), 12).action?.targets).toEqual({ kind: "all" });
  });
  it("sends only what changed, with the revision it started from", () => {
    expect(updateOf(nightly, draftOf(nightly), workflow("refine-backlog"), 12)).toEqual({ baseRevision: 12 });
    expect(updateOf(nightly, { ...draftOf(nightly), name: "Nightly", at: "04:00" }, workflow("refine-backlog"), 12))
      .toEqual({ baseRevision: 12, name: "Nightly", schedule: { kind: "daily", at: "04:00", timezone: HOST_ZONE } });
    expect(updateOf(docs, { ...draftOf(docs), grace: 1440 }, workflow("docs-sweep"), 12)).toEqual({ baseRevision: 12, missedGraceMinutes: 1440 });
    const model = updateOf(nightly, { ...draftOf(nightly), model: "openai/gpt-5", thinkingLevel: "high" }, workflow("refine-backlog"), 12);
    expect(model.action).toEqual({ ...nightly.action, model: "openai/gpt-5", thinkingLevel: "high" });
  });
  it("leaves the action alone when only another field was edited, and keeps omitted inputs omitted", () => {
    // The stored action leaves `label` to the workflow's default ("any"). A rename must not freeze that default
    // into the action, which would also re-arm the trigger on the server.
    const stored = { ...triage, action: { ...triage.action, inputs: { task: "Triage new issues." } } };
    expect(updateOf(stored, { ...draftOf(stored), name: "Issue triage" }, workflow("triage-issues"), 12)).toEqual({ baseRevision: 12, name: "Issue triage" });
    // An edit to an input sends the action, still without the default the reader never touched.
    expect(updateOf(stored, { ...draftOf(stored), inputs: { task: "Triage everything." } }, workflow("triage-issues"), 12).action)
      .toEqual({ ...stored.action, inputs: { task: "Triage everything." } });
  });
  it("keeps a thinking level with no model set", () => {
    const thinking: Trigger = { ...nightly, action: { ...nightly.action, thinkingLevel: "high" } };
    expect(updateOf(thinking, { ...draftOf(thinking), workflow: "docs-sweep", inputs: {} }, workflow("docs-sweep"), 12).action)
      .toEqual({ kind: "workflow", targets: { kind: "projects", cwds: [FORGERIE] }, workflow: "docs-sweep", inputs: {}, thinkingLevel: "high" });
    expect(createOf({ ...draftOf(thinking), name: "x" }, workflow("refine-backlog")).action.thinkingLevel).toBe("high");
  });
  it("is dirty only when a field differs from where it started", () => {
    expect(isDirty(draftOf(nightly), draftOf(nightly))).toBe(false);
    expect(isDirty({ ...draftOf(nightly), name: "x" }, draftOf(nightly))).toBe(true);
    expect(isDirty({ ...emptyDraft(HOST_ZONE), zoneChosen: true }, emptyDraft(HOST_ZONE))).toBe(false);
  });
});
