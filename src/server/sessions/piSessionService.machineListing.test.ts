import { describe, expect, it } from "vitest";
import { PendingAskStore } from "./pendingAskStore.js";
import { PiSessionService } from "./piSessionService.js";
import {
  CapturingSessionEventHub,
  fakeRuntime,
  fakeSessionManager,
  sessionRecord,
  testModelRuntime,
} from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/forgerie-machine-listing-test-agent";

function archivedRecord(sessionId: string, cwd: string, path: string) {
  return {
    sessionId,
    cwd,
    originalPath: path,
    archivedAt: "2026-08-01T12:00:00.000Z",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-07-31T00:00:00.000Z",
    messageCount: 4,
    firstMessage: "archived work",
  };
}

describe("PiSessionService machine listing", () => {
  it("lists sessions across workspaces with archived records and snapshots only already-live runtimes", async () => {
    const records = [
      sessionRecord("session-main", "/projects/repo"),
      { ...sessionRecord("session-worktree", "/projects/repo-feature"), parentSessionPath: "/sessions/session-main.jsonl" },
      sessionRecord("session-other", "/projects/other"),
      sessionRecord("session-archived", "/projects/repo"),
    ];
    const archives = [
      archivedRecord("session-archived", "/projects/repo", "/sessions/session-archived.jsonl"),
      {
        sessionId: "missing-file",
        cwd: "/projects/missing",
        archivedAt: "2026-08-01T13:00:00.000Z",
      },
    ];
    const calls = { list: 0, listAll: 0, listCatalog: 0, createRuntime: 0 };
    const manager = {
      create: (cwd: string) => fakeSessionManager(cwd),
      list: () => { calls.list += 1; return Promise.resolve([]); },
      listAll: () => { calls.listAll += 1; return Promise.reject(new Error("full transcript scan should not be called")); },
      listCatalog: () => { calls.listCatalog += 1; return Promise.resolve(records); },
      listParentSessionPaths: () => Promise.resolve([]),
      invalidateSessionFile: () => undefined,
      resolveSessionFile: (cwd: string, sessionId: string) => {
        const record = records.find((candidate) => candidate.cwd === cwd && candidate.id === sessionId);
        return Promise.resolve(record === undefined ? undefined : { id: record.id, cwd: record.cwd, path: record.path });
      },
      open: (path: string) => {
        const record = records.find((candidate) => candidate.path === path);
        if (record === undefined) throw new Error(`Unknown session path ${path}`);
        return fakeSessionManager(record.cwd, {
          getSessionId: () => record.id,
          getSessionFile: () => record.path,
        });
      },
    };
    const pendingAsks = new PendingAskStore({
      now: () => new Date("2026-08-01T14:00:00.000Z"),
      createAskId: () => "ask-main",
    });
    const live = fakeRuntime("session-main", {
      sessionManager: fakeSessionManager("/projects/repo", {
        getSessionId: () => "session-main",
        getSessionFile: () => "/sessions/session-main.jsonl",
      }),
      isStreaming: true,
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      sessionManager: manager,
      archiveStore: {
        list: () => Promise.resolve(archives),
        get: () => Promise.resolve(undefined),
        archive: () => Promise.reject(new Error("archive should not be called")),
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      pendingAskStore: pendingAsks,
      createAgentRuntime: () => {
        calls.createRuntime += 1;
        return Promise.resolve(live.runtime);
      },
      heartbeatIntervalMs: 60_000,
    });

    try {
      await service.status({ id: "session-main", cwd: "/projects/repo" });
      live.emit({ type: "tool_execution_start", toolName: "read" });
      pendingAsks.open({
        sessionId: "session-main",
        questions: [{ id: "approve", question: "Approve?", options: [] }],
      });

      const snapshot = await service.machineListing();

      expect(snapshot.sessions.map(({ id, cwd, archived }) => ({ id, cwd, archived: archived === true }))).toEqual([
        { id: "session-main", cwd: "/projects/repo", archived: false },
        { id: "session-worktree", cwd: "/projects/repo-feature", archived: false },
        { id: "session-other", cwd: "/projects/other", archived: false },
        { id: "session-archived", cwd: "/projects/repo", archived: true },
      ]);
      expect(snapshot.sessions.find(({ id }) => id === "session-worktree")).toMatchObject({
        parentSessionId: "session-main",
        parentSessionCwd: "/projects/repo",
      });
      expect(snapshot.sessions.find(({ id }) => id === "session-main")).toMatchObject({ childSessionsElsewhere: 1 });
      expect(snapshot.statuses).toHaveLength(1);
      expect(snapshot.statuses[0]).toMatchObject({ sessionId: "session-main", isStreaming: true });
      expect(snapshot.statuses[0]?.pendingAsk?.askId).toBe("ask-main");
      expect(snapshot.activities).toMatchObject([
        { sessionId: "session-main", phase: "active", label: "running tool", detail: "read" },
      ]);
      expect(calls).toEqual({ list: 0, listAll: 0, listCatalog: 1, createRuntime: 1 });
    } finally {
      await service.dispose();
    }
  });

  it("returns empty arrays without opening any runtime when the machine has no sessions", async () => {
    let runtimeCreations = 0;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      sessionManager: {
        create: () => { throw new Error("create should not be called"); },
        list: () => Promise.resolve([]),
        listAll: () => Promise.resolve([]),
        listParentSessionPaths: () => Promise.resolve([]),
        invalidateSessionFile: () => undefined,
        resolveSessionFile: () => Promise.resolve(undefined),
        open: () => { throw new Error("open should not be called"); },
      },
      archiveStore: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
        archive: () => Promise.reject(new Error("archive should not be called")),
        restore: () => Promise.resolve(),
        isArchived: () => Promise.resolve(false),
      },
      createAgentRuntime: () => {
        runtimeCreations += 1;
        return Promise.reject(new Error("runtime should not be created"));
      },
      heartbeatIntervalMs: 60_000,
    });

    try {
      await expect(service.machineListing()).resolves.toEqual({ sessions: [], statuses: [], activities: [] });
      expect(runtimeCreations).toBe(0);
    } finally {
      await service.dispose();
    }
  });

  it("surfaces a machine scanner failure instead of returning a partial snapshot", async () => {
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      sessionManager: {
        create: () => { throw new Error("create should not be called"); },
        list: () => Promise.resolve([]),
        listAll: () => Promise.reject(new Error("session scan failed")),
        listParentSessionPaths: () => Promise.resolve([]),
        invalidateSessionFile: () => undefined,
        resolveSessionFile: () => Promise.resolve(undefined),
        open: () => { throw new Error("open should not be called"); },
      },
      heartbeatIntervalMs: 60_000,
    });

    try {
      await expect(service.machineListing()).rejects.toThrow("session scan failed");
    } finally {
      await service.dispose();
    }
  });
});
