import { describe, expect, it, vi } from "vitest";
import { PiSessionService, type PiAgentSession } from "./piSessionService.js";
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

  it("clears the runtime slot when the service is disposed", async () => {
    const slot = createSessionGuidanceSlot();
    slot.replace(["technical-english"]);
    const fake = fakeRuntime("dispose-guidance");
    attachSlot(fake.runtime, slot);
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    await service.dispose();

    expect(slot.snapshot()).toEqual([]);
  });

  it("clears prior guidance before binding a replacement session", async () => {
    const slot = createSessionGuidanceSlot();
    slot.replace(["technical-english"]);
    const original = fakeRuntime("original-guidance");
    const replacement = fakeRuntime("replacement-guidance", {
      sessionManager: fakeSessionManager("/workspace", {
        getSessionId: () => "replacement-guidance",
        getEntries: () => [],
      }),
    });
    attachSlot(original.runtime, slot);
    let rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;
    original.runtime.setRebindSession = (callback) => { rebindSession = callback; };
    replacement.session.bindExtensions = () => {
      expect(slot.snapshot()).toEqual([]);
      return Promise.resolve();
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(original.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    if (rebindSession === undefined) throw new Error("Expected runtime rebind callback");
    if (!Reflect.set(original.runtime, "session", replacement.session)) throw new Error("Could not replace runtime session");
    await rebindSession(replacement.session);

    expect(slot.snapshot()).toEqual([]);
    await service.dispose();
  });

  it("keeps replacement guidance when replacement binding fails after apply", async () => {
    const slot = createSessionGuidanceSlot();
    slot.replace(["technical-english"]);
    const original = fakeRuntime("original-failed-rebind");
    const replacement = fakeRuntime("replacement-failed-rebind", {
      sessionManager: fakeSessionManager("/workspace", {
        getSessionId: () => "replacement-failed-rebind",
        getEntries: () => [],
      }),
    });
    attachSlot(original.runtime, slot);
    let rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;
    original.runtime.setRebindSession = (callback) => { rebindSession = callback; };
    replacement.session.bindExtensions = () => Promise.reject(new Error("bind failed"));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(original.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    if (rebindSession === undefined) throw new Error("Expected runtime rebind callback");
    if (!Reflect.set(original.runtime, "session", replacement.session)) throw new Error("Could not replace runtime session");
    await expect(rebindSession(replacement.session)).rejects.toThrow("bind failed");

    expect(slot.snapshot()).toEqual([]);
    await service.dispose();
  });

  it("restores active guidance when an in-place reload fails after shutdown", async () => {
    const slot = createSessionGuidanceSlot();
    slot.replace(["technical-english"]);
    const fake = fakeRuntime("failed-guidance-reload");
    attachSlot(fake.runtime, slot);
    fake.session.reload = () => {
      slot.replace([]);
      return Promise.reject(new Error("reload failed after shutdown"));
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    await expect(service.runCommand(sessionRef("failed-guidance-reload"), "/reload")).resolves.toMatchObject({
      type: "unsupported",
      message: "Reload failed: reload failed after shutdown",
    });

    expect(slot.snapshot()).toEqual(["technical-english"]);
    await service.dispose();
  });

  it("rejects even an idempotent change during active tree navigation", async () => {
    let finishNavigation!: () => void;
    const navigation = new Promise<{ cancelled: false }>((resolve) => {
      finishNavigation = () => { resolve({ cancelled: false }); };
    });
    const navigateTree = vi.fn(() => navigation);
    const slot = createSessionGuidanceSlot();
    slot.replace(["technical-english"]);
    const fake = fakeRuntime("navigating-guidance", { navigateTree });
    attachSlot(fake.runtime, slot);
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    const navigating = service.navigateTree(sessionRef("navigating-guidance"), {
      targetId: "target-1",
      expectedLeafId: "leaf-1",
      summary: { mode: "none" },
    });
    await vi.waitFor(() => { expect(navigateTree).toHaveBeenCalledOnce(); });

    await expect(service.setGuidance(sessionRef("navigating-guidance"), "technical-english", true)).rejects.toThrow(
      "Cannot change session guidance while session tree navigation is active",
    );
    expect(slot.snapshot()).toEqual(["technical-english"]);

    finishNavigation();
    await navigating;
    await service.dispose();
  });

  it("persists inherited guidance when a tree fork does not copy custom entries", async () => {
    const slot = createSessionGuidanceSlot();
    slot.replace(["technical-english"]);
    const original = fakeRuntime("source-guidance", {
      sessionManager: fakeSessionManager("/workspace", {
        getSessionId: () => "source-guidance",
        getLeafId: () => "leaf-1",
      }),
    });
    const appendCustomEntry = vi.fn(() => "inherited-guidance");
    const replacement = fakeRuntime("forked-guidance", {
      sessionManager: fakeSessionManager("/workspace", {
        getSessionId: () => "forked-guidance",
        getEntries: () => [],
        appendCustomEntry,
      }),
    });
    attachSlot(original.runtime, slot);
    let rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;
    original.runtime.setRebindSession = (callback) => { rebindSession = callback; };
    original.runtime.fork = async () => {
      if (rebindSession === undefined) throw new Error("Expected runtime rebind callback");
      if (!Reflect.set(original.runtime, "session", replacement.session)) throw new Error("Could not replace runtime session");
      await rebindSession(replacement.session);
      return { cancelled: false };
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(original.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    await expect(service.forkFromTree(sessionRef("source-guidance"), {
      entryId: "entry-1",
      expectedLeafId: "leaf-1",
    })).resolves.toMatchObject({ cancelled: false, session: { id: "forked-guidance" } });

    expect(appendCustomEntry).toHaveBeenCalledWith(
      SESSION_GUIDANCE_CUSTOM_TYPE,
      { version: 1, activeIds: ["technical-english"] },
    );
    expect(slot.snapshot()).toEqual(["technical-english"]);
    await service.dispose();
  });

  it("keeps a completed fork when guidance inheritance persistence fails", async () => {
    const slot = createSessionGuidanceSlot();
    slot.replace(["technical-english"]);
    const original = fakeRuntime("source-guidance-failure", {
      sessionManager: fakeSessionManager("/workspace", {
        getSessionId: () => "source-guidance-failure",
        getLeafId: () => "leaf-1",
      }),
    });
    const replacement = fakeRuntime("forked-guidance-failure", {
      sessionManager: fakeSessionManager("/workspace", {
        getSessionId: () => "forked-guidance-failure",
        getEntries: () => [],
        appendCustomEntry: () => { throw new Error("guidance disk full"); },
      }),
    });
    attachSlot(original.runtime, slot);
    let rebindSession: ((session: PiAgentSession) => Promise<void>) | undefined;
    original.runtime.setRebindSession = (callback) => { rebindSession = callback; };
    original.runtime.fork = async () => {
      if (rebindSession === undefined) throw new Error("Expected runtime rebind callback");
      if (!Reflect.set(original.runtime, "session", replacement.session)) throw new Error("Could not replace runtime session");
      await rebindSession(replacement.session);
      return { cancelled: false };
    };
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(original.runtime),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await service.start("/workspace");
    await expect(service.forkFromTree(sessionRef("source-guidance-failure"), {
      entryId: "entry-1",
      expectedLeafId: "leaf-1",
    })).resolves.toMatchObject({ cancelled: false, session: { id: "forked-guidance-failure" } });
    expect(hub.globalEvents.some((event) => event.type === "activity.update" && event.activity.phase === "error")).toBe(true);
    await service.dispose();
  });

  it("rejects archived mutations without opening an agent runtime", async () => {
    const createAgentRuntime = vi.fn(() => Promise.reject(new Error("runtime must not open")));
    const archived = {
      sessionId: "archived-guidance",
      cwd: "/workspace",
      archivedAt: "2026-08-10T00:00:00.000Z",
      archivePath: "/archive/archived-guidance.jsonl",
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime,
      archiveStore: {
        list: () => Promise.resolve([archived]),
        get: () => Promise.resolve(archived),
        archive: () => Promise.reject(new Error("archive should not be called")),
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(true),
      },
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.setGuidance(sessionRef("archived-guidance"), "technical-english", true)).rejects.toThrow(
      "Archived sessions are read-only",
    );
    expect(createAgentRuntime).not.toHaveBeenCalled();
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
