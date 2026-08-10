import type { ReactiveController, ReactiveControllerHost } from "lit";
import { describe, expect, it } from "vitest";
import { AppShellController } from "./appShellController";
import { NAVIGATION_DOCK_MIN_WIDTH } from "./shellLayoutMode";

/** CSS-pixel viewport widths for the acceptance device, see AGENTS.md. */
const FOLD8 = {
  unfoldedPortrait: 739,
  unfoldedLandscape: 979,
  foldedPortrait: 499,
  foldedLandscape: 789,
} as const;

describe("AppShellController chrome disclosure", () => {
  it("summons chrome exactly where navigation cannot dock", () => {
    expect(controllerAtWidth(NAVIGATION_DOCK_MIN_WIDTH - 1).isChromeSummoned).toBe(true);
    expect(controllerAtWidth(NAVIGATION_DOCK_MIN_WIDTH).isChromeSummoned).toBe(false);
  });

  it("keeps the conversation alone on the postures that cannot afford chrome", () => {
    expect(controllerAtWidth(FOLD8.foldedPortrait).isChromeSummoned).toBe(true);
    expect(controllerAtWidth(FOLD8.foldedLandscape).isChromeSummoned).toBe(true);
    expect(controllerAtWidth(FOLD8.unfoldedPortrait).isChromeSummoned).toBe(true);
  });

  it("leaves chrome resident once the shell is wide enough to dock", () => {
    expect(controllerAtWidth(FOLD8.unfoldedLandscape).isChromeSummoned).toBe(false);
    expect(controllerAtWidth(1440).isChromeSummoned).toBe(false);
  });

  it("answers from the same measurement that decides docking, not a second axis", () => {
    const controller = controllerAtWidth(FOLD8.foldedPortrait);

    expect(controller.isChromeSummoned).toBe(controller.isMobileNavigationLayout);
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
