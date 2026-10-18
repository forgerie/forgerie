import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { ChildActivitySchema } from "@shared/childAgents";
import { childSummarySchema, lastToolLine, QUIET_MINUTES } from "./childAgentsModel";
import { CHILDREN } from "./fixtures/children";

describe("child activity wire projection", () => {
  it("validates the shared bounds and keeps missing/zero costs distinct", () => {
    const activity = { costUsd: 0, lastTool: { name: "read", at: 10 } };
    for (const sample of [activity, { costUsd: null, lastTool: null }, { ...activity, costUsd: -1 },
      { ...activity, lastTool: { name: "private\ncontents", at: 1 } }, { ...activity, lastTool: { name: "x".repeat(81), at: 1 } },
      { ...activity, lastTool: { name: "read", at: null } }, { ...activity, lastTool: { name: "read", at: -1 } }]) {
      expect(childSummarySchema.safeParse({ ...CHILDREN[0], ...sample }).success).toBe(Check(ChildActivitySchema, sample));
    }
    expect(childSummarySchema.parse({ ...CHILDREN[0], ...activity }).costUsd).toBe(0);
    expect(childSummarySchema.parse({ ...CHILDREN[0], costUsd: null }).costUsd).toBeNull();
  });
});

describe("a child's last tool line", () => {
  const minute = 60_000;
  it("says how long ago the last tool ran, and flags a working child that has been quiet", () => {
    const at = 1_000_000;
    expect(lastToolLine({ busy: true, lastTool: { name: "bash", at } }, at + 30_000).text).toBe("Last tool: bash, under a minute ago");
    expect(lastToolLine({ busy: true, lastTool: { name: "bash", at } }, at + (QUIET_MINUTES - 1) * minute)).toEqual({ text: "Last tool: bash, 9 min ago", quiet: false });
    expect(lastToolLine({ busy: true, lastTool: { name: "bash", at } }, at + QUIET_MINUTES * minute))
      .toEqual({ text: "No tool call for 10 min (last: bash). It may be stuck.", quiet: true });
    // An idle child is finished, not stuck.
    expect(lastToolLine({ busy: false, lastTool: { name: "bash", at } }, at + 60 * minute).quiet).toBe(false);
    expect(lastToolLine({ busy: true, lastTool: { name: "read", at: null } }, at).text).toBe("Last tool: read");
    expect(lastToolLine({ busy: true, lastTool: null }, at).text).toBe("Last tool: Unavailable");
    expect(lastToolLine({ busy: true }, at).text).toBe("Last tool: Unavailable");
  });
  it("says a quiet child waits for its parent's answer, not that it may be stuck", () => {
    const at = 1_000_000;
    const child = { busy: true, lastTool: { name: "bash", at }, waitingForParent: { questionId: "q:313", askedAt: at } };
    expect(lastToolLine(child, at + 65 * minute)).toEqual({ text: "Waiting for the parent agent to answer q:313, asked 65 min ago", quiet: false });
    expect(lastToolLine(child, at + 10_000).text).toBe("Waiting for the parent agent to answer q:313, asked under a minute ago");
    expect(childSummarySchema.parse({ ...CHILDREN[0], waitingForParent: child.waitingForParent }).waitingForParent).toEqual(child.waitingForParent);
  });
});
