// @vitest-environment happy-dom
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { mainSurfaceView, PanelIntentController, readStoredPanelIntents } from "./panelIntentController";

const DESKTOP = 1440;
const FOLDED_PORTRAIT = 499;

afterEach(() => {
  localStorage.clear();
});

describe("PanelIntentController", () => {
  it("follows the ladder until the user says otherwise", () => {
    const controller = controllerAtWidth(DESKTOP);

    expect(controller.isDocked("navigation")).toBe(true);
    expect(controller.isDocked("workspace")).toBe(true);
  });

  it("keeps a dismissal across a resize instead of re-deciding it", () => {
    const host = new RecordingHost();
    let width = DESKTOP;
    const controller = new PanelIntentController(host, { measureShellWidth: () => width });

    controller.toggle("workspace");
    width = FOLDED_PORTRAIT;
    width = DESKTOP;

    expect(controller.intents.workspace).toBe("dismissed");
    expect(controller.isDocked("workspace")).toBe(false);
  });

  it("remembers the request but not the layout, so a phone reads as untouched", () => {
    const host = new RecordingHost();
    let width = DESKTOP;
    const controller = new PanelIntentController(host, { measureShellWidth: () => width });

    controller.toggle("navigation");
    width = FOLDED_PORTRAIT;

    expect(controller.intents.navigation).toBe("dismissed");
    expect(controller.isDocked("navigation")).toBe(false);
    expect(controller.isDocked("workspace")).toBe(false);
  });

  it("survives a reload", () => {
    controllerAtWidth(DESKTOP).toggle("navigation");

    expect(readStoredPanelIntents().navigation).toBe("dismissed");
    expect(controllerAtWidth(DESKTOP).isDocked("navigation")).toBe(false);
  });

  it("falls back to the ladder when storage holds nonsense", () => {
    localStorage.setItem("pi-web-panel-intents", "{not json");

    expect(readStoredPanelIntents()).toEqual({ navigation: "auto", workspace: "auto" });
  });

  it("names the panels the stylesheet hides", () => {
    const controller = controllerAtWidth(DESKTOP);

    expect(controller.shellClass("chat")).toBe("shell chat-view");

    controller.toggle("navigation");

    expect(controller.shellClass("chat")).toBe("shell chat-view navigation-panel-collapsed");
  });

  it("keeps restored workspace tools out of the main surface", () => {
    expect(mainSurfaceView("chat")).toBe("chat");
    expect(mainSurfaceView("navigation")).toBe("navigation");
    expect(mainSurfaceView("core:workspace.files")).toBe("chat");
  });

  it("re-renders the host when a request changes", () => {
    const host = new RecordingHost();
    const controller = new PanelIntentController(host, { measureShellWidth: () => DESKTOP });

    controller.toggle("navigation");

    expect(host.updateCount).toBe(1);
  });

  it("holds still when asked to keep a panel that is already docked", () => {
    const host = new RecordingHost();
    const controller = new PanelIntentController(host, { measureShellWidth: () => DESKTOP });

    controller.keep("navigation");

    expect(host.updateCount).toBe(0);
  });
});

function controllerAtWidth(width: number): PanelIntentController {
  return new PanelIntentController(new RecordingHost(), { measureShellWidth: () => width });
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
