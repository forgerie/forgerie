import { describe, expect, it } from "vitest";
import { coldWarmComparisonFailures, historyCacheKey, measuresForAttempt, newestIntentAttemptId } from "./probe-chat-open.mjs";

describe("probe-chat-open attempt helpers", () => {
  it("uses the same machine-scoped history cache key as the app", () => {
    expect(historyCacheKey({ id: "same", sessionId: "same", cwd: "/repo", machineId: "local" })).toBe("pi-web:chat-history:v2:local:same");
    expect(historyCacheKey({ id: "same", sessionId: "same", cwd: "/repo", machineId: "remote-a" })).toBe("pi-web:chat-history:v2:remote-a:same");
    expect(historyCacheKey({ id: "row-id", sessionId: "session-id", cwd: "/repo", machineId: "local" })).toBe("pi-web:chat-history:v2:local:session-id");
  });

  it("selects the newest intent attempt for the requested target only", () => {
    const ref = { id: "same", cwd: "/repo", machineId: "local" };
    const entries = [
      measure("intent", 3, "same", "/repo", 0),
      measure("live-ready", 3, "same", "/repo", 20),
      measure("intent", 4, "other", "/repo", 30),
      measure("intent", 5, "same", "/repo", 40),
      measure("intent", 6, "same", "/other", 50),
    ];

    expect(newestIntentAttemptId(entries, ref)).toBe(5);
  });

  it("filters measurements by attempt id before checking milestones", () => {
    const entries = [
      measure("intent", 7, "same", "/repo", 0),
      measure("live-ready", 7, "same", "/repo", 30),
      measure("intent", 8, "same", "/repo", 40),
      measure("shell-painted", 8, "same", "/repo", 45),
      measure("cached-transcript-painted", 8, "same", "/repo", 48),
    ];

    expect(measuresForAttempt(entries, 8).map((entry) => entry.detail.milestone)).toEqual([
      "intent",
      "shell-painted",
      "cached-transcript-painted",
    ]);
  });

  it("fails warm comparison when cache is absent or slower than cold fresh readability", () => {
    const cold = [measure("fresh-transcript-painted", 11, "same", "/repo", 240, 240)];
    const warmMissing = [measure("fresh-transcript-painted", 12, "same", "/repo", 240, 240)];
    const warmSlower = [measure("cached-transcript-painted", 13, "same", "/repo", 260, 260)];
    const warmFaster = [measure("cached-transcript-painted", 14, "same", "/repo", 24, 24)];

    expect(coldWarmComparisonFailures(cold, warmMissing)).toEqual([
      "same-workspace-warm did not record cached-transcript-painted after cold populated cache",
    ]);
    expect(coldWarmComparisonFailures(cold, warmSlower)).toEqual([
      "same-workspace warm first-readable latency 260.0ms did not improve over cold fresh-readable latency 240.0ms",
    ]);
    expect(coldWarmComparisonFailures(cold, warmFaster)).toEqual([]);
  });
});

function measure(milestone, attemptId, sessionId, cwd, startTime, duration = startTime) {
  return {
    name: `forgerie.chat-open.measure.${milestone}`,
    startTime,
    duration,
    detail: {
      milestone,
      attemptId,
      target: { sessionId, cwd, machineId: "local" },
    },
  };
}
