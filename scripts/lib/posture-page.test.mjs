import { describe, expect, it, vi } from "vitest";
import { drivePage, pressCombo } from "./posture-page.mjs";

/**
 * A CDP double that answers the two calls `drivePage` makes: navigation, and
 * `Runtime.evaluate` for the deep query and each click. `found` decides whether
 * the page reports a button under the requested title.
 */
function cdpWithButton(found) {
  const evaluated = [];
  return {
    evaluated,
    waitForEvent: () => Promise.resolve(),
    send: (method, params) => {
      if (method !== "Runtime.evaluate") return Promise.resolve({});
      evaluated.push(params.expression);
      return Promise.resolve({ result: { result: { value: params.expression.includes("__forgerieDeepFind") ? found : undefined } } });
    },
  };
}

describe("drivePage click titles", () => {
  it("fails when a required button is missing", async () => {
    const cdp = cdpWithButton(false);

    await expect(drivePage(cdp, { url: "about:blank", settle: 0, clickTitles: ["Expand quota"], label: "folded-portrait" }))
      .rejects.toThrow(/No button titled "Expand quota" in folded-portrait/);
  });

  it("skips a '?' button that this posture does not render", async () => {
    // The layout is adaptive, so a control can be absent by design: the
    // navigation panel is already open at the wider postures and has no
    // "Show sessions" button there.
    const cdp = cdpWithButton(false);

    await expect(drivePage(cdp, { url: "about:blank", settle: 0, clickTitles: ["?Show sessions"], label: "unfolded-landscape" }))
      .resolves.toBeUndefined();
  });

  it("strips the '?' before matching the title", async () => {
    const cdp = cdpWithButton(true);

    await drivePage(cdp, { url: "about:blank", settle: 0, clickTitles: ["?Show sessions"], label: "folded-portrait" });

    expect(cdp.evaluated.some((expression) => expression.includes('"Show sessions"'))).toBe(true);
    expect(cdp.evaluated.some((expression) => expression.includes('"?Show sessions"'))).toBe(false);
  });
});

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
