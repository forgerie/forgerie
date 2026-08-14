// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { enterAppFullscreen, installPwaFullscreenOnFirstInteraction } from "./pwaFullscreen";

afterEach(() => {
  document.body.replaceChildren();
});

describe("PWA fullscreen", () => {
  it("asks the browser to hide navigation when entering fullscreen", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const target = Object.assign(new EventTarget(), {
      fullscreenElement: null,
      documentElement: { requestFullscreen },
    });

    await enterAppFullscreen(target);

    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: "hide" });
  });

  it("requests fullscreen once on the installed PWA's first click", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const target = new EventTarget();

    const uninstall = installPwaFullscreenOnFirstInteraction({
      isPwaDisplayMode: true,
      interactionTarget: target,
      requestFullscreen,
    });
    target.dispatchEvent(new Event("click"));
    target.dispatchEvent(new Event("click"));
    await Promise.resolve();

    expect(requestFullscreen).toHaveBeenCalledOnce();
    uninstall();
  });

  it("waits for a stopped first-click handler before requesting fullscreen", async () => {
    const sequence: string[] = [];
    const requestFullscreen = vi.fn().mockImplementation(() => {
      sequence.push("fullscreen");
      return Promise.resolve();
    });
    const button = document.createElement("button");
    button.addEventListener("click", (event) => {
      sequence.push("control");
      event.stopPropagation();
    });
    document.body.append(button);

    installPwaFullscreenOnFirstInteraction({
      isPwaDisplayMode: true,
      interactionTarget: document,
      requestFullscreen,
    });
    button.click();
    await Promise.resolve();

    expect(sequence).toEqual(["control", "fullscreen"]);
  });

  it("does not request fullscreen from a normal browser tab", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const target = new EventTarget();

    installPwaFullscreenOnFirstInteraction({
      isPwaDisplayMode: false,
      interactionTarget: target,
      requestFullscreen,
    });
    target.dispatchEvent(new Event("click"));
    await Promise.resolve();

    expect(requestFullscreen).not.toHaveBeenCalled();
  });
});
