import type { ReactiveController, ReactiveControllerHost } from "lit";
import { describe, expect, it } from "vitest";
import { AppShellController } from "./appShellController";
import { CHROME_RESIDENT_MIN_WIDTH } from "./shellLayoutMode";

/** CSS-pixel viewport widths for the acceptance device, see AGENTS.md. */
const FOLD8 = {
  unfoldedPortrait: 739,
  unfoldedLandscape: 979,
  foldedPortrait: 499,
  foldedLandscape: 789,
} as const;

describe("AppShellController chrome disclosure", () => {
  it("summons chrome until every pane can sit side by side", () => {
    expect(controllerAtWidth(CHROME_RESIDENT_MIN_WIDTH - 1).isChromeSummoned).toBe(true);
    expect(controllerAtWidth(CHROME_RESIDENT_MIN_WIDTH).isChromeSummoned).toBe(false);
  });

  it("gives the conversation the whole screen in every phone posture, folded or not", () => {
    expect(controllerAtWidth(FOLD8.foldedPortrait).isChromeSummoned).toBe(true);
    expect(controllerAtWidth(FOLD8.foldedLandscape).isChromeSummoned).toBe(true);
    expect(controllerAtWidth(FOLD8.unfoldedPortrait).isChromeSummoned).toBe(true);
    expect(controllerAtWidth(FOLD8.unfoldedLandscape).isChromeSummoned).toBe(true);
  });

  it("leaves chrome resident on a true multi-pane workspace", () => {
    expect(controllerAtWidth(1440).isChromeSummoned).toBe(false);
    expect(controllerAtWidth(1184).isChromeSummoned).toBe(false);
  });

  it("summons chrome on a docked shell that is still phone-shaped", () => {
    // Wide enough for navigation to dock, too narrow to also afford the bands.
    const controller = controllerAtWidth(FOLD8.unfoldedLandscape);

    expect(controller.isMobileNavigationLayout).toBe(false);
    expect(controller.isChromeSummoned).toBe(true);
  });
});

function controllerAtWidth(width: number): AppShellController {
  return new AppShellController(new RecordingHost(), {
    measureShellWidth: () => width,
    pwaDisplayModeMedia: [],
  });
}

class RecordingHost implements ReactiveControllerHost {
  readonly updateComplete = Promise.resolve(true);
  controller: ReactiveController | undefined;
  updateCount = 0;

  addController(controller: ReactiveController): void {
    this.controller = controller;
  }

  removeController(controller: ReactiveController): void {
    if (this.controller === controller) this.controller = undefined;
  }

  requestUpdate(): void {
    this.updateCount += 1;
  }
}
