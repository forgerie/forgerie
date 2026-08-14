import { describe, expect, it } from "vitest";
import { COMPOSER_QUEUE_HOLD_MS, COMPOSER_QUEUE_MOVE_TOLERANCE_PX, composerQueuePressTravel, isPrimaryQueuePointerPress, isQueueHoldKey, readComposerQueuePress } from "./composerQueuePress";

describe("composerQueuePress", () => {
  it("uses the established hold threshold and movement tolerance", () => {
    expect(COMPOSER_QUEUE_HOLD_MS).toBe(500);
    expect(COMPOSER_QUEUE_MOVE_TOLERANCE_PX).toBe(10);
  });

  it("queues before the threshold and steers at the threshold", () => {
    expect(readComposerQueuePress(0, 499)).toBe("queue");
    expect(readComposerQueuePress(0, 500)).toBe("steer");
  });

  it("abandons the press after too much movement", () => {
    expect(readComposerQueuePress(10.1, 500)).toBe("abandoned");
  });

  it("measures straight-line travel", () => {
    expect(composerQueuePressTravel(6, 8)).toBe(10);
  });

  it("arms hold only for primary pointer presses", () => {
    expect(isPrimaryQueuePointerPress({ button: 0 })).toBe(true);
    expect(isPrimaryQueuePointerPress({ button: 2 })).toBe(false);
  });

  it("recognizes Space and Enter as hold keys", () => {
    expect(isQueueHoldKey({ key: " " })).toBe(true);
    expect(isQueueHoldKey({ key: "Enter" })).toBe(true);
    expect(isQueueHoldKey({ key: "Escape" })).toBe(false);
  });
});
