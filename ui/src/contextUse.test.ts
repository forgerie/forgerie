import { describe, expect, it } from "vitest";
import { statusSchema } from "./contracts";
import { contextUse } from "./contextUse";

const idle = { isStreaming: false, isCompacting: false, isBashRunning: false };

describe("context use", () => {
  it("reads Pi's percent from the session status", () => {
    const status = statusSchema.parse({ ...idle, contextUsage: { tokens: 124_000, contextWindow: 200_000, percent: 62.04 } });
    expect(contextUse(status)).toEqual({ type: "known", percent: 62, high: false });
  });
  it("rounds to a whole percent and marks the last fifth as high", () => {
    expect(contextUse(statusSchema.parse({ ...idle, contextUsage: { tokens: 1, contextWindow: 1, percent: 79.4 } }))).toMatchObject({ percent: 79, high: false });
    expect(contextUse(statusSchema.parse({ ...idle, contextUsage: { tokens: 1, contextWindow: 1, percent: 80 } }))).toMatchObject({ percent: 80, high: true });
    expect(contextUse(statusSchema.parse({ ...idle, contextUsage: { tokens: 1, contextWindow: 1, percent: 140 } }))).toMatchObject({ percent: 100 });
  });
  it("is unknown before the first reply, and after a compaction until the next one", () => {
    expect(contextUse(statusSchema.parse(idle))).toEqual({ type: "unknown" });
    expect(contextUse(statusSchema.parse({ ...idle, contextUsage: { tokens: null, contextWindow: 200_000, percent: null } }))).toEqual({ type: "unknown" });
    expect(contextUse(undefined)).toEqual({ type: "unknown" });
  });
  it("keeps the rest of the status when the reading is malformed", () => {
    const status = statusSchema.parse({ ...idle, thinkingLevel: "high", contextUsage: { percent: "lots" } });
    expect(status.thinkingLevel).toBe("high");
    expect(contextUse(status)).toEqual({ type: "unknown" });
  });
});
