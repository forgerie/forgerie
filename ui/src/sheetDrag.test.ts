import { describe, expect, it } from "vitest";
import { releaseSheet, SHEET_DRAG, SHEET_IDLE, trackSheet, withinAngle, type SheetDrag } from "./sheetDrag";

const SHEET = 300;
const track = (current: SheetDrag, dx: number, dy: number, open = false) => trackSheet({ current, open, dx, dy, sheetWidthPx: SHEET });

describe("pulling the sheet in", () => {
  it("ignores a drag that has not travelled far enough to be meant", () => {
    expect(track(SHEET_IDLE, SHEET_DRAG.capturePx - 1, 0)).toEqual(SHEET_IDLE);
  });
  it("follows a rightward drag by the sheet's own width", () => {
    expect(track(SHEET_IDLE, 60, 0)).toEqual({ type: "tracking", gesture: "opening", progress: 0.2 });
    expect(track(SHEET_IDLE, SHEET * 3, 0)).toMatchObject({ progress: 1 });
  });
  it("leaves a leftward drag alone while the sheet is closed", () => {
    expect(track(SHEET_IDLE, -60, 0)).toEqual(SHEET_IDLE);
  });
  it("gives a scroll back to the list, and forgives a thumb's arc", () => {
    expect(track(SHEET_IDLE, 30, 120)).toEqual(SHEET_IDLE);
    expect(track(SHEET_IDLE, 100, 36)).toMatchObject({ type: "tracking" });
  });
  it("keeps the drag once captured, even back past its start", () => {
    expect(track(track(SHEET_IDLE, 60, 0), -40, 0)).toEqual({ type: "tracking", gesture: "opening", progress: 0 });
  });
  it("holds still before the shell is measured", () => {
    expect(trackSheet({ current: SHEET_IDLE, open: false, dx: 200, dy: 0, sheetWidthPx: 0 })).toEqual(SHEET_IDLE);
  });
  it("opens past the commit point and slides back short of it", () => {
    expect(releaseSheet({ type: "tracking", gesture: "opening", progress: SHEET_DRAG.commitFraction })).toBe(true);
    expect(releaseSheet({ type: "tracking", gesture: "opening", progress: SHEET_DRAG.commitFraction - 0.01 })).toBe(false);
  });
});

describe("claiming a drag from the browser", () => {
  it("claims only as steep as the sheet takes, so a 40-degree drag stays a scroll", () => {
    expect(withinAngle(10, 5)).toBe(true);
    expect(withinAngle(10, 8.4)).toBe(false);
    expect(withinAngle(0, 0)).toBe(false);
  });
});

describe("pushing the sheet back", () => {
  it("follows a leftward drag on an open sheet", () => {
    expect(track(SHEET_IDLE, -SHEET / 2, 0, true)).toEqual({ type: "tracking", gesture: "closing", progress: 0.5 });
  });
  it("ignores a rightward drag on an open sheet", () => {
    expect(track(SHEET_IDLE, 60, 0, true)).toEqual(SHEET_IDLE);
  });
  it("keeps pushing across a whole retreat, and pulls open again when it reverses", () => {
    let drag = track(SHEET_IDLE, -30, 0, true);
    for (const dx of [-45, -60, -75]) drag = track(drag, dx, 0, true);
    expect(drag).toEqual({ type: "tracking", gesture: "closing", progress: 0.75 });
    expect(track(drag, 20, 0, true)).toEqual({ type: "tracking", gesture: "closing", progress: 1 });
  });
  it("closes after a fifth of the sheet, and holds a nudge", () => {
    expect(releaseSheet(track(SHEET_IDLE, -SHEET * 0.25, 0, true))).toBe(false);
    expect(releaseSheet(track(SHEET_IDLE, -SHEET * 0.1, 0, true))).toBe(true);
  });
  it("reports nothing for a drag that never became the sheet's", () => {
    expect(releaseSheet(SHEET_IDLE)).toBeUndefined();
  });
});
