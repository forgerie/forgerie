import { describe, expect, it, vi } from "vitest";
import { fullscreenState, toggleFullscreen, type FullscreenDocument } from "./appFullscreen";

describe("app full screen", () => {
  it("enters full screen with the browser's navigation hidden, only when asked", async () => {
    const requestFullscreen = vi.fn<(options?: FullscreenOptions) => Promise<void>>().mockResolvedValue(undefined);
    const target: FullscreenDocument = { fullscreenElement: null, documentElement: { requestFullscreen } };
    const seen = fullscreenState(target);
    expect(seen).toEqual({ type: "window" });
    expect(requestFullscreen).not.toHaveBeenCalled();
    await toggleFullscreen(seen, target);
    expect(requestFullscreen).toHaveBeenCalledExactlyOnceWith({ navigationUI: "hide" });
  });

  it("keeps the exit the reader saw if the browser leaves full screen first", async () => {
    const requestFullscreen = vi.fn<(options?: FullscreenOptions) => Promise<void>>().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    let fullscreenElement: unknown = {};
    const target: FullscreenDocument = { get fullscreenElement() { return fullscreenElement; }, documentElement: { requestFullscreen }, exitFullscreen };
    const seen = fullscreenState(target);
    fullscreenElement = null;
    expect(seen).toEqual({ type: "fullscreen" });
    await toggleFullscreen(seen, target);
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("reports a browser without the Fullscreen API as unsupported and does nothing", async () => {
    const target: FullscreenDocument = { fullscreenElement: null, documentElement: {} };
    const seen = fullscreenState(target);
    expect(seen).toEqual({ type: "unsupported" });
    await expect(toggleFullscreen(seen, target)).resolves.toBeUndefined();
  });
});
