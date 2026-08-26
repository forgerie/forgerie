import { describe, expect, it } from "vitest";
import {
  MOBILE_PROMPT_ENTER_MEDIA_QUERY,
  shouldSendPromptOnEnterShortcut,
  shouldUsePromptEnterShiftShortcut,
  type PromptEnterMedia,
  type PromptEnterShiftEvidence,
} from "./promptEnterBehavior";

function evidence(explicitShiftKeyActive: boolean, hardwareShiftKeySeen = false): PromptEnterShiftEvidence {
  return { explicitShiftKeyActive, hardwareShiftKeySeen };
}

describe("promptEnterBehavior", () => {
  it("uses the expected mobile media query", () => {
    expect(MOBILE_PROMPT_ENTER_MEDIA_QUERY).toBe("(pointer: coarse), (max-width: 760px)");
  });

  it("always sends Enter and keeps Shift+Enter for a new line", () => {
    expect(shouldSendPromptOnEnterShortcut(false)).toBe(true);
    expect(shouldSendPromptOnEnterShortcut(true)).toBe(false);
  });

  it("ignores implicit Shift state on mobile-like keyboards", () => {
    expect(shouldUsePromptEnterShiftShortcut(false, evidence(false, true), { matches: true } satisfies PromptEnterMedia)).toBe(false);
    expect(shouldUsePromptEnterShiftShortcut(true, evidence(false), { matches: true } satisfies PromptEnterMedia)).toBe(false);
    expect(shouldUsePromptEnterShiftShortcut(true, evidence(true), { matches: true } satisfies PromptEnterMedia)).toBe(true);
    expect(shouldUsePromptEnterShiftShortcut(true, evidence(false), { matches: false } satisfies PromptEnterMedia)).toBe(true);
    expect(shouldUsePromptEnterShiftShortcut(true, evidence(false), undefined)).toBe(true);
  });

  it("honors a physically held Shift even when the Enter event strips the flag", () => {
    // CodeMirror's Android key-delay path re-dispatches Enter as a synthetic
    // keydown without modifiers; the held-Shift evidence must win regardless.
    expect(shouldUsePromptEnterShiftShortcut(false, evidence(true), { matches: true } satisfies PromptEnterMedia)).toBe(true);
    expect(shouldUsePromptEnterShiftShortcut(false, evidence(true), { matches: false } satisfies PromptEnterMedia)).toBe(true);
  });

  it("trusts Shift+Enter on mobile once a hardware Shift keydown has ever been seen", () => {
    // Android IMEs drop or interleave the per-chord Shift keydown, so past
    // hardware evidence must stand in for the currently-held flag.
    expect(shouldUsePromptEnterShiftShortcut(true, evidence(false, true), { matches: true } satisfies PromptEnterMedia)).toBe(true);
    expect(shouldUsePromptEnterShiftShortcut(false, evidence(false, true), { matches: true } satisfies PromptEnterMedia)).toBe(false);
  });
});
