import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_GUIDANCE_IDS,
  SESSION_GUIDANCE_ENTRIES,
  normalizeSessionGuidanceIds,
  sessionGuidanceSummary,
  setSessionGuidance,
} from "./sessionGuidance";

describe("session guidance domain", () => {
  it("publishes the built-in guidance catalog", () => {
    expect(SESSION_GUIDANCE_ENTRIES).toEqual([
      {
        id: "technical-english",
        name: "Technical English",
        description: "Use short, direct sentences and consistent terms.",
      },
      {
        id: "concise-responses",
        name: "Progressive answers",
        description: "Answer first, then offer detail instead of delivering it.",
      },
      {
        id: "honest-claims",
        name: "Honest claims",
        description: "Label claims, verify before asserting, and lead with corrections.",
      },
    ]);
  });

  it("defaults every built-in guidance to on", () => {
    expect(DEFAULT_SESSION_GUIDANCE_IDS).toEqual(["technical-english", "concise-responses", "honest-claims"]);
  });

  it("enables, disables, and re-enables entries without losing stable order", () => {
    const first = setSessionGuidance([], "technical-english", true);
    const second = setSessionGuidance(first.activeIds, "prototype", true, ["technical-english", "prototype"]);
    const disabled = setSessionGuidance(second.activeIds, "technical-english", false, ["technical-english", "prototype"]);
    const reenabled = setSessionGuidance(disabled.activeIds, "technical-english", true, ["technical-english", "prototype"]);

    expect(first).toEqual({ activeIds: ["technical-english"], changed: true });
    expect(second).toEqual({ activeIds: ["technical-english", "prototype"], changed: true });
    expect(disabled).toEqual({ activeIds: ["prototype"], changed: true });
    expect(reenabled).toEqual({ activeIds: ["prototype", "technical-english"], changed: true });
  });

  it("reports idempotent requests without changing the active list", () => {
    expect(setSessionGuidance(["technical-english"], "technical-english", true)).toEqual({
      activeIds: ["technical-english"],
      changed: false,
    });
    expect(setSessionGuidance([], "technical-english", false)).toEqual({ activeIds: [], changed: false });
  });

  it("normalizes restored values to unique known IDs in first-seen order", () => {
    expect(normalizeSessionGuidanceIds(
      ["unknown", "technical-english", "technical-english"],
    )).toEqual(["technical-english"]);
    expect(normalizeSessionGuidanceIds("technical-english")).toEqual([]);
  });

  it("summarizes empty, single, and synthetic multiple-entry states", () => {
    const catalog = [
      { id: "technical-english", name: "Technical English", description: "" },
      { id: "prototype", name: "Prototype early", description: "" },
    ];

    expect(sessionGuidanceSummary([], catalog)).toBe("Guidance");
    expect(sessionGuidanceSummary(["technical-english"], catalog)).toBe("Technical English");
    expect(sessionGuidanceSummary(["technical-english", "prototype"], catalog)).toBe("Technical English +1");
    expect(sessionGuidanceSummary(["prototype", "technical-english"], catalog)).toBe("Prototype early +1");
  });
});
