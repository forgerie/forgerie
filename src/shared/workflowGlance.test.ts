import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "./workflowRuns.js";
import { workflowGlance, worstState } from "./workflowGlance.js";

const run = (extra: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id: "run", requestId: "request", startedAt: 1, session: { id: "session", cwd: "/repo" },
  definition: { name: "Ship", path: "/ship.md", sha256: "sha", text: "Ship it" }, inputs: {}, state: { kind: "running" },
  stages: [{ id: "build", name: "Build", workers: [{ name: "api" }, { name: "ui" }] }, { id: "review", name: "Review", stop: "approve" }],
  children: [{ name: "api", stage: "build", conversationId: 1, reporterId: 2, state: { kind: "working" } }], ...extra,
});

describe("workflow glance", () => {
  it("shows route order and the first working stage", () => {
    expect(workflowGlance(run())).toEqual({ name: "Ship", stages: ["working", "next"], stage: "Build", waiting: 0 });
  });
  it("names the waiting stop before working stages or a flagged stall", () => {
    expect(workflowGlance(run({ stops: { review: { state: "waiting" } } })))
      .toEqual({ name: "Ship", stages: ["working", "waiting"], stage: "Review", waiting: 1 });
    expect(workflowGlance(run({ stops: { review: { state: "waiting" } }, stall: { state: "flagged", child: "api", error: "Failed", at: 2 } })))
      .toMatchObject({ stage: "Review", waiting: 2 });
  });
  it("shows a failed child as the worst lane of its stage", () => {
    const failed = run({ children: [{ name: "api", stage: "build", conversationId: 1, reporterId: 2,
      state: { kind: "settled", outcome: "failed", result: "Failed", delivered: true } }] });
    expect(workflowGlance(failed)?.stages).toEqual(["failed", "next"]);
  });
  it("counts a flagged stall and names the stalled child's stage", () => {
    expect(workflowGlance(run({ stall: { state: "flagged", child: "api", error: "Failed", at: 2 } })))
      .toMatchObject({ stage: "Build", waiting: 1 });
    expect(workflowGlance(run({ stall: { state: "flagged", child: "missing", error: "Failed", at: 2 } })))
      .toMatchObject({ stage: "", waiting: 1 });
    expect(workflowGlance(run({ stall: { state: "woken", child: "missing", error: "Failed", at: 2 } })))
      .toMatchObject({ stage: "Build", waiting: 0 });
  });
  it("omits finished and stopping runs", () => {
    expect(workflowGlance(run({ state: { kind: "finished", outcome: "completed", result: "Done", finishedAt: 2 } }))).toBeUndefined();
    expect(workflowGlance(run({ state: { kind: "stopping" } }))).toBeUndefined();
  });
  it("keeps prose-only runs without stages or a stage name", () => {
    const prose = run();
    delete prose.stages;
    expect(workflowGlance(prose)).toEqual({ name: "Ship", stages: [], stage: "", waiting: 0 });
  });
  it("uses failed > waiting > working > next > done, and done for no lanes", () => {
    expect(worstState(["done", "next", "working", "waiting", "failed"])).toBe("failed");
    expect(worstState(["done", "next", "working", "waiting"])).toBe("waiting");
    expect(worstState(["done", "next", "working"])).toBe("working");
    expect(worstState(["done", "next"])).toBe("next");
    expect(worstState([])).toBe("done");
  });
});
