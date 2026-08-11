import { describe, expect, it } from "vitest";
import { SESSION_GUIDANCE_CUSTOM_TYPE, persistedSessionGuidance } from "./sessionGuidance.js";
import { createSessionGuidanceBridgeHandlers, createSessionGuidanceSlot } from "./sessionGuidanceBridge.js";

describe("session guidance bridge", () => {
  it("restores saved guidance before the first agent start and chains the prompt", () => {
    const slot = createSessionGuidanceSlot();
    const handlers = createSessionGuidanceBridgeHandlers(slot);
    handlers.sessionStart([{
      type: "custom",
      customType: SESSION_GUIDANCE_CUSTOM_TYPE,
      data: persistedSessionGuidance(["technical-english"]),
    }]);

    const first = handlers.beforeAgentStart("Base prompt");
    const second = handlers.beforeAgentStart("Different base");

    expect(slot.snapshot()).toEqual(["technical-english"]);
    expect(first?.systemPrompt).toMatch(/^Base prompt\n\nSession guidance:/);
    expect(second?.systemPrompt).toMatch(/^Different base\n\nSession guidance:/);
  });

  it("leaves the effective prompt byte-for-byte unchanged when guidance is empty", () => {
    const handlers = createSessionGuidanceBridgeHandlers(createSessionGuidanceSlot());

    expect(handlers.beforeAgentStart("Base prompt")).toBeUndefined();
  });

  it("clears state on session start, shutdown, and disposal", () => {
    const slot = createSessionGuidanceSlot();
    slot.replace(["technical-english"]);
    const handlers = createSessionGuidanceBridgeHandlers(slot);

    handlers.sessionStart([]);
    expect(slot.snapshot()).toEqual([]);
    slot.replace(["technical-english"]);
    handlers.sessionShutdown();
    expect(slot.snapshot()).toEqual([]);
    slot.replace(["technical-english"]);
    slot.dispose();
    expect(slot.snapshot()).toEqual([]);
  });

  it("returns defensive snapshots and ignores unknown IDs", () => {
    const slot = createSessionGuidanceSlot();
    slot.replace(["unknown", "technical-english"]);
    const snapshot = slot.snapshot();
    snapshot.length = 0;

    expect(slot.snapshot()).toEqual(["technical-english"]);
  });
});
