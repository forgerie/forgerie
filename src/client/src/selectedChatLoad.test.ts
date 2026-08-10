import { describe, expect, it } from "vitest";
import { oldSession } from "./controllers/sessionController.testSupport";
import {
  selectedChatCachedReadable,
  selectedChatCanUseRuntime,
  selectedChatFailed,
  selectedChatFreshReadable,
  selectedChatHasReadableHistory,
  selectedChatLiveReady,
  selectedChatLoading,
  selectedChatNoTarget,
  selectedChatReadOnly,
  selectedChatReadability,
  selectedChatTarget,
  type SelectedChatLoad,
} from "./selectedChatLoad";

function target() {
  return selectedChatTarget("machine-1", oldSession);
}

describe("SelectedChatLoad", () => {
  it("represents every selected-chat load phase with an explicit tag", () => {
    const selected = target();
    const states: SelectedChatLoad[] = [
      selectedChatNoTarget(),
      selectedChatLoading(selected),
      selectedChatLoading(selected, "cached"),
      selectedChatCachedReadable(selected),
      selectedChatFreshReadable(selected),
      selectedChatLiveReady(selected),
      selectedChatReadOnly(selected, "fresh"),
      selectedChatFailed(selected, "absent", new Error("boom")),
      selectedChatFailed(selected, "cached", new Error("boom")),
      selectedChatFailed(selected, "fresh", new Error("boom")),
    ];

    expect(states.map((state) => state.kind)).toEqual([
      "no-target",
      "loading-without-content",
      "loading-with-readable-history",
      "cached-readable",
      "fresh-readable",
      "live-ready",
      "read-only",
      "failed",
      "failed",
      "failed",
    ]);
  });

  it("carries machine and session identity on every target-bearing state", () => {
    const selected = target();
    const targetBearing = [
      selectedChatLoading(selected),
      selectedChatLoading(selected, "fresh"),
      selectedChatCachedReadable(selected),
      selectedChatFreshReadable(selected),
      selectedChatLiveReady(selected),
      selectedChatReadOnly(selected, "fresh"),
      selectedChatFailed(selected, "fresh", "failed"),
    ];

    expect(targetBearing.map((state) => "target" in state ? state.target : undefined)).toEqual(Array(targetBearing.length).fill(selected));
  });

  it("derives readability and runtime-control eligibility from the tagged state", () => {
    const selected = target();

    expect(selectedChatReadability(selectedChatLoading(selected))).toBe("absent");
    expect(selectedChatReadability(selectedChatLoading(selected, "cached"))).toBe("cached");
    expect(selectedChatReadability(selectedChatCachedReadable(selected))).toBe("cached");
    expect(selectedChatReadability(selectedChatFreshReadable(selected))).toBe("fresh");
    expect(selectedChatReadability(selectedChatReadOnly(selected, "fresh"))).toBe("fresh");
    expect(selectedChatReadability(selectedChatFailed(selected, "cached", "failed"))).toBe("cached");
    expect(selectedChatHasReadableHistory(selectedChatLoading(selected))).toBe(false);
    expect(selectedChatHasReadableHistory(selectedChatLoading(selected, "fresh"))).toBe(true);
    expect(selectedChatCanUseRuntime(selectedChatFreshReadable(selected))).toBe(false);
    expect(selectedChatCanUseRuntime(selectedChatLiveReady(selected))).toBe(true);
  });
});
