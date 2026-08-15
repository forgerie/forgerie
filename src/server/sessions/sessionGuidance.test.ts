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
  it("turns every guidance on when no choice was ever stored", () => {
    expect(restoreSessionGuidance([])).toEqual(["technical-english", "concise-responses", "honest-claims"]);
    expect(restoreSessionGuidance([{ type: "custom", customType: "other", data: {} }])).toEqual([
      "technical-english",
      "concise-responses",
      "honest-claims",
    ]);
  });

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
    expect(block).toContain("Before sending, replace any second word you used for a concept you already named.");
    expect(block).not.toContain("Use short, direct sentences and consistent terms.");
    expect(block).not.toContain("technical-english");
  });

  it("keeps concise responses short and answer-first", () => {
    const block = sessionGuidancePromptBlock(["concise-responses"]);

    expect(block).toContain("Give the answer first.");
    expect(block).toContain("Do not repeat the question, narrate the process, or add an unsolicited recap.");
    expect(block).toContain("Expand only when the user asks for detail or the task requires it for safety.");
    expect(block).toContain("Before sending, delete each sentence that does not change what the user does or decides.");
    expect(block).toContain("Offer deeper detail instead of including it, and name what you can expand on in one line.");
    expect(block).not.toContain("Mark each factual claim");
  });

  it("uses strict server instruction text for honest claims", () => {
    const block = sessionGuidancePromptBlock(["honest-claims"]);

    expect(block).toContain("Open the reply with any correction to earlier work.");
    expect(block).toContain("This includes a defect in work you delivered in this same session.");
    expect(block).toContain("Mark each factual claim as verified, inferred, or opinion.");
    expect(block).toContain("Call a claim verified only if you checked the source in this session.");
    expect(block).toContain("Do not mix an unchecked claim into a list of checked claims.");
    expect(block).toContain("State the cost of each recommendation.");
    expect(block).toContain("Never defer a correction or a safety-relevant cost, even when you offer other detail instead.");
    expect(block).toContain("Before sending, check each factual sentence; label it or delete it if you did not verify it.");
  });

  it("drops unknown active IDs", () => {
    expect(sessionGuidancePromptBlock(["unknown"])).toBeUndefined();
  });
});
