import { describe, expect, it } from "vitest";
import { composerPopoverPlacement } from "./composerPopoverPlacement";

/**
 * Placement is decided arithmetically so it can be stated as a contract rather
 * than measured from a rendered layout. The component applies the result.
 */
describe("composerPopoverPlacement", () => {
  const island = { width: 680 };

  it("opens above the rail, left edge aligned with its control", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { width: 300, height: 180 },
    });

    expect(placement).toEqual({ side: "above", left: 216, width: 300 });
  });

  it("flips below when there is not enough room above", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 80, below: 400 },
      host: island,
      panel: { width: 300, height: 180 },
    });

    expect(placement.side).toBe("below");
  });

  it("keeps the larger side when the panel fits neither", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 120, below: 60 },
      host: island,
      panel: { width: 300, height: 400 },
    });

    expect(placement.side).toBe("above");
  });

  it("never exceeds its own maximum, nor the island", () => {
    const wide = composerPopoverPlacement({
      anchor: { left: 216, width: 120 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { width: 900, height: 180 },
    });
    const phone = composerPopoverPlacement({
      anchor: { left: 120, width: 120 },
      space: { above: 400, below: 120 },
      host: { width: 300 },
      panel: { width: 348, height: 180 },
    });

    expect(wide.width).toBe(348);
    expect(phone.width).toBe(284);
    expect(phone.left).toBe(8);
  });

  it("pulls a panel back inside rather than letting it overhang the right edge", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 600, width: 60 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { width: 300, height: 180 },
    });

    expect(placement.left).toBe(372);
    expect(placement.left + placement.width).toBe(672);
  });

  it("keeps a control's own left edge when there is room for it", () => {
    const placement = composerPopoverPlacement({
      anchor: { left: 8, width: 60 },
      space: { above: 400, below: 120 },
      host: island,
      panel: { width: 200, height: 180 },
    });

    expect(placement.left).toBe(8);
  });
});
