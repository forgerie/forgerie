import { describe, expect, it } from "vitest";
import { effectivePiWebCapabilities, isPiWebCapability, PI_WEB_CAPABILITIES, SESSIOND_RUNTIME_CAPABILITIES, WEB_RUNTIME_CAPABILITIES, parseKnownPiWebCapabilities } from "./capabilities";

describe("Forgerie capabilities", () => {
  it("advertises queued compaction only when web and sessiond both support it", () => {
    expect(PI_WEB_CAPABILITIES).toEqual({ queuedCompaction: "session.queue.compact", promptRequestIds: "session.prompt.requestIds" });
    expect(WEB_RUNTIME_CAPABILITIES).toEqual(["session.queue.compact"]);
    expect(SESSIOND_RUNTIME_CAPABILITIES).toEqual(["session.queue.compact", "session.prompt.requestIds"]);

    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: ["session.queue.compact"] },
      sessiond: { available: true, capabilities: ["session.queue.compact"] },
    })).toEqual(["session.queue.compact"]);
    expect(effectivePiWebCapabilities({
      web: { available: true, capabilities: ["session.queue.compact"] },
      sessiond: { available: true, capabilities: [] },
    })).toEqual([]);
  });

  it("requires the daemon to advertise prompt request IDs, not the web proxy", () => {
    expect(effectivePiWebCapabilities({ sessiond: { available: true, capabilities: [PI_WEB_CAPABILITIES.promptRequestIds] } }))
      .toEqual([PI_WEB_CAPABILITIES.promptRequestIds]);
    expect(effectivePiWebCapabilities({ web: { available: true, capabilities: [PI_WEB_CAPABILITIES.promptRequestIds] } })).toEqual([]);
    expect(effectivePiWebCapabilities({ sessiond: { available: false, capabilities: [PI_WEB_CAPABILITIES.promptRequestIds] } })).toEqual([]);
  });

  it("keeps known capability strings when parsing runtime data", () => {
    expect(parseKnownPiWebCapabilities(["session.queue.compact", "future.capability"])).toEqual(["session.queue.compact"]);
    expect(parseKnownPiWebCapabilities(["future.capability", 1])).toBeUndefined();
    expect(isPiWebCapability("session.queue.compact")).toBe(true);
    expect(isPiWebCapability("future.capability")).toBe(false);
  });
});
