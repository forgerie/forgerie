import { describe, expect, it } from "vitest";
import { composerPopoverPlacement } from "./composerPopoverPlacement";

/**
 * Placement is decided arithmetically so it can be stated as a contract rather
 * than measured from a rendered layout. The component applies the result.
 */
describe("composerPopoverPlacement", () => {
  const island = { width: 680 };
  const positionedIsland = { width: 680, height: 600 };

  it("opens above the rail, left edge aligned with its control", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { height: 180 },
    });

    expect(placement).toEqual({ side: "above", left: 216, maxWidth: 348, maxHeight: 320 });
  });

  it("positions the panel from the trigger rather than the whole editor", () => {
    const above = composerPopoverPlacement({
      anchor: { left: 216, width: 120, top: 500, bottom: 544 },
      space: { above: 500, below: 56 },
      host: positionedIsland,
      panel: { height: 180 },
    });
    const below = composerPopoverPlacement({
      anchor: { left: 216, width: 120, top: 20, bottom: 64 },
      space: { above: 20, below: 536 },
      host: positionedIsland,
      panel: { height: 180 },
    });

    expect(above).toMatchObject({ side: "above", verticalOffset: 108 });
    expect(below).toMatchObject({ side: "below", verticalOffset: 72 });
  });

  it("caps the panel without ever sizing it, so it cannot collapse", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { height: 180 },
    });

    expect(placement).not.toHaveProperty("width");
    expect(placement.maxWidth).toBe(348);
  });

  it("caps height to the selected viewport side so every choice stays reachable", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 120, below: 60 },
      host: island,
      panel: { height: 400 },
    });

    expect(placement).toMatchObject({ side: "above", maxHeight: 104 });
  });

  it("flips below when there is not enough room above", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 80, below: 400 },
      host: island,
      panel: { height: 180 },
    });

    expect(placement.side).toBe("below");
  });

  it("keeps the larger side when the panel fits neither", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 120, below: 60 },
      host: island,
      panel: { height: 400 },
    });

    expect(placement.side).toBe("above");
  });

  it("never exceeds its own maximum, nor the island", () => {
    const wide = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { height: 180 },
    });
    const phone = composerPopoverPlacement({
      anchor: { left: 120, width: 120 },
      space: { above: 400, below: 120 },
      host: { width: 300 },
      panel: { height: 180 },
    });

    expect(wide.maxWidth).toBe(348);
    expect(phone.maxWidth).toBe(284);
    expect(phone.left).toBe(8);
  });

  it("pulls a panel back inside rather than letting it overhang the right edge", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 600, width: 60 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { height: 180 },
    });

    expect(placement.left).toBe(324);
    expect(placement.left + placement.maxWidth).toBe(672);
  });

  it("keeps a control's own left edge when there is room for it", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 8, width: 60 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { height: 180 },
    });

    expect(placement.left).toBe(8);
  });
});
