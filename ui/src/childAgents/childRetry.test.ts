import { describe, expect, expectTypeOf, it } from "vitest";
import { childStatus, childSummariesSchema, childSummarySchema, nextRetry, orderChildren, reportOf, retryLine, retryWait, type ChildRetry } from "./childAgentsModel";
import { CHILDREN, NOW, OVERLOADED, RETRYING } from "./fixtures/children";

/** The contract's shape for a retry on a /children item (autonomy contract, slice 0), written out so the mirror cannot drift from it. */
interface ContractRetry { attempt: number; max: number; error: string; until: number }

describe("a child's retry, as /children sends it", () => {
  it("mirrors the contract's shape", () => {
    expectTypeOf<ChildRetry>().toEqualTypeOf<ContractRetry>();
    const retry: ContractRetry = { attempt: 1, max: 3, error: "overloaded", until: NOW + 30_000 };
    const wire = { name: "api", conversationId: 15, agent: "worker", busy: false, createdAt: 1, questions: [], retry };
    expect(childSummarySchema.parse(wire).retry).toEqual(retry);
    // Absent while no retry waits: the field is optional, not null.
    expect(childSummarySchema.parse({ ...wire, retry: undefined }).retry).toBeUndefined();
    expect(childSummarySchema.safeParse({ ...wire, retry: null }).success).toBe(false);
    for (const field of ["attempt", "max", "error", "until"] as const) {
      const partial: Record<string, unknown> = { ...retry };
      delete partial[field];
      expect(childSummarySchema.safeParse({ ...wire, retry: partial }).success, `without ${field}`).toBe(false);
    }
    expect(childSummarySchema.safeParse({ ...wire, retry: { ...retry, attempt: 0 } }).success).toBe(false);
    expect(childSummariesSchema.parse([...CHILDREN, RETRYING])).toHaveLength(4);
  });

  it("names the try, the provider's error, and the wait", () => {
    const retry = RETRYING.retry!;
    expect(childStatus(RETRYING)).toBe("Retrying 2 of 3");
    expect(retryLine({ ...retry, error: "overloaded_error: Overloaded" }, 160)).toBe("Retrying 2 of 3: overloaded_error: Overloaded");
    // A long error is one line, cut to the row's length; the open child shows it whole.
    const cut = retryLine(retry, 60);
    expect(cut).toMatch(/^Retrying 2 of 3: 529 \{"type":"error".*…$/u);
    expect(cut.length).toBe("Retrying 2 of 3: ".length + 60);
    expect(cut).not.toContain("\n");
    expect(retryWait(retry, NOW)).toBe("Next try in 1 min 40 s");
    expect(retryWait(retry, retry.until - 120_000)).toBe("Next try in 2 min");
    expect(retryWait(retry, retry.until - 29_500)).toBe("Next try in 30 s");
    expect(retryWait(retry, retry.until)).toBe("Trying again now");
    expect(retryWait(retry, retry.until + 5_000)).toBe("Trying again now");
  });

  it("puts a retrying child with the working ones, and an open question still first", () => {
    expect(orderChildren([CHILDREN[2]!, RETRYING, CHILDREN[1]!]).map((child) => child.name)).toEqual(["ui", "api", "review"]);
    expect(childStatus({ ...RETRYING, questions: CHILDREN[1]!.questions })).toBe("Waiting for your answer");
  });

  it("ticks only while a retry waits, toward the soonest one", () => {
    expect(nextRetry(CHILDREN)).toBeUndefined();
    expect(nextRetry([...CHILDREN, RETRYING, { ...RETRYING, retry: { ...RETRYING.retry!, until: NOW + 5_000 } }])).toBe(NOW + 5_000);
  });
});

describe("a failure report with the provider's real error", () => {
  it("keeps the whole error, brackets and line breaks too", () => {
    const error = `${OVERLOADED}\n${"x".repeat(2_000)}`;
    expect(reportOf(`[subagent api failed: ${error}]`)).toEqual({ kind: "report", childName: "api", outcome: "failed", text: error });
    expect(reportOf("[subagent api failed: model_error]")).toEqual({ kind: "report", childName: "api", outcome: "failed", text: "model_error" });
    // An answer that holds brackets is still an answer.
    expect(reportOf("[subagent api answered, no reply needed] Done [3 files].")).toEqual({ kind: "report", childName: "api", outcome: "answered", text: "Done [3 files]." });
  });
});
