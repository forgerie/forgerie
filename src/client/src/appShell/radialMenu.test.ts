import { describe, expect, it } from "vitest";
import {
  RADIAL_MENU,
  radialBearing,
  radialGlyphPoint,
  radialLayout,
  radialSectorPath,
  radialSelectionAt,
  radialSlotBearing,
  type RadialViewport,
} from "./radialMenu";

const UNFOLDED_PORTRAIT: RadialViewport = { width: 704, height: 783 };
const COVER_LANDSCAPE: RadialViewport = { width: 711, height: 374 };

/** Every acceptance posture from AGENTS.md, so a claim covers the whole matrix. */
const POSTURES: readonly RadialViewport[] = [
  { width: 704, height: 783 },
  { width: 932, height: 553 },
  { width: 475, height: 638 },
  COVER_LANDSCAPE,
];

describe("radialSlotBearing", () => {
  it("puts slot zero to the left, where a right thumb reaches without a diagonal", () => {
    expect(radialSlotBearing(0, 8)).toBe(180);
  });

  it("gives the same bearing for a slot no matter where the press landed", () => {
    // The premise of the whole design: a slot's direction is a constant, not a
    // function of the gesture. Nothing here takes a press point at all.
    expect(radialSlotBearing(2, 8)).toBe(radialSlotBearing(2, 8));
    expect(radialSlotBearing(2, 8)).toBe(270);
  });

  it("spaces eight slots at forty-five degrees", () => {
    const bearings = [0, 1, 2, 3, 4, 5, 6, 7].map((slot) => radialSlotBearing(slot, 8));
    expect(bearings).toEqual([180, 225, 270, 315, 0, 45, 90, 135]);
  });
});

describe("radialLayout", () => {
  it("declines a wheel that cannot hold two wedges", () => {
    expect(radialLayout({ x: 300, y: 300 }, UNFOLDED_PORTRAIT, 1)).toBeUndefined();
  });

  it("uses the preferred radius when there is room", () => {
    const layout = radialLayout({ x: 350, y: 390 }, UNFOLDED_PORTRAIT, 8);
    expect(layout?.outer).toBe(RADIAL_MENU.preferredRadiusPx);
  });

  it("shrinks rather than rotates when the press is near an edge", () => {
    const layout = radialLayout({ x: 60, y: 390 }, UNFOLDED_PORTRAIT, 8);
    expect(layout?.outer).toBeLessThan(RADIAL_MENU.preferredRadiusPx);
    // Shrunk, but every direction is exactly where it always is.
    expect(layout?.wedges.map((wedge) => wedge.centre))
      .toEqual([180, 225, 270, 315, 0, 45, 90, 135]);
  });

  it("stops shrinking at the floor and clips instead", () => {
    const layout = radialLayout({ x: 4, y: 4 }, UNFOLDED_PORTRAIT, 8);
    expect(layout?.outer).toBe(RADIAL_MENU.minRadiusPx);
  });

  it("keeps every slot present in every posture, even when icons cannot be drawn", () => {
    for (const viewport of POSTURES) {
      for (const press of [{ x: 0, y: 0 }, { x: viewport.width, y: viewport.height }, { x: 12, y: viewport.height - 8 }]) {
        const layout = radialLayout(press, viewport, 8);
        expect(layout?.wedges).toHaveLength(8);
      }
    }
  });
});

describe("radialGlyphPoint", () => {
  it("keeps an icon on screen by moving it along its own ray, never sideways", () => {
    const press = { x: 690, y: 360 };
    const layout = radialLayout(press, COVER_LANDSCAPE, 8);
    if (layout === undefined) throw new Error("expected a layout");

    for (const wedge of layout.wedges) {
      const point = radialGlyphPoint(layout, wedge);
      if (point === undefined) continue;
      // On its ray: the bearing from the press to the icon is the wedge's own.
      expect(radialBearing(press, point)).toBeCloseTo(wedge.centre, 4);
    }
  });

  it("reports an icon as unplaceable rather than drawing it off screen", () => {
    const layout = radialLayout({ x: 706, y: 370 }, COVER_LANDSCAPE, 8);
    if (layout === undefined) throw new Error("expected a layout");

    const placed = layout.wedges.filter((wedge) => radialGlyphPoint(layout, wedge) !== undefined);
    expect(placed.length).toBeLessThan(layout.wedges.length);
    for (const wedge of placed) {
      const point = radialGlyphPoint(layout, wedge);
      if (point === undefined) throw new Error("expected a point");
      expect(point.x).toBeGreaterThanOrEqual(RADIAL_MENU.marginPx);
      expect(point.x).toBeLessThanOrEqual(COVER_LANDSCAPE.width - RADIAL_MENU.marginPx);
      expect(point.y).toBeGreaterThanOrEqual(RADIAL_MENU.marginPx);
      expect(point.y).toBeLessThanOrEqual(COVER_LANDSCAPE.height - RADIAL_MENU.marginPx);
    }
  });
});

describe("radialSelectionAt", () => {
  const press = { x: 350, y: 390 };
  const layout = radialLayout(press, UNFOLDED_PORTRAIT, 8);

  it("chooses nothing inside the dead zone, so a press with no travel cancels", () => {
    if (layout === undefined) throw new Error("expected a layout");
    expect(radialSelectionAt(layout, { x: press.x + 4, y: press.y }, 8)).toBeUndefined();
  });

  it("chooses the slot the finger points at", () => {
    if (layout === undefined) throw new Error("expected a layout");
    expect(radialSelectionAt(layout, { x: press.x - 90, y: press.y }, 8)).toBe(0);
    expect(radialSelectionAt(layout, { x: press.x, y: press.y - 90 }, 8)).toBe(2);
    expect(radialSelectionAt(layout, { x: press.x + 90, y: press.y }, 8)).toBe(4);
    expect(radialSelectionAt(layout, { x: press.x, y: press.y + 90 }, 8)).toBe(6);
  });

  it("ignores distance past the dead zone, so an off-screen wedge stays reachable", () => {
    if (layout === undefined) throw new Error("expected a layout");
    const near = radialSelectionAt(layout, { x: press.x - 40, y: press.y }, 8);
    const far = radialSelectionAt(layout, { x: press.x - 4000, y: press.y }, 8);
    expect(near).toBe(far);
  });

  it("selects every slot from its own icon position", () => {
    if (layout === undefined) throw new Error("expected a layout");
    for (const wedge of layout.wedges) {
      const point = radialGlyphPoint(layout, wedge);
      if (point === undefined) continue;
      expect(radialSelectionAt(layout, point, 8)).toBe(wedge.slot);
    }
  });
});

describe("radialSectorPath", () => {
  it("describes a closed donut sector", () => {
    const layout = radialLayout({ x: 350, y: 390 }, UNFOLDED_PORTRAIT, 8);
    if (layout === undefined) throw new Error("expected a layout");
    const wedge = layout.wedges[0];
    if (wedge === undefined) throw new Error("expected a wedge");
    const path = radialSectorPath(layout, wedge);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect(path).toContain("A");
  });
});
