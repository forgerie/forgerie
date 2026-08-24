import { describe, expect, it } from "vitest";
import { effectivePiWebCapabilities, isPiWebCapability, PI_WEB_CAPABILITIES, SESSIOND_RUNTIME_CAPABILITIES, WEB_RUNTIME_CAPABILITIES, parseKnownPiWebCapabilities } from "./capabilities";

describe("Forgerie capabilities", () => {
  it("advertises queued compaction only when web and sessiond both support it", () => {
    expect(PI_WEB_CAPABILITIES).toEqual({ queuedCompaction: "session.queue.compact" });
    expect(WEB_RUNTIME_CAPABILITIES).toEqual(["session.queue.compact"]);
    expect(SESSIOND_RUNTIME_CAPABILITIES).toEqual(["session.queue.compact"]);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: ["session.queue.compact"] },
      sessiond: { available: true, capabilities: ["session.queue.compact"] },
    })).toEqual(["session.queue.compact"]);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: ["session.queue.compact"] },
      sessiond: { available: true, capabilities: [] },
    })).toEqual([]);
  });

  it("keeps known capability strings when parsing runtime data", () => {
    expect(parseKnownPiWebCapabilities(["session.queue.compact", "future.capability"])).toEqual(["session.queue.compact"]);
    expect(parseKnownPiWebCapabilities(["future.capability", 1])).toBeUndefined();
    expect(isPiWebCapability("session.queue.compact")).toBe(true);
    expect(isPiWebCapability("future.capability")).toBe(false);
  });
});
