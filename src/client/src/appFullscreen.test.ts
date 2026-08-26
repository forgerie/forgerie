import { describe, expect, it, vi } from "vitest";
import { appFullscreenAction, type AppFullscreenDocument } from "./appFullscreen";

describe("app fullscreen action", () => {
  it("waits for the explicit action before entering full screen", async () => {
    const requestFullscreen = vi.fn<(options?: FullscreenOptions) => Promise<void>>().mockResolvedValue(undefined);
    const action = appFullscreenAction({
      fullscreenElement: null,
      documentElement: { requestFullscreen },
    });

    expect(action).toMatchObject({
      id: "app.view.toggle-fullscreen",
      title: "Enter Full Screen",
      group: "View",
      enabled: true,
    });
    expect(requestFullscreen).not.toHaveBeenCalled();

    await action.run();

    expect(requestFullscreen).toHaveBeenCalledExactlyOnceWith({ navigationUI: "hide" });
  });

  it("keeps the captured exit intent if browser state changes before the action runs", async () => {
    const requestFullscreen = vi.fn<(options?: FullscreenOptions) => Promise<void>>().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    let fullscreenElement: unknown = {};
    const target: AppFullscreenDocument = {
      get fullscreenElement() { return fullscreenElement; },
      documentElement: { requestFullscreen },
      exitFullscreen,
    };
    const action = appFullscreenAction(target);
    fullscreenElement = null;

    expect(action.title).toBe("Exit Full Screen");

    await action.run();

    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("keeps the action visible with an explanation when the browser has no Fullscreen API", () => {
    const action = appFullscreenAction({
      fullscreenElement: null,
      documentElement: {},
    });

    expect(action.enabled).toBe(false);
    expect(action.disabledReason).toBe("This browser does not support full-screen mode.");
  });
});
