import { describe, expect, it } from "vitest";
import { ROW_PRESS, pressTravel, readRowPress } from "./rowPress";

describe("readRowPress", () => {
  it("opens the session on a tap", () => {
    expect(readRowPress(0, 80, ROW_PRESS)).toBe("select");
  });

  it("opens the row's commands on a hold", () => {
    expect(readRowPress(0, ROW_PRESS.holdMs, ROW_PRESS)).toBe("commands");
  });

  it("forgives the wander of a finger that means to hold still", () => {
    expect(readRowPress(ROW_PRESS.moveTolerancePx, ROW_PRESS.holdMs, ROW_PRESS)).toBe("commands");
  });

  it("gives a scroll back to the list, however long the finger stayed", () => {
    expect(readRowPress(ROW_PRESS.moveTolerancePx + 1, 5_000, ROW_PRESS)).toBe("abandoned");
  });

  it("gives a short movement back to the list rather than opening a session", () => {
    expect(readRowPress(40, 90, ROW_PRESS)).toBe("abandoned");
  });
});

describe("pressTravel", () => {
  it("measures the straight line, so travel across and down both count", () => {
    expect(pressTravel(3, 4)).toBe(5);
    expect(pressTravel(-3, -4)).toBe(5);
  });

  it("reads a still finger as no travel", () => {
    expect(pressTravel(0, 0)).toBe(0);
  });
});
