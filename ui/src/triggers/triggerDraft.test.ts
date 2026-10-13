import { describe, expect, it } from "vitest";
import { createOf, draftOf, draftProblems, emptyDraft, fieldOf, isDirty, problemList, updateOf } from "./triggerDraft";
import { docs, FORGERIE, HOST_ZONE, nightly, workflows } from "./fixtures/triggers";

const workflow = (name: string) => workflows.find((item) => item.name === name);

describe("the draft's problems", () => {
  it("names each missing choice in the page's order", () => {
    const problems = draftProblems({ ...emptyDraft(HOST_ZONE), repeat: "days", days: [] }, undefined);
    expect(problemList(problems)).toEqual(["Give the trigger a name.", "Choose a project.", "Choose a workflow.", "Choose at least one day."]);
  });
  it("refuses a script workflow and an input the workflow needs", () => {
    expect(draftProblems({ ...draftOf(nightly), workflow: "nightly-report" }, workflow("nightly-report")).workflow).toMatch(/^Scripts cannot run on a schedule/);
    expect(draftProblems({ ...draftOf(nightly), inputs: { task: " " } }, workflow("refine-backlog")).inputs).toBe("Fill in task.");
    expect(draftProblems(draftOf(nightly), workflow("refine-backlog"))).toEqual({});
  });
  it("maps a server field to the field it is about", () => {
    expect(["name", "schedule.at", "schedule.on", "schedule.timezone", "action.cwd", "action.workflow", "action.inputs.task", "action.model", "missedGraceMinutes", "other"].map(fieldOf))
      .toEqual(["name", "time", "days", "timezone", "project", "workflow", "inputs", "model", "late", undefined]);
  });
});

describe("the request a draft becomes", () => {
  it("creates without an ID: the server picks it", () => {
    const create = createOf({ ...emptyDraft(HOST_ZONE), name: " Nightly refinement ", cwd: FORGERIE, workflow: "refine-backlog", inputs: { task: "Refine." } }, workflow("refine-backlog"));
    expect(create).toEqual({ name: "Nightly refinement", schedule: { kind: "daily", at: "03:00", timezone: HOST_ZONE },
      action: { kind: "workflow", cwd: FORGERIE, workflow: "refine-backlog", inputs: { task: "Refine." } }, missedGraceMinutes: 360 });
    expect("id" in create).toBe(false);
  });
  it("sends only what changed, with the revision it started from", () => {
    expect(updateOf(nightly, draftOf(nightly), workflow("refine-backlog"), 12)).toEqual({ baseRevision: 12 });
    expect(updateOf(nightly, { ...draftOf(nightly), name: "Nightly", at: "04:00" }, workflow("refine-backlog"), 12))
      .toEqual({ baseRevision: 12, name: "Nightly", schedule: { kind: "daily", at: "04:00", timezone: HOST_ZONE } });
    expect(updateOf(docs, { ...draftOf(docs), grace: 1440 }, workflow("docs-sweep"), 12)).toEqual({ baseRevision: 12, missedGraceMinutes: 1440 });
    const model = updateOf(nightly, { ...draftOf(nightly), model: "openai/gpt-5", thinkingLevel: "high" }, workflow("refine-backlog"), 12);
    expect(model.action).toEqual({ ...nightly.action, model: "openai/gpt-5", thinkingLevel: "high" });
  });
  it("is dirty only when a field differs from where it started", () => {
    expect(isDirty(draftOf(nightly), draftOf(nightly))).toBe(false);
    expect(isDirty({ ...draftOf(nightly), name: "x" }, draftOf(nightly))).toBe(true);
    expect(isDirty({ ...emptyDraft(HOST_ZONE), zoneChosen: true }, emptyDraft(HOST_ZONE))).toBe(false);
  });
});
