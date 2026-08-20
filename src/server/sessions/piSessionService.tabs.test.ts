import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { SessionTabsStore } from "./sessionTabsStore.js";
import { CapturingSessionEventHub, emptyArchiveStore, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const GIT = "core:workspace.git";
const TERMINAL = "core:workspace.terminal";

function serviceWith(hub: CapturingSessionEventHub, tabsStore: SessionTabsStore, records: ReturnType<typeof sessionRecord>[], archiveStore = emptyArchiveStore()) {
  return new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    archiveStore,
    tabsStore,
    sessionManager: sessionGateway(records),
    heartbeatIntervalMs: 60_000,
  });
}

describe("PiSessionService session tabs", () => {
  it("stores a tab set, merges it into listings, and broadcasts the change", async () => {
    const hub = new CapturingSessionEventHub();
    const service = serviceWith(hub, new SessionTabsStore(), [sessionRecord("tabbed"), sessionRecord("plain")]);

    const result = await service.setTabs(sessionRef("tabbed"), [GIT, TERMINAL]);

    expect(result).toEqual({ tabs: [GIT, TERMINAL] });
    expect(hub.globalEvents).toContainEqual({ type: "session.tabs", sessionId: "tabbed", cwd: "/workspace", tabs: [GIT, TERMINAL] });

    const listed = await service.list("/workspace");
    expect(listed.find((session) => session.id === "tabbed")?.tabs).toEqual([GIT, TERMINAL]);
    expect(listed.find((session) => session.id === "plain")?.tabs).toBeUndefined();

    const machine = await service.machineListing();
    expect(machine.sessions.find((session) => session.id === "tabbed")?.tabs).toEqual([GIT, TERMINAL]);

    await service.dispose();
  });

  it("does not rebroadcast an unchanged set, and clearing broadcasts an empty set", async () => {
    const hub = new CapturingSessionEventHub();
    const service = serviceWith(hub, new SessionTabsStore(), [sessionRecord("tabbed")]);

    await service.setTabs(sessionRef("tabbed"), [GIT]);
    await service.setTabs(sessionRef("tabbed"), [GIT]);
    expect(hub.globalEvents.filter((event) => event.type === "session.tabs")).toHaveLength(1);

    await service.setTabs(sessionRef("tabbed"), []);
    expect(hub.globalEvents).toContainEqual({ type: "session.tabs", sessionId: "tabbed", cwd: "/workspace", tabs: [] });
    expect((await service.list("/workspace")).find((session) => session.id === "tabbed")?.tabs).toBeUndefined();

    await service.dispose();
  });

  it("keeps tabs on archived sessions and rejects unknown ones", async () => {
    const archivedRecord = {
      sessionId: "archived",
      cwd: "/workspace",
      archivedAt: "2026-01-02T00:00:00.000Z",
      archivePath: "/archive/archived.jsonl",
      originalPath: "/sessions/archived.jsonl",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:01:00.000Z",
      messageCount: 1,
      firstMessage: "hello",
    };
    const service = serviceWith(new CapturingSessionEventHub(), new SessionTabsStore(), [], {
      ...emptyArchiveStore(),
      list: () => Promise.resolve([archivedRecord]),
      get: (sessionId) => Promise.resolve(sessionId === "archived" ? archivedRecord : undefined),
    });

    await service.setTabs(sessionRef("archived"), [TERMINAL]);
    const listed = await service.list("/workspace");
    expect(listed.find((session) => session.id === "archived")?.tabs).toEqual([TERMINAL]);

    await expect(service.setTabs(sessionRef("missing"), [GIT])).rejects.toThrow("Session not found");

    await service.dispose();
  });

  it("drops tab records for sessions that stopped existing in their workspace", async () => {
    const tabsStore = new SessionTabsStore();
    const before = serviceWith(new CapturingSessionEventHub(), tabsStore, [sessionRecord("kept"), sessionRecord("deleted")]);
    await before.setTabs(sessionRef("kept"), [GIT]);
    await before.setTabs(sessionRef("deleted"), [TERMINAL]);
    await before.dispose();

    const after = serviceWith(new CapturingSessionEventHub(), tabsStore, [sessionRecord("kept")]);
    await after.list("/workspace");

    expect((await tabsStore.list()).map((record) => record.sessionId)).toEqual(["kept"]);
    await after.dispose();
  });
});
