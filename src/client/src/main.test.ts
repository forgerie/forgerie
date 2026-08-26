// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { appFullscreenAction } from "./appFullscreen";

vi.mock("./components/PiWebApp", () => ({}));

const originalRequestFullscreen = Object.getOwnPropertyDescriptor(document.documentElement, "requestFullscreen");

afterEach(() => {
  document.body.replaceChildren();
  vi.resetModules();
  vi.restoreAllMocks();
  if (originalRequestFullscreen === undefined) Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  else Object.defineProperty(document.documentElement, "requestFullscreen", originalRequestFullscreen);
});

describe("client entrypoint fullscreen behavior", () => {
  it("leaves a normal tap inline and reserves Fullscreen API mode for the explicit action", async () => {
    const requestFullscreen = vi.fn<(options?: FullscreenOptions) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    await import("./main");
    document.body.click();
    await Promise.resolve();

    expect(requestFullscreen).not.toHaveBeenCalled();

    await appFullscreenAction(document).run();

    expect(requestFullscreen).toHaveBeenCalledExactlyOnceWith({ navigationUI: "hide" });
  });
});
