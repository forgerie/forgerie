import { describe, expect, it, vi } from "vitest";
import { pressCombo } from "./posture-page.mjs";

describe("pressCombo", () => {
  it("dispatches Enter with its named CDP key contract", async () => {
    const send = vi.fn(() => Promise.resolve());

    await pressCombo({ send }, "ctrl+alt+enter");

    expect(send).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent", {
      type: "keyDown",
      modifiers: 3,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
    });
    expect(send).toHaveBeenNthCalledWith(2, "Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers: 3,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
    });
  });
});
