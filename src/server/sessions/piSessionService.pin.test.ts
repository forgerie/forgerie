import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import type { ArchiveSessionInput } from "./sessionArchiveStore.js";
import { SessionPinStore } from "./sessionPinStore.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, fakeSessionManager, resolveSessionFileFromList, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

describe("PiSessionService pinning", () => {
  it("pins a listed session, flags it in listings, and broadcasts the change", async () => {
    const hub = new CapturingSessionEventHub();
    const pinStore = new SessionPinStore();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      archiveStore: emptyArchiveStore(),
      pinStore,
      sessionManager: sessionGateway([sessionRecord("pinned-one"), sessionRecord("plain-two")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.pin(sessionRef("pinned-one"));

    expect(hub.globalEvents).toContainEqual({ type: "session.pinned", sessionId: "pinned-one", cwd: "/workspace", pinned: true });

    const listed = await service.list("/workspace");
    expect(listed.find((session) => session.id === "pinned-one")?.pinned).toBe(true);
    expect(listed.find((session) => session.id === "plain-two")?.pinned).toBeUndefined();

    const machine = await service.machineListing();
    expect(machine.sessions.find((session) => session.id === "pinned-one")?.pinned).toBe(true);
    expect(machine.sessions.find((session) => session.id === "plain-two")?.pinned).toBeUndefined();

    await service.dispose();
  });

  it("unpins and broadcasts, tolerating unknown sessions silently", async () => {
    const hub = new CapturingSessionEventHub();
    const pinStore = new SessionPinStore();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      archiveStore: emptyArchiveStore(),
      pinStore,
      sessionManager: sessionGateway([sessionRecord("pinned-one")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.pin(sessionRef("pinned-one"));
    await service.unpin(sessionRef("pinned-one"));
    await service.unpin(sessionRef("never-pinned"));

    expect(await pinStore.list()).toEqual([]);
    expect(hub.globalEvents).toContainEqual({ type: "session.pinned", sessionId: "pinned-one", cwd: "/workspace", pinned: false });
    expect((await service.list("/workspace")).find((session) => session.id === "pinned-one")?.pinned).toBeUndefined();

    await service.dispose();
  });

  it("rejects pinning archived or unknown sessions", async () => {
    const archivedRecord = { sessionId: "archived", cwd: "/workspace", archivedAt: "2026-01-02T00:00:00.000Z", archivePath: "/archive/archived.jsonl" };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      archiveStore: {
        ...emptyArchiveStore(),
        get: (sessionId) => Promise.resolve(sessionId === "archived" ? archivedRecord : undefined),
      },
      pinStore: new SessionPinStore(),
      sessionManager: sessionGateway([]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.pin(sessionRef("archived"))).rejects.toThrow("Restore session before pinning");
    await expect(service.pin(sessionRef("missing"))).rejects.toThrow("Session not found");

    await service.dispose();
  });

  it("refuses to archive a pinned session until it is unpinned", async () => {
    const fake = fakeRuntime("keeper", {
      sessionManager: fakeSessionManager("/workspace", { getSessionId: () => "keeper" }),
    });
    const archive = vi.fn((input: ArchiveSessionInput) => Promise.resolve({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" }));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      archiveStore: { ...emptyArchiveStore(), archive },
      pinStore: new SessionPinStore(),
      sessionManager: sessionGateway([sessionRecord("keeper")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.pin(sessionRef("keeper"));
    await expect(service.archive(sessionRef("keeper"))).rejects.toThrow("Unpin session before archiving");
    expect(archive).not.toHaveBeenCalled();

    await service.unpin(sessionRef("keeper"));
    await service.archive(sessionRef("keeper"));
    expect(archive).toHaveBeenCalledTimes(1);

    await service.dispose();
  });

  it("bulk archive fails pinned sessions individually and archives the rest", async () => {
    const archiveMany = vi.fn((inputs: readonly ArchiveSessionInput[]) => Promise.resolve(inputs.map((input) => ({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" }))));
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      archiveStore: { ...emptyArchiveStore(), archiveMany },
      pinStore: new SessionPinStore(),
      sessionManager: sessionGateway([sessionRecord("pinned-a"), sessionRecord("plain-b")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.pin(sessionRef("pinned-a"));
    const result = await service.archiveMany([{ id: "pinned-a", cwd: "/workspace" }, { id: "plain-b", cwd: "/workspace" }]);

    expect(result.archivedSessionIds).toEqual(["plain-b"]);
    expect(result.failures).toEqual([{ sessionId: "pinned-a", error: "Unpin session before archiving" }]);
    expect(archiveMany.mock.calls[0]?.[0].map((input) => input.sessionId)).toEqual(["plain-b"]);

    await service.dispose();
  });

  it("archive-tree skips pinned descendants and reports them", async () => {
    const root = sessionRecord("root");
    const child = { ...sessionRecord("child"), path: "/sessions/child.jsonl", parentSessionPath: root.path };
    const fake = fakeRuntime("root", { sessionFile: root.path });
    const archivedInputs: string[] = [];
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      archiveStore: {
        ...emptyArchiveStore(),
        archive: (input) => {
          archivedInputs.push(input.sessionId);
          return Promise.resolve({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-01-03T00:00:00.000Z" });
        },
      },
      pinStore: new SessionPinStore(),
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([root, child]),
        listAll: () => Promise.resolve([]),
        listParentSessionPaths: () => Promise.resolve([]),
        invalidateSessionFile: () => undefined,
        resolveSessionFile: resolveSessionFileFromList(() => Promise.resolve([root, child])),
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    await service.pin(sessionRef("child"));

    await expect(service.archiveTree(sessionRef("root"))).resolves.toEqual({
      archived: true,
      sessionIds: ["root"],
      archivedCount: 1,
      skippedAlreadyArchivedCount: 0,
      skippedPinnedCount: 1,
    });
    expect(archivedInputs).toEqual(["root"]);

    await service.dispose();
  });

  it("archive-tree refuses a pinned root outright", async () => {
    const root = sessionRecord("root");
    const fake = fakeRuntime("root", { sessionFile: root.path });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      archiveStore: emptyArchiveStore(),
      pinStore: new SessionPinStore(),
      sessionManager: sessionGateway([root]),
      heartbeatIntervalMs: 60_000,
    });

    await service.pin(sessionRef("root"));
    await expect(service.archiveTree(sessionRef("root"))).rejects.toThrow("Unpin session before archiving");

    await service.dispose();
  });

  it("cleanup never auto-archives pinned sessions", async () => {
    const idleA = { ...sessionRecord("idle-a", "/old-project"), modified: new Date("2026-01-01T00:00:00.000Z") };
    const idleB = { ...sessionRecord("idle-b", "/old-project"), modified: new Date("2026-01-01T00:00:00.000Z") };
    const archiveMany = vi.fn((inputs: readonly ArchiveSessionInput[]) => Promise.resolve(inputs.map((input) => ({ sessionId: input.sessionId, cwd: input.cwd, archivedAt: "2026-06-25T00:00:00.000Z" }))));
    const pinStore = new SessionPinStore();
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      now: () => new Date("2026-06-25T00:00:00.000Z"),
      archiveStore: { ...emptyArchiveStore(), archiveMany },
      pinStore,
      sessionManager: {
        create: () => fakeSessionManager(),
        list: () => Promise.resolve([idleA, idleB]),
        listAll: () => Promise.resolve([idleA, idleB]),
        listParentSessionPaths: () => Promise.resolve([]),
        invalidateSessionFile: () => undefined,
        resolveSessionFile: resolveSessionFileFromList(() => Promise.resolve([idleA, idleB])),
        open: () => fakeSessionManager(),
      },
      heartbeatIntervalMs: 60_000,
    });

    await service.pin(sessionRef("idle-a", "/old-project"));

    const preview = await service.cleanupPreview({ thresholds: { archiveIdleDays: 30 } });
    expect(preview.totals.archiveCount).toBe(1);

    const result = await service.cleanup({ thresholds: { archiveIdleDays: 30 } });
    expect(result.archivedSessionIds).toEqual(["idle-b"]);
    expect(archiveMany.mock.calls[0]?.[0].map((input) => input.sessionId)).toEqual(["idle-b"]);
    expect(await pinStore.isPinned("idle-a")).toBe(true);

    await service.dispose();
  });

  it("drops pins for sessions that vanished from their workspace during listing", async () => {
    const pinStore = new SessionPinStore();
    await pinStore.pin({ sessionId: "ghost", cwd: "/workspace" });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      archiveStore: emptyArchiveStore(),
      pinStore,
      sessionManager: sessionGateway([sessionRecord("still-here")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.list("/workspace");

    expect(await pinStore.isPinned("ghost")).toBe(false);
    expect(await pinStore.isPinned("still-here")).toBe(false);

    await service.dispose();
  });
});
