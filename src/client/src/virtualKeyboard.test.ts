import { describe, expect, it } from "vitest";
import {
  initialVirtualKeyboardState,
  reduceVirtualKeyboardState,
  VIRTUAL_KEYBOARD_MIN_INSET,
  type VirtualKeyboardState,
} from "./virtualKeyboard";

// CSS viewports measured on the acceptance device (Galaxy Z Fold, DPR 2.625).
const unfoldedPortrait = { width: 704, height: 783 };
const unfoldedLandscape = { width: 932, height: 553 };
const foldedPortrait = { width: 475, height: 638 };

function reduceAll(state: VirtualKeyboardState, samples: { width: number; height: number }[]): VirtualKeyboardState {
  return samples.reduce(reduceVirtualKeyboardState, state);
}

describe("virtualKeyboard", () => {
  it("starts closed at the initial viewport", () => {
    expect(initialVirtualKeyboardState(unfoldedPortrait).open).toBe(false);
  });

  it("opens when height collapses at constant width and closes when it recovers", () => {
    const open = reduceVirtualKeyboardState(initialVirtualKeyboardState(unfoldedPortrait), { width: 704, height: 420 });
    expect(open.open).toBe(true);

    const closed = reduceVirtualKeyboardState(open, unfoldedPortrait);
    expect(closed.open).toBe(false);
  });

  it("ignores browser-chrome height shifts below the threshold", () => {
    const state = reduceVirtualKeyboardState(initialVirtualKeyboardState(unfoldedPortrait), { width: 704, height: 783 - (VIRTUAL_KEYBOARD_MIN_INSET - 1) });
    expect(state.open).toBe(false);
  });

  it("raises the baseline when hidden chrome makes the viewport taller", () => {
    const taller = reduceVirtualKeyboardState(initialVirtualKeyboardState(unfoldedPortrait), { width: 704, height: 839 });
    expect(taller.open).toBe(false);
    expect(taller.baseline.height).toBe(839);

    // A keyboard measured against the raised baseline still opens.
    expect(reduceVirtualKeyboardState(taller, { width: 704, height: 500 }).open).toBe(true);
  });

  it("treats rotation as a new baseline, not a keyboard", () => {
    // Unfolded portrait -> landscape loses 230px of height but changes width.
    const state = reduceVirtualKeyboardState(initialVirtualKeyboardState(unfoldedPortrait), unfoldedLandscape);
    expect(state.open).toBe(false);
    expect(state.baseline).toEqual(unfoldedLandscape);
  });

  it("treats fold posture changes as a new baseline", () => {
    const state = reduceVirtualKeyboardState(initialVirtualKeyboardState(unfoldedPortrait), foldedPortrait);
    expect(state.open).toBe(false);
    expect(state.baseline).toEqual(foldedPortrait);
  });

  it("recovers across a full type-rotate-type journey", () => {
    const state = reduceAll(initialVirtualKeyboardState(unfoldedPortrait), [
      { width: 704, height: 420 }, // keyboard opens
      unfoldedLandscape, // rotate: re-baseline, keyboard state resets
      { width: 932, height: 280 }, // keyboard opens again in landscape
    ]);
    expect(state.open).toBe(true);
  });
});
