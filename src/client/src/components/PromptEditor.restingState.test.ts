import { describe, expect, it } from "vitest";
import { promptComposerIsResting } from "./PromptEditor";

describe("promptComposerIsResting", () => {
  it("rests once the conversation owns the screen and nothing is in hand", () => {
    expect(promptComposerIsResting(restingInput())).toBe(true);
  });

  it("stays expanded while the composer holds focus", () => {
    expect(promptComposerIsResting({ ...restingInput(), focused: true })).toBe(false);
  });

  it("never swallows text the user has already typed", () => {
    expect(promptComposerIsResting({ ...restingInput(), draft: "half a thought" })).toBe(false);
  });

  it("keeps pending attachments visible", () => {
    expect(promptComposerIsResting({ ...restingInput(), attachmentCount: 1 })).toBe(false);
  });

  it("leaves the docked composer at full height, where the space is not contested", () => {
    expect(promptComposerIsResting({ ...restingInput(), chromeSummoned: false })).toBe(false);
  });

  it("treats whitespace as nothing in hand", () => {
    expect(promptComposerIsResting({ ...restingInput(), draft: "   \n  " })).toBe(true);
  });
});

function restingInput() {
  return { chromeSummoned: true, focused: false, draft: "", attachmentCount: 0 };
}
