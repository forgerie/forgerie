import { describe, expect, expectTypeOf, it } from "vitest";
import { Check } from "typebox/value";
import { ChildRetrySchema, type ChildRetry as SharedChildRetry } from "@shared/childRetry";
import type { DurableChildSummary } from "@shared/childAgents";
import { childRetrySchema, childStatus, childSummariesSchema, childSummarySchema, nextRetry, orderChildren, reportOf, retryLine, retryWait, type ChildRetry, type ChildSummary } from "./childAgentsModel";
import { CHILDREN, NOW, OVERLOADED, RETRYING } from "./fixtures/children";

describe("a child's retry mirrors the server's schema", () => {
  it("has the server's types", () => {
    expectTypeOf<ChildRetry>().toEqualTypeOf<SharedChildRetry>();
    expectTypeOf<NonNullable<ChildSummary["retry"]>>().toEqualTypeOf<NonNullable<DurableChildSummary["retry"]>>();
    // A summary the server sends is one the browser reads.
    expectTypeOf<DurableChildSummary>().toExtend<ChildSummary>();
  });

  it("accepts and refuses the same values as the server", () => {
    const retry = { attempt: 1, max: 3, error: "overloaded", until: NOW + 30_000 };
    const samples: unknown[] = [
      retry, { ...retry, attempt: 2 }, { ...retry, attempt: 3, error: OVERLOADED },
      { ...retry, attempt: 4 }, { ...retry, attempt: 0 }, { ...retry, attempt: 1.5 }, { ...retry, max: 2 }, { ...retry, max: 4 },
      { ...retry, error: 529 }, { ...retry, until: "soon" }, { ...retry, extra: true }, { attempt: 1, max: 3, error: "x" }, null, "retry",
    ];
    for (const sample of samples) expect(childRetrySchema.safeParse(sample).success, JSON.stringify(sample)).toBe(Check(ChildRetrySchema, sample));
    // The pairs the server refuses, named.
    for (const sample of [{ ...retry, attempt: 4 }, { ...retry, max: 2 }]) {
      expect(Check(ChildRetrySchema, sample)).toBe(false);
      expect(childRetrySchema.safeParse(sample).success).toBe(false);
    }
  });

  it("is optional on a /children item, and absent while no retry waits", () => {
    const wire: DurableChildSummary = { name: "api", conversationId: 15, agent: "worker", busy: false, createdAt: 1, questions: [],
      retry: { attempt: 1, max: 3, error: "overloaded", until: NOW + 30_000 } };
    expect(childSummarySchema.parse(wire).retry).toEqual(wire.retry);
    const { retry: _retry, ...without } = wire;
    void _retry;
    expect(childSummarySchema.parse(without).retry).toBeUndefined();
    expect(childSummarySchema.safeParse({ ...wire, retry: null }).success).toBe(false);
    expect(childSummariesSchema.parse([...CHILDREN, RETRYING])).toHaveLength(4);
  });
});

describe("a child's retry, as the reader sees it", () => {
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
