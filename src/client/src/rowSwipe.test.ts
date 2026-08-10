import { describe, expect, it } from "vitest";

import { commitDistance, readSwipe } from "./rowSwipe";

const CONFIG = { engagePx: 10, commitPx: 80 } as const;

describe("readSwipe", () => {
  it("stays at rest until the finger travels far enough", () => {
    expect(readSwipe(-9, 0, CONFIG)).toEqual({ offset: 0, engaged: false, willArchive: false });
  });

  it("engages once the finger passes the threshold", () => {
    expect(readSwipe(-10, 0, CONFIG)).toEqual({ offset: -10, engaged: true, willArchive: false });
  });

  it("leaves a scroll alone when the finger moves further down than across", () => {
    // A finger that runs down the list also drifts sideways. That drift must
    // not open a row.
    expect(readSwipe(-30, 60, CONFIG)).toEqual({ offset: 0, engaged: false, willArchive: false });
    expect(readSwipe(-30, -60, CONFIG)).toEqual({ offset: 0, engaged: false, willArchive: false });
  });

  it("takes the movement when it runs further across than down", () => {
    expect(readSwipe(-60, 30, CONFIG).engaged).toBe(true);
  });

  it("does not move the row to the right", () => {
    // The row has one action, on one side.
    expect(readSwipe(40, 0, CONFIG)).toEqual({ offset: 0, engaged: true, willArchive: false });
  });

  it("arms the archive at the commit distance", () => {
    expect(readSwipe(-79, 0, CONFIG).willArchive).toBe(false);
    expect(readSwipe(-80, 0, CONFIG).willArchive).toBe(true);
    expect(readSwipe(-200, 0, CONFIG).willArchive).toBe(true);
  });

  it("reads no movement as rest", () => {
    expect(readSwipe(0, 0, CONFIG)).toEqual({ offset: 0, engaged: false, willArchive: false });
  });
});

describe("commitDistance", () => {
  it("asks for the same share of any ordinary row", () => {
    expect(commitDistance(340)).toBeCloseTo(119, 5);
  });

  it("does not arm on a twitch in a narrow row", () => {
    expect(commitDistance(100)).toBe(64);
  });

  it("does not ask for a stretch across a wide row", () => {
    expect(commitDistance(900)).toBe(140);
  });
});
