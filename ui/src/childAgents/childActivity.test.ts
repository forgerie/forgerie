import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { ChildActivitySchema } from "@shared/childAgents";
import { childSummarySchema } from "./childAgentsModel";
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
