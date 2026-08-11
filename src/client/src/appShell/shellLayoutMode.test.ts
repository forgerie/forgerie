import { describe, expect, it } from "vitest";
import {
  FOLD8_FOLDED_LANDSCAPE,
  FOLD8_FOLDED_PORTRAIT,
  FOLD8_UNFOLDED_LANDSCAPE,
  FOLD8_UNFOLDED_PORTRAIT,
} from "../../../../scripts/lib/fold8-postures.mjs";
import {
  NAVIGATION_DOCK_MIN_WIDTH,
  shellLayoutMode,
  shellLayoutModeClass,
} from "./shellLayoutMode";

describe("shellLayoutMode", () => {
  it("docks the navigation panel only when the session keeps a comfortable measure", () => {
    expect(shellLayoutMode(NAVIGATION_DOCK_MIN_WIDTH)).toBe("docked");
    expect(shellLayoutMode(NAVIGATION_DOCK_MIN_WIDTH - 1)).toBe("overlay");
  });

  it("gives the session the whole shell in every folded posture", () => {
    expect(shellLayoutMode(FOLD8_FOLDED_PORTRAIT.width)).toBe("overlay");
    expect(shellLayoutMode(FOLD8_FOLDED_LANDSCAPE.width)).toBe("overlay");
  });

  it("keeps both unfolded orientations free of a paradigm flip", () => {
    // Portrait overlays and landscape docks, but neither hides the session:
    // the panel slides over or beside it instead of replacing it.
    expect(shellLayoutMode(FOLD8_UNFOLDED_PORTRAIT.width)).toBe("overlay");
    expect(shellLayoutMode(FOLD8_UNFOLDED_LANDSCAPE.width)).toBe("docked");
  });

  it("treats an unmeasured shell as overlay so the session is never hidden", () => {
    expect(shellLayoutMode(0)).toBe("overlay");
    expect(shellLayoutMode(Number.NaN)).toBe("overlay");
    expect(shellLayoutMode(-100)).toBe("overlay");
  });

  it("names the mode for the shell class list", () => {
    expect(shellLayoutModeClass("overlay")).toBe("overlay-navigation");
    expect(shellLayoutModeClass("docked")).toBe("docked-navigation");
  });
});
