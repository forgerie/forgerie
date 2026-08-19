import { describe, expect, it } from "vitest";
import {
  MOBILE_PROMPT_ENTER_MEDIA_QUERY,
  shouldSendPromptOnEnterShortcut,
  shouldUsePromptEnterShiftShortcut,
  type PromptEnterMedia,
} from "./promptEnterBehavior";

describe("promptEnterBehavior", () => {
  it("uses the expected mobile media query", () => {
    expect(MOBILE_PROMPT_ENTER_MEDIA_QUERY).toBe("(pointer: coarse), (max-width: 760px)");
  });

  it("always sends Enter and keeps Shift+Enter for a new line", () => {
    expect(shouldSendPromptOnEnterShortcut(false)).toBe(true);
    expect(shouldSendPromptOnEnterShortcut(true)).toBe(false);
  });

  it("ignores implicit Shift state on mobile-like keyboards", () => {
    expect(shouldUsePromptEnterShiftShortcut(false, true, { matches: true } satisfies PromptEnterMedia)).toBe(false);
    expect(shouldUsePromptEnterShiftShortcut(true, false, { matches: true } satisfies PromptEnterMedia)).toBe(false);
    expect(shouldUsePromptEnterShiftShortcut(true, true, { matches: true } satisfies PromptEnterMedia)).toBe(true);
    expect(shouldUsePromptEnterShiftShortcut(true, false, { matches: false } satisfies PromptEnterMedia)).toBe(true);
    expect(shouldUsePromptEnterShiftShortcut(true, false, undefined)).toBe(true);
  });
});
