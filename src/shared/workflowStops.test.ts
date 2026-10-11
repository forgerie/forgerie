import { describe, expect, it } from "vitest";
import type { WorkflowRun, WorkflowStage, WorkflowStopState } from "./workflowRuns.js";
import { admitChild, completionProblem, declaredWorker, heldAt, routeProblems, stageViews, stopRequestProblem } from "./workflowStops.js";

const ROUTE: WorkflowStage[] = [
  { id: "contract", name: "Contract", stop: "approve" },
  { id: "build", name: "Design and build", workers: [{ name: "design", agent: "design-engineer" }, { name: "build" }] },
  { id: "review", name: "Review", workers: [{ name: "review", agent: "reviewer" }] },
  { id: "land", name: "Land", stop: "land" },
];
type Child = WorkflowRun["children"][number];
const working = (name: string, stage?: string): Child => ({ conversationId: 1, reporterId: 1, name, ...(stage === undefined ? {} : { stage }), state: { kind: "working" } });
const settled = (name: string, stage?: string): Child => ({ ...working(name, stage), state: { kind: "settled", outcome: "answered", result: "ok", delivered: true } });
function run(stops: Record<string, WorkflowStopState["state"]> = {}, children: Child[] = [], stages: WorkflowStage[] = ROUTE) {
  return { definition: { name: "design-build-review", path: "", sha256: "", text: "" }, stages, children,
    stops: Object.fromEntries(Object.entries(stops).map(([id, state]) => [id, { state }])) };
}

describe("workflow stops", () => {
  it("holds a run at its first unapproved stop", () => {
    expect(heldAt(run())?.id).toBe("contract");
    expect(heldAt(run({ contract: "approved" }))?.id).toBe("land");
    expect(heldAt(run({ contract: "approved", land: "approved" }))).toBeUndefined();
  });

  it("refuses workers that belong after the held stop and admits those before it", () => {
    const refused = admitChild(run(), "design");
    expect(refused.kind).toBe("refused");
    if (refused.kind === "refused") expect(refused.reason).toContain('workflow_stop with stage "contract"');
    const waiting = admitChild(run({ contract: "waiting" }), "build");
    if (waiting.kind === "refused") expect(waiting.reason).toContain("has not decided yet");
    else throw new Error("Expected a refusal while the user decides");
    // An undeclared helper has no agent stage before the first stop.
    expect(admitChild(run(), "helper").kind).toBe("refused");
    expect(admitChild(run({ contract: "approved" }), "design")).toEqual({ kind: "admitted", stage: "build" });
    expect(admitChild(run({ contract: "approved" }), "review")).toEqual({ kind: "admitted", stage: "review" });
    // An undeclared helper joins the last agent stage before the held stop.
    expect(admitChild(run({ contract: "approved" }), "docs")).toEqual({ kind: "admitted", stage: "review" });
    // A run without stages keeps the earlier behaviour.
    expect(admitChild(run({}, [], []), "anything")).toEqual({ kind: "admitted" });
  });

  it("lets the agent ask only for the held stop, and lands only after every child settles", () => {
    expect(stopRequestProblem(run(), "contract")).toBeUndefined();
    expect(stopRequestProblem(run(), "land")).toContain('"Contract" comes first');
    expect(stopRequestProblem(run(), "build")).toContain("is not a stop");
    expect(stopRequestProblem(run(), "nope")).toContain("no stage");
    expect(stopRequestProblem(run({ contract: "approved" }), "contract")).toContain("already approved");
    expect(stopRequestProblem(run({ contract: "approved" }, [working("review", "review")]), "land")).toContain("every child");
    expect(stopRequestProblem(run({ contract: "approved" }, [settled("review", "review")]), "land")).toBeUndefined();
  });

  it("finishes as completed only after every stop", () => {
    expect(completionProblem(run({ contract: "approved" }))).toContain('"Land"');
    expect(completionProblem(run({ contract: "approved", land: "approved" }))).toBeUndefined();
    expect(completionProblem(run({}, [], []))).toBeUndefined();
  });

  it("finds a declared worker by name in any stage", () => {
    const stages: WorkflowStage[] = [{ id: "review", name: "Review", workers: [{ name: "review", agent: "reviewer", model: "cliproxyapi/gpt-6.1-sol" }] }];
    expect(declaredWorker({ stages }, "review")?.model).toBe("cliproxyapi/gpt-6.1-sol");
    expect(declaredWorker({ stages }, "helper")).toBeUndefined();
    expect(declaredWorker({}, "review")).toBeUndefined();
  });

  it("rejects routes it cannot enforce", () => {
    expect(routeProblems(ROUTE)).toEqual([]);
    expect(routeProblems([{ id: "a", name: "A", stop: "land" }, { id: "b", name: "B" }])).toEqual(["Land stage a must be the last stage"]);
    expect(routeProblems([{ id: "a", name: "A", stop: "approve", workers: [{ name: "x" }] }])[0]).toContain("cannot declare workers");
    expect(routeProblems([{ id: "a", name: "A", workers: [{ name: "x" }] }, { id: "a", name: "B", workers: [{ name: "x" }] }]))
      .toEqual(["Stage id a is used twice", "Worker x is declared in two stages"]);
  });

  it("draws each stage from stops and children", () => {
    expect(stageViews(run())).toEqual({ contract: "working", build: "next", review: "next", land: "next" });
    expect(stageViews(run({ contract: "waiting" }))).toEqual({ contract: "waiting", build: "next", review: "next", land: "next" });
    expect(stageViews(run({ contract: "approved" }))).toEqual({ contract: "done", build: "working", review: "next", land: "next" });
    expect(stageViews(run({ contract: "approved" }, [working("design", "build"), settled("build", "build")])))
      .toEqual({ contract: "done", build: "working", review: "next", land: "next" });
    expect(stageViews(run({ contract: "approved" }, [settled("design", "build"), working("review", "review")])))
      .toEqual({ contract: "done", build: "done", review: "working", land: "next" });
    expect(stageViews(run({ contract: "approved", land: "waiting" }, [settled("design", "build"), settled("review", "review")])))
      .toEqual({ contract: "done", build: "done", review: "done", land: "waiting" });
    expect(stageViews(run({ contract: "approved", land: "approved" }, [settled("design", "build")])))
      .toEqual({ contract: "done", build: "done", review: "done", land: "done" });
  });
});
