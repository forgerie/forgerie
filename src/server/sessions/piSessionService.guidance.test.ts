import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { SESSION_GUIDANCE_CUSTOM_TYPE } from "./sessionGuidance.js";
import { createSessionGuidanceSlot, type SessionGuidanceSlot } from "./sessionGuidanceBridge.js";
import {
  CapturingSessionEventHub,
  fakeRuntime,
  fakeSessionManager,
  runtimeCreator,
  sessionGateway,
  sessionRef,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-guidance-test-agent";

describe("PiSessionService session guidance", () => {
  it("persists a changed full snapshot before replacing live state and publishes it", async () => {
    const slot = createSessionGuidanceSlot();
    const order: string[] = [];
    const appendCustomEntry = vi.fn((customType: string, data?: unknown) => {
      order.push("append");
      expect(slot.snapshot()).toEqual([]);
      expect(customType).toBe(SESSION_GUIDANCE_CUSTOM_TYPE);
      expect(data).toEqual({ version: 1, activeIds: ["technical-english"] });
      return "entry-1";
    });
    const manager = fakeSessionManager("/workspace", { appendCustomEntry, getEntries: () => [] });
    const fake = fakeRuntime("guided-session", { sessionManager: manager });
    attachSlot(fake.runtime, slot, order);
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    const status = await service.setGuidance(sessionRef("guided-session"), "technical-english", true);
    const noOp = await service.setGuidance(sessionRef("guided-session"), "technical-english", true);

    expect(order).toEqual(["append", "replace"]);
    expect(appendCustomEntry).toHaveBeenCalledOnce();
    expect(status.activeGuidanceIds).toEqual(["technical-english"]);
    expect(noOp.activeGuidanceIds).toEqual(["technical-english"]);
    expect(hub.globalEvents.some((event) => event.type === "status.update" && event.status.activeGuidanceIds?.[0] === "technical-english")).toBe(true);
    await service.dispose();
  });

  it("leaves live guidance unchanged when persistence fails", async () => {
    const slot = createSessionGuidanceSlot();
    const manager = fakeSessionManager("/workspace", {
      appendCustomEntry: () => { throw new Error("disk full"); },
      getEntries: () => [],
    });
    const fake = fakeRuntime("failed-guidance", { sessionManager: manager });
    attachSlot(fake.runtime, slot);
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    await expect(service.setGuidance(sessionRef("failed-guidance"), "technical-english", true)).rejects.toThrow("disk full");
    expect(slot.snapshot()).toEqual([]);
    await service.dispose();
  });

  it("rejects unknown IDs and non-Boolean desired states without writing", async () => {
    const appendCustomEntry = vi.fn(() => "entry-1");
    const fake = fakeRuntime("invalid-guidance", {
      sessionManager: fakeSessionManager("/workspace", { appendCustomEntry, getEntries: () => [] }),
    });
    attachSlot(fake.runtime, createSessionGuidanceSlot());
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    await expect(service.setGuidance(sessionRef("invalid-guidance"), "unknown", true)).rejects.toThrow("Unknown guidance entry");
    await expect(service.setGuidance(sessionRef("invalid-guidance"), "technical-english", "yes")).rejects.toThrow("Guidance state must be Boolean");
    expect(appendCustomEntry).not.toHaveBeenCalled();
    await service.dispose();
  });
});

function attachSlot(
  runtime: ReturnType<typeof fakeRuntime>["runtime"],
  slot: SessionGuidanceSlot,
  order?: string[],
): void {
  const originalReplace = slot.replace.bind(slot);
  slot.replace = (activeIds) => {
    order?.push("replace");
    originalReplace(activeIds);
  };
  Object.assign(runtime.services ?? {}, { sessionGuidanceSlot: slot });
}
