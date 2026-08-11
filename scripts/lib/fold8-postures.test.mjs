import { describe, expect, it } from "vitest";
import {
  FOLD8_DPR,
  FOLD8_FOLDED_LANDSCAPE,
  FOLD8_FOLDED_PORTRAIT,
  FOLD8_POSTURES,
  FOLD8_UNFOLDED_LANDSCAPE,
  FOLD8_UNFOLDED_PORTRAIT,
} from "./fold8-postures.mjs";

describe("Galaxy Z Fold 8 posture fixture", () => {
  it("keeps the measured postures in acceptance order", () => {
    expect(FOLD8_DPR).toBe(2.625);
    expect(FOLD8_POSTURES).toEqual([
      FOLD8_UNFOLDED_PORTRAIT,
      FOLD8_UNFOLDED_LANDSCAPE,
      FOLD8_FOLDED_PORTRAIT,
      FOLD8_FOLDED_LANDSCAPE,
    ]);
    expect(FOLD8_POSTURES).toEqual([
      { name: "unfolded-portrait", width: 704, height: 783 },
      { name: "unfolded-landscape", width: 932, height: 553 },
      { name: "folded-portrait", width: 475, height: 638 },
      { name: "folded-landscape", width: 711, height: 374 },
    ]);
  });
});
