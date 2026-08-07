import type { ReactiveController, ReactiveControllerHost } from "lit";
import { describe, expect, it } from "vitest";
import { OnScreenKeyboardController, type KeyboardViewport } from "./onScreenKeyboardController";

class RecordingControllerHost implements ReactiveControllerHost {
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

class ConfigurableKeyboardViewport implements KeyboardViewport {
  private readonly resizeListeners = new Set<EventListener>();

  constructor(public innerWidth: number, public innerHeight: number) {}

  addEventListener(_type: "resize", listener: EventListener): void {
    this.resizeListeners.add(listener);
  }

  removeEventListener(_type: "resize", listener: EventListener): void {
    this.resizeListeners.delete(listener);
  }

  resizeTo(width: number, height: number): void {
    this.innerWidth = width;
    this.innerHeight = height;
    for (const listener of this.resizeListeners) listener(new Event("resize"));
  }
}

describe("OnScreenKeyboardController", () => {
  it("opens only for a keyboard-sized height reduction while the composer has focus", () => {
    const host = new RecordingControllerHost();
    const viewport = new ConfigurableKeyboardViewport(499, 789);
    let composerFocused = false;
    const controller = new OnScreenKeyboardController(host, {
      viewport,
      isComposerFocused: () => composerFocused,
      isTouchInput: () => true,
    });
    host.controller?.hostConnected?.();

    viewport.resizeTo(499, 500);
    expect(controller.isOpen).toBe(false);

    viewport.resizeTo(499, 789);
    composerFocused = true;
    viewport.resizeTo(499, 730);
    expect(controller.isOpen).toBe(false);

    viewport.resizeTo(499, 500);
    expect(controller.isOpen).toBe(true);
    expect(host.updateCount).toBe(1);

    viewport.resizeTo(499, 789);
    expect(controller.isOpen).toBe(false);
    expect(host.updateCount).toBe(2);
  });

  it("preserves open state across a posture change until the viewport expands", () => {
    const host = new RecordingControllerHost();
    const viewport = new ConfigurableKeyboardViewport(499, 789);
    const controller = new OnScreenKeyboardController(host, {
      viewport,
      isComposerFocused: () => true,
      isTouchInput: () => true,
    });
    host.controller?.hostConnected?.();

    viewport.resizeTo(499, 500);
    viewport.resizeTo(789, 260);
    expect(controller.isOpen).toBe(true);

    viewport.resizeTo(789, 499);
    expect(controller.isOpen).toBe(false);
  });

  it("stops observing resize events after disconnection", () => {
    const host = new RecordingControllerHost();
    const viewport = new ConfigurableKeyboardViewport(499, 789);
    const controller = new OnScreenKeyboardController(host, {
      viewport,
      isComposerFocused: () => true,
      isTouchInput: () => true,
    });
    host.controller?.hostConnected?.();
    host.controller?.hostDisconnected?.();

    viewport.resizeTo(499, 500);

    expect(controller.isOpen).toBe(false);
    expect(host.updateCount).toBe(0);
  });
});
