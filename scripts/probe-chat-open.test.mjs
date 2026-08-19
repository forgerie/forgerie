import { describe, expect, it } from "vitest";
import { coldWarmComparisonFailures, gateScenario, historyCacheKey, measuresForAttempt, newestIntentAttemptId, performanceEntriesForInteraction } from "./probe-chat-open.mjs";

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

  it("gates every usable-chat milestone at 100 ms", () => {
    const target = { id: "same", sessionId: "same", cwd: "/repo", machineId: "local" };
    const result = {
      label: "same-workspace-cold",
      target,
      attemptId: 9,
      measures: [measure("shell-painted", 9, "same", "/repo", 20, 20), measure("cached-transcript-painted", 9, "same", "/repo", 80, 80)],
      interaction: { composerMs: 25, acceptedSendMs: 30, editable: true, targeted: true, accepted: true },
      oldFlash: false,
    };

    expect(gateScenario(result, { shellBudgetMs: 100 })).toEqual([]);
    expect(gateScenario({ ...result, interaction: { ...result.interaction, acceptedSendMs: 101 } }, { shellBudgetMs: 100 })).toEqual([
      "same-workspace-cold accepted Send 101.0ms exceeds 100 ms for attempt 9 local:same cwd=/repo",
    ]);
  });

  it("accepts either cached or bounded fresh content as the first-readable milestone", () => {
    const cold = [measure("fresh-transcript-painted", 11, "same", "/repo", 80, 80)];
    const warmFresh = [measure("fresh-transcript-painted", 12, "same", "/repo", 70, 70)];
    const warmCached = [measure("cached-transcript-painted", 13, "same", "/repo", 20, 20)];

    expect(coldWarmComparisonFailures(cold, [])).toEqual([
      "same-workspace-warm did not record a first-readable transcript milestone",
    ]);
    expect(coldWarmComparisonFailures(cold, warmFresh)).toEqual([]);
    expect(coldWarmComparisonFailures(cold, warmCached)).toEqual([]);
  });

  it("includes browser work that overlaps the shell-to-fresh interval", () => {
    const measures = [
      measure("shell-painted", 14, "same", "/repo", 0, 10),
      measure("fresh-transcript-painted", 14, "same", "/repo", 0, 100),
    ];
    const entries = [
      { startTime: 5, duration: 4, name: "before" },
      { startTime: 15, duration: 10, name: "overlap-start" },
      { startTime: 80, duration: 30, name: "overlap-end" },
      { startTime: 101, duration: 5, name: "after" },
    ];

    expect(performanceEntriesForInteraction(entries, measures).map((entry) => entry.name)).toEqual([
      "overlap-start",
      "overlap-end",
    ]);
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
