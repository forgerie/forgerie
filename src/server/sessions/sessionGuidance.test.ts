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

  it("uses strict server instruction text for active entries", () => {
    const block = sessionGuidancePromptBlock(["technical-english"]);

    expect(block).toContain("Use ASD-STE100 Simplified Technical English in all responses.");
    expect(block).toContain("This rule also applies to required templates and technical reports.");
    expect(block).toContain("Use sentences of 20 words or fewer when practical.");
    expect(block).toContain("Explain necessary technical terms when you first use them.");
    expect(block).toContain("Before sending, split sentences that contain more than one action, cause, result, or qualification.");
    expect(block).not.toContain("Use short, direct sentences and consistent terms.");
    expect(block).not.toContain("technical-english");
  });

  it("drops unknown active IDs", () => {
    expect(sessionGuidancePromptBlock(["unknown"])).toBeUndefined();
  });
});
