import { describe, expect, it } from "vitest";
import {
  SESSION_GUIDANCE_CUSTOM_TYPE,
  persistedSessionGuidance,
  restoreSessionGuidance,
  sessionGuidancePromptBlock,
} from "./sessionGuidance";

function entry(data: unknown) {
  return { type: "custom", customType: SESSION_GUIDANCE_CUSTOM_TYPE, data };
}

describe("persisted session guidance", () => {
  it("restores the latest full snapshot, including an empty clear", () => {
    const entries = [
      entry(persistedSessionGuidance(["technical-english"])),
      entry(persistedSessionGuidance([])),
    ];

    expect(restoreSessionGuidance(entries)).toEqual([]);
  });

  it("treats a malformed or unsupported latest snapshot as empty", () => {
    const older = entry(persistedSessionGuidance(["technical-english"]));

    expect(restoreSessionGuidance([older, entry({ version: 2, activeIds: ["technical-english"] })])).toEqual([]);
    expect(restoreSessionGuidance([older, entry({ version: 1, activeIds: "technical-english" })])).toEqual([]);
  });

  it("ignores other custom entries and normalizes known IDs", () => {
    expect(restoreSessionGuidance([
      { type: "custom", customType: "other", data: persistedSessionGuidance([]) },
      entry({ version: 1, activeIds: ["unknown", "technical-english", "technical-english"] }),
    ])).toEqual(["technical-english"]);
  });
});

describe("session guidance prompt block", () => {
  it("returns no block when guidance is inactive", () => {
    expect(sessionGuidancePromptBlock([])).toBeUndefined();
  });

  it("uses only compact server instruction text for active entries", () => {
    const block = sessionGuidancePromptBlock(["technical-english"]);

    expect(block).toContain("ASD-STE100 Simplified Technical English");
    expect(block).toContain("Use short sentences.");
    expect(block).not.toContain("Use short, direct sentences and consistent terms.");
    expect(block).not.toContain("technical-english");
  });

  it("drops unknown active IDs", () => {
    expect(sessionGuidancePromptBlock(["unknown"])).toBeUndefined();
  });
});
