// @vitest-environment happy-dom

import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import { PiWebApp } from "./PiWebApp";
import type { ActionPalette } from "./ActionPalette";

const originalRequestFullscreen = Object.getOwnPropertyDescriptor(document.documentElement, "requestFullscreen");

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  if (originalRequestFullscreen === undefined) Reflect.deleteProperty(document.documentElement, "requestFullscreen");
  else Object.defineProperty(document.documentElement, "requestFullscreen", originalRequestFullscreen);
});

describe("PiWebApp full-screen action", () => {
  it("runs the explicit command through the rendered action palette", async () => {
    const requestFullscreen = vi.fn<(options?: FullscreenOptions) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    const app = new PiWebApp();
    Reflect.set(app, "state", { ...initialAppState(), actionPaletteOpen: true });
    const container = document.createElement("div");
    document.body.append(container);
    render(app.render(), container);
    const palette = required(container.querySelector<ActionPalette>("action-palette"), "action palette");
    await palette.updateComplete;
    const action = [...required(palette.shadowRoot, "action palette root").querySelectorAll<HTMLButtonElement>(".options button")]
      .find((button) => button.textContent.includes("Enter Full Screen"));

    required(action, "full-screen action").click();
    await vi.waitFor(() => { expect(requestFullscreen).toHaveBeenCalledExactlyOnceWith({ navigationUI: "hide" }); });
  });
});

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}
