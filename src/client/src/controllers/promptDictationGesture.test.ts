import { describe, expect, it, vi } from "vitest";
import { PromptDictationGesture } from "./promptDictationGesture";

describe("PromptDictationGesture", () => {
  it("normalizes press, release, and cancel without owning hold timing", () => {
    const callbacks = {
      onPressStart: vi.fn(),
      onRelease: vi.fn(),
      onCancel: vi.fn(),
    };
    const gesture = new PromptDictationGesture({ callbacks });

    expect(gesture.press()).toBe(true);
    expect(gesture.press()).toBe(false);
    expect(gesture.state).toEqual({ tag: "pressed" });

    expect(gesture.release()).toBe(true);
    expect(gesture.release()).toBe(false);
    expect(gesture.state).toEqual({ tag: "idle" });

    expect(gesture.press()).toBe(true);
    expect(gesture.cancel()).toBe(true);
    expect(gesture.state).toEqual({ tag: "idle" });

    expect(callbacks.onPressStart).toHaveBeenCalledTimes(2);
    expect(callbacks.onRelease).toHaveBeenCalledOnce();
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
  });

  it("makes disposal terminal and silent", () => {
    const callbacks = {
      onPressStart: vi.fn(),
      onRelease: vi.fn(),
      onCancel: vi.fn(),
    };
    const gesture = new PromptDictationGesture({ callbacks });

    expect(gesture.press()).toBe(true);
    gesture.dispose();

    expect(gesture.state).toEqual({ tag: "idle" });
    expect(gesture.press()).toBe(false);
    expect(gesture.release()).toBe(false);
    expect(gesture.cancel()).toBe(false);
    expect(callbacks.onPressStart).toHaveBeenCalledOnce();
    expect(callbacks.onRelease).not.toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });
});
