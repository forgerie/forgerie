import { describe, expect, expectTypeOf, it } from "vitest";
import { Check } from "typebox/value";
import { WorkflowChildDeliverySchema, WorkflowRunSchema, type WorkflowChildDelivery, type WorkflowRun as SharedWorkflowRun } from "@shared/workflowRuns";
import { deliveredSchema, deliveryNote, deliveryProblem, routeSteps, workflowRunSchema, type WorkflowRun } from "./workflowsModel";
import { BUILDING, LAND_WAITING, RETRY_LOOKS, RUN_NOW, STAGES, UNSENT } from "./fixtures/runs";

type Settled = Extract<WorkflowRun["children"][number]["state"], { kind: "settled" }>;
type SharedSettled = Extract<SharedWorkflowRun["children"][number]["state"], { kind: "settled" }>;

// The server's record also names its session, which the browser does not read.
const SESSION = { session: { id: "s1", cwd: "/w" } };
const withState = (state: Record<string, unknown>) => ({ ...BUILDING, ...SESSION, children: [{ conversationId: 21, reporterId: 5, name: "build", stage: "build",
  state: { kind: "settled", outcome: "answered", result: "Done.", ...state } }] });
const settledOf = (state: Record<string, unknown>) => {
  const child = workflowRunSchema.parse(withState(state)).children[0]!;
  return child.state.kind === "settled" ? child.state : undefined;
};

describe("a settled child's delivery mirrors the server's schema", () => {
  it("has the server's types", () => {
    expectTypeOf<Settled["delivered"]>().toEqualTypeOf<WorkflowChildDelivery>();
    expectTypeOf<Settled["deliveryError"]>().toEqualTypeOf<SharedSettled["deliveryError"] | undefined>();
  });

  it("accepts and refuses the same values as the server", () => {
    const samples: unknown[] = [true, false, "duplicate", "aborted", "Completion report suppressed", "", null, undefined, 0, 1, "true"];
    for (const sample of samples) expect(deliveredSchema.safeParse(sample).success, String(sample)).toBe(Check(WorkflowChildDeliverySchema, sample));
    const states: Record<string, unknown>[] = [{ delivered: "duplicate" }, { delivered: false, deliveryError: "Completion reporter faulted: Disk full" },
      { delivered: false, deliveryError: 3 }, {}, { delivered: "lost" }];
    for (const state of states) {
      expect(workflowRunSchema.safeParse(withState(state)).success, JSON.stringify(state)).toBe(Check(WorkflowRunSchema, withState(state)));
    }
    for (const run of [BUILDING, LAND_WAITING, UNSENT]) expect(Check(WorkflowRunSchema, { ...run, ...SESSION })).toBe(true);
  });

  it("keeps a reporter's error", () => {
    expect(settledOf({ delivered: false, deliveryError: "Completion reporter faulted: Disk full" }))
      .toEqual({ kind: "settled", outcome: "answered", result: "Done.", delivered: false, deliveryError: "Completion reporter faulted: Disk full" });
  });
});

describe("what a settled child's delivery says", () => {
  it("calls a duplicate and a stop plain facts, never failures", () => {
    for (const [delivered, note] of [["duplicate", "Duplicate report, not sent again"], ["aborted", "Stopped before reporting"]] as const) {
      expect(deliveryNote({ delivered })).toBe(note);
      expect(deliveryProblem({ delivered })).toBeUndefined();
    }
    expect(deliveryNote({ delivered: true })).toBeUndefined();
    expect(deliveryNote({ delivered: false })).toBeUndefined();
    expect(deliveryProblem({ delivered: false })).toBeUndefined();
  });

  it("calls a reporter's failure an error, with its reason", () => {
    const failed = { delivered: false, deliveryError: "Completion reporter faulted: Disk full" } as const;
    expect(deliveryProblem(failed)).toBe("Report not delivered: Completion reporter faulted: Disk full");
    expect(deliveryNote(failed)).toBeUndefined();
  });

  it("reads the old held-back report as unsent, not as a failure", () => {
    const old = { delivered: false, deliveryError: "Completion report suppressed; no parent message was submitted." } as const;
    expect(deliveryNote(old)).toBe("Report not sent");
    expect(deliveryProblem(old)).toBeUndefined();
  });
});

describe("the route of a run with unsent reports and a retry", () => {
  const steps = routeSteps(STAGES, UNSENT, RETRY_LOOKS, () => {}, RUN_NOW);
  const track = (stage: number, name: string) => steps[stage]?.tracks?.find((candidate) => candidate.name === name);

  it("puts the retry on the working track, with the time to the next try", () => {
    expect(track(1, "design")).toMatchObject({ state: "working", lines: ["design-engineer", "anthropic/claude-opus-5.5", "design/run-export"],
      notice: [expect.stringMatching(/^Retrying 2 of 3: 529 \{"type":"error"/u), "Next try in 1 min 40 s"] });
    // Without a clock, the route still names the retry.
    expect(routeSteps(STAGES, UNSENT, RETRY_LOOKS)[1]?.tracks?.[0]?.notice).toHaveLength(1);
    // A retry that no longer waits on a working child is not drawn.
    expect(routeSteps(STAGES, LAND_WAITING, RETRY_LOOKS)[1]?.tracks?.[0]).not.toHaveProperty("notice");
  });

  it("says a duplicate and a stop in plain lines, and a failed report as a problem", () => {
    expect(track(1, "build")).toMatchObject({ state: "done", lines: ["full-stack-engineer", "feat/run-export-api", "Duplicate report, not sent again"] });
    expect(track(1, "docs")).toMatchObject({ state: "done", lines: ["general helper", "Stopped before reporting"] });
    for (const name of ["build", "docs"]) {
      expect(track(1, name)).not.toHaveProperty("notice");
      expect(track(1, name)).not.toHaveProperty("problem");
    }
    expect(track(1, "tests")).toMatchObject({ state: "done", lines: ["general helper"], problem: "Report not delivered: Completion reporter faulted: Disk full" });
  });
});
