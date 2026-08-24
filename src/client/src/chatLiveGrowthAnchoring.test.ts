import { describe, expect, it } from "vitest";
import { selectLiveGrowthAnchor, scrollDeltaForLiveGrowth } from "./chatLiveGrowthAnchoring";

describe("live ledger growth anchoring", () => {
  it("selects the nearest expanded-rail end at or above the viewport", () => {
    expect(selectLiveGrowthAnchor([
      { id: "far-above", offset: -300 },
      { id: "near-above", offset: -12 },
      { id: "below", offset: 40 },
    ])).toEqual({ id: "near-above", offset: -12 });
  });

  it("does nothing when every expanded rail still ends below the viewport", () => {
    expect(selectLiveGrowthAnchor([
      { id: "below-near", offset: 10 },
      { id: "below-far", offset: 200 },
    ])).toBeUndefined();
  });

  it("returns the scroll correction that keeps the rail end in place", () => {
    expect(scrollDeltaForLiveGrowth(38, -12)).toBe(50);
  });
});
