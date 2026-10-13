import { describe, expect, expectTypeOf, it } from "vitest";
import { deliveryNote, routeSteps, workflowRunSchema, type WorkflowRun } from "./workflowsModel";
import { BUILDING, LAND_WAITING, RETRY_LOOKS, RUN_NOW, STAGES, UNSENT } from "./fixtures/runs";

type Settled = Extract<WorkflowRun["children"][number]["state"], { kind: "settled" }>;
/** The contract's shape for a settled child's delivery (autonomy contract, slice 0). */
type ContractDelivered = true | "duplicate" | "aborted" | false;

const withDelivery = (state: Record<string, unknown>) => ({ ...BUILDING, children: [{ conversationId: 21, reporterId: 5, name: "build", stage: "build",
  state: { kind: "settled", outcome: "answered", result: "Done.", ...state } }] });
const deliveredOf = (state: Record<string, unknown>) => {
  const child = workflowRunSchema.parse(withDelivery(state)).children[0]!;
  return child.state.kind === "settled" ? child.state : undefined;
};

describe("a settled child's delivery", () => {
  it("mirrors the contract's shape", () => {
    expectTypeOf<Settled["delivered"]>().toEqualTypeOf<ContractDelivered>();
    for (const delivered of [true, false, "duplicate", "aborted"] as const) expect(deliveredOf({ delivered })?.delivered).toBe(delivered);
    expect(workflowRunSchema.safeParse(withDelivery({})).success).toBe(false);
    expect(workflowRunSchema.safeParse(withDelivery({ delivered: 1 })).success).toBe(false);
  });

  it("reads an old record as not delivered, and drops its error", () => {
    expect(deliveredOf({ delivered: false, deliveryError: "Completion report suppressed; no parent message was submitted." }))
      .toEqual({ kind: "settled", outcome: "answered", result: "Done.", delivered: false });
    expect(deliveredOf({ delivered: "Completion reporter failed: boom" })?.delivered).toBe(false);
  });

  it("says why a report was not sent, and calls neither reason a failure", () => {
    expect(deliveryNote("duplicate")).toBe("Duplicate report, not sent again");
    expect(deliveryNote("aborted")).toBe("Stopped before reporting");
    expect(deliveryNote(true)).toBeUndefined();
    expect(deliveryNote(false)).toBeUndefined();
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

  it("says a duplicate and a stop in plain lines on done tracks", () => {
    expect(track(1, "build")).toMatchObject({ state: "done", lines: ["full-stack-engineer", "feat/run-export-api", "Duplicate report, not sent again"] });
    expect(track(1, "build")).not.toHaveProperty("notice");
    expect(track(1, "docs")).toMatchObject({ state: "done", lines: ["general helper", "Stopped before reporting"] });
    expect(track(1, "docs")).not.toHaveProperty("notice");
  });
});
