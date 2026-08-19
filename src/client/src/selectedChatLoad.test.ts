import { describe, expect, it } from "vitest";
import { oldSession } from "./controllers/sessionController.testSupport";
import {
  selectedChatCachedReadable,
  selectedChatCanUseRuntime,
  selectedChatFailed,
  selectedChatFreshReadable,
  selectedChatHasReadableHistory,
  selectedChatIsOpening,
  selectedChatLiveReady,
  selectedChatLoading,
  selectedChatNoTarget,
  selectedChatPreviewReadable,
  selectedChatReadOnly,
  selectedChatReadability,
  selectedChatTarget,
  selectedChatTargetsEqual,
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
      selectedChatPreviewReadable(selected),
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
      "preview-readable",
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
      selectedChatPreviewReadable(selected),
      selectedChatFreshReadable(selected),
      selectedChatLiveReady(selected),
      selectedChatReadOnly(selected, "fresh"),
      selectedChatFailed(selected, "fresh", "failed"),
    ];

    expect(targetBearing.map((state) => "target" in state ? state.target : undefined)).toEqual(Array(targetBearing.length).fill(selected));
  });

  it("compares selected-chat targets by machine, session, and cwd", () => {
    const selected = target();

    expect(selectedChatTargetsEqual(selected, { ...selected })).toBe(true);
    expect(selectedChatTargetsEqual(selected, { ...selected, machineId: "machine-2" })).toBe(false);
    expect(selectedChatTargetsEqual(selected, { ...selected, sessionId: "session-2" })).toBe(false);
    expect(selectedChatTargetsEqual(selected, { ...selected, cwd: "/other" })).toBe(false);
  });

  it("derives readability and runtime-control eligibility from the tagged state", () => {
    const selected = target();

    expect(selectedChatReadability(selectedChatLoading(selected))).toBe("absent");
    expect(selectedChatReadability(selectedChatLoading(selected, "cached"))).toBe("cached");
    expect(selectedChatReadability(selectedChatCachedReadable(selected))).toBe("cached");
    expect(selectedChatReadability(selectedChatPreviewReadable(selected))).toBe("cached");
    expect(selectedChatReadability(selectedChatFreshReadable(selected))).toBe("fresh");
    expect(selectedChatReadability(selectedChatReadOnly(selected, "fresh"))).toBe("fresh");
    expect(selectedChatReadability(selectedChatFailed(selected, "cached", "failed"))).toBe("cached");
    expect(selectedChatHasReadableHistory(selectedChatLoading(selected))).toBe(false);
    expect(selectedChatHasReadableHistory(selectedChatLoading(selected, "fresh"))).toBe(true);
    expect(selectedChatIsOpening(selectedChatLoading(selected))).toBe(true);
    expect(selectedChatIsOpening(selectedChatLoading(selected, "fresh"))).toBe(true);
    expect(selectedChatIsOpening(selectedChatCachedReadable(selected))).toBe(true);
    expect(selectedChatIsOpening(selectedChatPreviewReadable(selected))).toBe(true);
    expect(selectedChatIsOpening(selectedChatFreshReadable(selected))).toBe(true);
    expect(selectedChatIsOpening(selectedChatLiveReady(selected))).toBe(false);
    expect(selectedChatCanUseRuntime(selectedChatFreshReadable(selected))).toBe(false);
    expect(selectedChatCanUseRuntime(selectedChatLiveReady(selected))).toBe(true);
  });
});
