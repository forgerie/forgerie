import { describe, expect, it } from "vitest";
import { distanceFromScrollBottom, isNearScrollBottom } from "./chatScrollPosition";

describe("chat scroll position", () => {
  it("measures the remaining distance below the viewport", () => {
    expect(distanceFromScrollBottom({ scrollTop: 500, scrollHeight: 1_200, clientHeight: 400 })).toBe(300);
  });

  it("treats the configured tail threshold as near the bottom", () => {
    expect(isNearScrollBottom({ scrollTop: 753, scrollHeight: 1_200, clientHeight: 400 })).toBe(true);
    expect(isNearScrollBottom({ scrollTop: 752, scrollHeight: 1_200, clientHeight: 400 })).toBe(false);
  });
});
