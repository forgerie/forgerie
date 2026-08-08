import { describe, expect, it, vi } from "vitest";
import { initialAppState, resetWorkspaceScopedState, type AppState } from "../appState";
import type {
  MachineSessionListingSnapshot,
  SessionAskCatalogSnapshot,
  SessionActivity,
  SessionInfo,
  SessionStatus,
} from "../../../shared/apiTypes";
import { SessionInboxController, type SessionInboxApi, type SessionInboxControllerOptions } from "./sessionInboxController";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: "s1",
    cwd: "/repo",
    path: "/tmp/s1.jsonl",
    created: "2026-08-01T00:00:00.000Z",
    modified: "2026-08-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
    ...overrides,
  };
}

function makeStatus(sessionId: string, overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

function makeListing(
  sessions: SessionInfo[] = [],
  statuses: SessionStatus[] = [],
  activities: SessionActivity[] = [],
): MachineSessionListingSnapshot {
  return { sessions, statuses, activities };
}

function makeAskCatalog(
  sessions: MachineSessionListingSnapshot["sessions"] = [],
): SessionAskCatalogSnapshot {
  return { sessions: sessions.map((s) => ({ id: s.id, cwd: s.cwd })) };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let res!: (value: T) => void;
  let rej!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    res = resolve;
    rej = reject;
  });
  return { promise, resolve: res, reject: rej };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createHarness(
  overrides: Partial<SessionInboxApi> = {},
  initialState?: Partial<AppState>,
  controllerOptions: Omit<SessionInboxControllerOptions, "api"> = {},
) {
  const s1 = makeSessionInfo({ id: "s1", cwd: "/workspace-1" });
  const s2 = makeSessionInfo({ id: "s2", cwd: "/workspace-2" });
  const s3 = makeSessionInfo({ id: "s3", cwd: "/workspace-3" });

  const listing = makeListing([s1, s2, s3]);
  const asks = makeAskCatalog();

  let state: AppState = { ...initialAppState(), ...initialState };
  const api: SessionInboxApi = {
    machineListing: vi.fn(() => Promise.resolve(listing)),
    asksCatalog: vi.fn(() => Promise.resolve(asks)),
    ...overrides,
  };

  const controller = new SessionInboxController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    { ...controllerOptions, api },
  );

  return {
    controller,
    api,
    s1,
    s2,
    s3,
    get state() { return state; },
    replaceState(next: AppState) { state = next; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionInboxController", () => {
  // -------------------------------------------------------------------------
  // Snapshot on refresh
  // -------------------------------------------------------------------------

  describe("snapshot on refresh", () => {
    it("populates globalSessions with all sessions from the machine listing", async () => {
      const harness = createHarness();

      await harness.controller.refresh("local");

      expect(harness.state.globalSessions?.status).toBe("fresh");
      expect(harness.state.globalSessions?.machineId).toBe("local");
      expect(harness.state.globalSessions?.sessions).toHaveLength(3);
      const ids = harness.state.globalSessions?.sessions.map((s) => s.id);
      expect(ids).toContain("s1");
      expect(ids).toContain("s2");
      expect(ids).toContain("s3");
    });

    it("seeds statuses from the machine listing snapshot", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const liveStatus = makeStatus("s1", { isStreaming: true });
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() =>
          Promise.resolve(makeListing([s1], [liveStatus])),
        ),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      await harness.controller.refresh("local");

      expect(harness.state.globalSessions?.statuses["s1"]).toMatchObject({
        sessionId: "s1",
        isStreaming: true,
      });
    });

    it("atomically seeds page-load activities with statuses", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const activity: SessionActivity = {
        sessionId: "s1",
        phase: "error",
        label: "tool failed",
        detail: "read failed",
        at: "2026-08-08T10:00:00.000Z",
      };
      const harness = createHarness({
        machineListing: vi.fn(() => Promise.resolve(makeListing([s1], [makeStatus("s1")], [activity]))),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      });

      await harness.controller.refresh("local");

      expect(harness.state.globalSessions).toMatchObject({
        status: "fresh",
        statuses: { s1: { sessionId: "s1" } },
        activities: { s1: activity },
      });
    });

    it("reconnect atomically removes activities absent from the replacement snapshot", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const staleActivity: SessionActivity = {
        sessionId: "s1",
        phase: "active",
        label: "running tool",
        at: "2026-08-08T10:00:00.000Z",
      };
      let calls = 0;
      const harness = createHarness({
        machineListing: vi.fn(() => {
          calls += 1;
          return Promise.resolve(calls === 1
            ? makeListing([s1], [makeStatus("s1", { isStreaming: true })], [staleActivity])
            : makeListing([s1]));
        }),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      });

      await harness.controller.refresh("local");
      await harness.controller.refresh("local");

      expect(harness.state.globalSessions?.statuses).toEqual({});
      expect(harness.state.globalSessions?.activities).toEqual({});
    });

    it("marks the projection as loading then fresh on a successful fetch", async () => {
      const pending = deferred<MachineSessionListingSnapshot>();
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => pending.promise),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      const refreshPromise = harness.controller.refresh("local");
      expect(harness.state.globalSessions?.status).toBe("loading");

      pending.resolve(makeListing([]));
      await refreshPromise;

      expect(harness.state.globalSessions?.status).toBe("fresh");
    });

    it("retains existing session data and marks stale when the snapshot fails", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const listing = makeListing([s1]);
      let callCount = 0;
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => {
          callCount += 1;
          if (callCount === 1) return Promise.resolve(listing);
          return Promise.reject(new Error("Network error"));
        }),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      // First refresh succeeds
      await harness.controller.refresh("local");
      expect(harness.state.globalSessions?.status).toBe("fresh");
      expect(harness.state.globalSessions?.sessions).toHaveLength(1);

      // Second refresh fails
      await harness.controller.refresh("local");

      expect(harness.state.globalSessions?.status).toBe("stale");
      // Sessions are retained, not cleared
      expect(harness.state.globalSessions?.sessions).toHaveLength(1);
      expect(harness.state.globalSessions?.sessions[0]?.id).toBe("s1");
    });

    it("marks stale with empty sessions when first snapshot fails and no data exists", async () => {
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => Promise.reject(new Error("Network error"))),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      await harness.controller.refresh("local");

      expect(harness.state.globalSessions?.status).toBe("stale");
      expect(harness.state.globalSessions?.sessions).toHaveLength(0);
    });

    it("keeps the machine listing usable when the asks catalog fails", async () => {
      const session = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const onBackgroundError = vi.fn();
      const harness = createHarness({
        machineListing: vi.fn(() => Promise.resolve(makeListing([session]))),
        asksCatalog: vi.fn(() => Promise.reject(new Error("asks unavailable"))),
      }, undefined, { onBackgroundError, retryDelayMs: 60_000 });

      await harness.controller.refresh("local");

      expect(harness.state.globalSessions).toMatchObject({
        machineId: "local",
        status: "stale",
        sessions: [{ id: "s1" }],
      });
      expect(onBackgroundError).toHaveBeenCalledWith("asks", "local", expect.any(Error));
      harness.controller.dispose();
    });

    it("retries a partial asks snapshot and returns to fresh", async () => {
      vi.useFakeTimers();
      try {
        const session = makeSessionInfo({ id: "s1", cwd: "/w1" });
        let asksCalls = 0;
        const harness = createHarness({
          machineListing: vi.fn(() => Promise.resolve(makeListing([session]))),
          asksCatalog: vi.fn(() => {
            asksCalls += 1;
            return asksCalls === 1
              ? Promise.reject(new Error("asks unavailable"))
              : Promise.resolve(makeAskCatalog());
          }),
        }, undefined, { retryDelayMs: 5, snapshotTimeoutMs: 100 });

        await harness.controller.refresh("local");
        expect(harness.state.globalSessions?.status).toBe("stale");

        await vi.advanceTimersByTimeAsync(5);
        expect(asksCalls).toBe(2);
        expect(harness.state.globalSessions?.status).toBe("fresh");
        harness.controller.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it("bounds a hung listing request and leaves a retryable stale projection", async () => {
      vi.useFakeTimers();
      try {
        const onBackgroundError = vi.fn();
        const harness = createHarness({
          machineListing: vi.fn(() => new Promise<MachineSessionListingSnapshot>(() => undefined)),
          asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
        }, undefined, { onBackgroundError, snapshotTimeoutMs: 5, retryDelayMs: 60_000 });

        const refresh = harness.controller.refresh("local");
        await vi.advanceTimersByTimeAsync(5);
        await refresh;

        expect(harness.state.globalSessions).toMatchObject({ status: "stale", sessions: [] });
        expect(onBackgroundError).toHaveBeenCalledWith("listing", "local", expect.objectContaining({ message: "session listing timed out" }));
        harness.controller.dispose();
      } finally {
        vi.useRealTimers();
      }
    });

    it("merges asks catalog entries as synthetic statuses for sessions not in the listing statuses", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const pendingAsk = {
        askId: "ask-1",
        askedAt: "2026-08-07T10:00:00.000Z",
        questions: [{ id: "q1", question: "What next?", type: "text" as const, options: [] }],
      };
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => Promise.resolve(makeListing([s1], []))),
        asksCatalog: vi.fn(() =>
          Promise.resolve({ sessions: [{ id: s1.id, cwd: s1.cwd, pendingAsk }] }),
        ),
      };
      const harness = createHarness(api);

      await harness.controller.refresh("local");

      expect(harness.state.globalSessions?.statuses["s1"]?.pendingAsk).toMatchObject({
        askId: "ask-1",
      });
    });

    it("does not overwrite listing status with asks catalog entry for same session", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const liveStatus = makeStatus("s1", { isStreaming: true, pendingMessageCount: 5 });
      const pendingAsk = {
        askId: "ask-1",
        askedAt: "2026-08-07T10:00:00.000Z",
        questions: [{ id: "q1", question: "What next?", type: "text" as const, options: [] }],
      };
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => Promise.resolve(makeListing([s1], [liveStatus]))),
        asksCatalog: vi.fn(() =>
          Promise.resolve({ sessions: [{ id: s1.id, cwd: s1.cwd, pendingAsk }] }),
        ),
      };
      const harness = createHarness(api);

      await harness.controller.refresh("local");

      // Listing status (with isStreaming) wins; catalog entry does not overwrite
      expect(harness.state.globalSessions?.statuses["s1"]?.isStreaming).toBe(true);
      expect(harness.state.globalSessions?.statuses["s1"]?.pendingMessageCount).toBe(5);
    });

    it("queues a trailing refresh if refresh is called while one is in flight", async () => {
      const first = deferred<MachineSessionListingSnapshot>();
      let callCount = 0;
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => {
          callCount += 1;
          if (callCount === 1) return first.promise;
          return Promise.resolve(makeListing([]));
        }),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      const r1 = harness.controller.refresh("local");
      const r2 = harness.controller.refresh("local"); // queued

      first.resolve(makeListing([]));
      await r1;
      await r2;

      expect(callCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Machine switching
  // -------------------------------------------------------------------------

  describe("machine switching", () => {
    it("clears globalSessions and marks loading when switching to a new machine", async () => {
      // Use a sequenced mock: first call returns data, second stalls.
      const pending = deferred<MachineSessionListingSnapshot>();
      let callCount = 0;
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => {
          callCount += 1;
          return callCount === 1 ? Promise.resolve(makeListing([])) : pending.promise;
        }),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      await harness.controller.refresh("machine-a");
      expect(harness.state.globalSessions?.status).toBe("fresh");
      expect(harness.state.globalSessions?.machineId).toBe("machine-a");

      // Switch to machine-b: should clear immediately before the fetch lands.
      void harness.controller.refresh("machine-b");

      expect(harness.state.globalSessions?.machineId).toBe("machine-b");
      expect(harness.state.globalSessions?.status).toBe("loading");
      expect(harness.state.globalSessions?.sessions).toHaveLength(0);

      pending.resolve(makeListing([]));
    });

    it("discards in-flight snapshot response from old machine after switch", async () => {
      const oldMachinePending = deferred<MachineSessionListingSnapshot>();
      const oldSession = makeSessionInfo({ id: "old-machine-session" });

      let callCount = 0;
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => {
          callCount += 1;
          if (callCount === 1) return oldMachinePending.promise; // old machine, slow
          return Promise.resolve(makeListing([])); // new machine, fast
        }),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      // Start old machine refresh (in flight)
      void harness.controller.refresh("machine-a");
      expect(harness.state.globalSessions?.machineId).toBe("machine-a");

      // Switch to new machine and complete its refresh
      await harness.controller.refresh("machine-b");
      expect(harness.state.globalSessions?.machineId).toBe("machine-b");
      expect(harness.state.globalSessions?.status).toBe("fresh");

      // Now resolve old machine's response — should be discarded
      oldMachinePending.resolve(makeListing([oldSession]));
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.state.globalSessions?.machineId).toBe("machine-b");
      expect(harness.state.globalSessions?.sessions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Live event handling
  // -------------------------------------------------------------------------

  describe("live event handling", () => {
    it("adds a session.created event to globalSessions regardless of cwd", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      const newSession = makeSessionInfo({ id: "new-s", cwd: "/other-workspace" });
      harness.controller.applyGlobalEvent("local", {
        type: "session.created",
        session: newSession,
      });

      const ids = harness.state.globalSessions?.sessions.map((s) => s.id);
      expect(ids).toContain("new-s");
    });

    it("does not duplicate a session already in globalSessions on session.created", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      const initialCount = harness.state.globalSessions?.sessions.length ?? 0;

      // Re-emit created for an existing session
      harness.controller.applyGlobalEvent("local", {
        type: "session.created",
        session: harness.s1,
      });

      expect(harness.state.globalSessions?.sessions).toHaveLength(initialCount);
    });

    it("updates session name on session.name event", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      harness.controller.applyGlobalEvent("local", {
        type: "session.name",
        sessionId: "s1",
        name: "My Renamed Session",
      });

      const s1 = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(s1?.name).toBe("My Renamed Session");
    });

    it("clears session name when session.name event has no name", async () => {
      const harness = createHarness({}, {});
      await harness.controller.refresh("local");

      // First set a name
      harness.controller.applyGlobalEvent("local", {
        type: "session.name",
        sessionId: "s1",
        name: "Some Name",
      });
      // Then clear it (omit `name` to match GlobalSessionEvent's exactOptionalPropertyTypes)
      harness.controller.applyGlobalEvent("local", {
        type: "session.name",
        sessionId: "s1",
      });

      const s1 = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(s1?.name).toBeUndefined();
    });

    it("updates statuses map on status.update event", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      const updatedStatus = makeStatus("s1", { isStreaming: true });
      harness.controller.applyGlobalEvent("local", {
        type: "status.update",
        status: updatedStatus,
      });
      // status.update is buffered; flush to apply it to globalSessions in one write.
      harness.controller.flushPendingSessionStateToGlobal();

      expect(harness.state.globalSessions?.statuses["s1"]).toMatchObject({
        sessionId: "s1",
        isStreaming: true,
      });
    });

    it("drops runtime deltas for sessions absent from the machine inventory", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      const activity: SessionActivity = {
        sessionId: "missing",
        phase: "active",
        label: "orphan",
        at: "2026-08-08T10:00:00.000Z",
      };

      harness.controller.applyGlobalEvent("local", { type: "status.update", status: makeStatus("missing", { isStreaming: true }) });
      harness.controller.applyGlobalEvent("local", { type: "activity.update", activity });
      harness.controller.flushPendingSessionStateToGlobal();

      expect(harness.state.globalSessions?.statuses["missing"]).toBeUndefined();
      expect(harness.state.globalSessions?.activities["missing"]).toBeUndefined();
    });

    it("ignores global events for a different machine", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      const stateBefore = harness.state.globalSessions;
      harness.controller.applyGlobalEvent("machine-b", {
        type: "session.created",
        session: makeSessionInfo({ id: "foreign-session" }),
      });

      expect(harness.state.globalSessions).toBe(stateBefore);
    });

    it("ignores global events before any refresh has been called", () => {
      const harness = createHarness();

      expect(() => {
        harness.controller.applyGlobalEvent("local", {
          type: "session.created",
          session: makeSessionInfo({ id: "early-s" }),
        });
      }).not.toThrow();

      expect(harness.state.globalSessions).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Archive / restore mutations
  // -------------------------------------------------------------------------

  describe("archive and restore mutations", () => {
    it("marks the session archived on notifyArchived", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      harness.controller.notifyArchived("local", "s1", "2026-08-07T10:00:00.000Z");

      const s1 = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(s1?.archived).toBe(true);
      expect(s1?.archivedAt).toBe("2026-08-07T10:00:00.000Z");
    });

    it("marks multiple sessions archived on notifyBulkArchived", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      harness.controller.notifyBulkArchived("local", ["s1", "s2"], "2026-08-07T10:00:00.000Z");

      const sessions = harness.state.globalSessions?.sessions ?? [];
      const s1 = sessions.find((s) => s.id === "s1");
      const s2 = sessions.find((s) => s.id === "s2");
      const s3 = sessions.find((s) => s.id === "s3");
      expect(s1?.archived).toBe(true);
      expect(s2?.archived).toBe(true);
      expect(s3?.archived).toBeUndefined();
    });

    it("restores a session on notifyRestored", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      harness.controller.notifyArchived("local", "s1", "2026-08-07T10:00:00.000Z");
      const archivedS1 = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(archivedS1?.archived).toBe(true);

      const restoredS1 = makeSessionInfo({ id: "s1", cwd: "/workspace-1" });
      harness.controller.notifyRestored("local", restoredS1);

      const after = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(after?.archived).toBeUndefined();
    });

    it("ignores archive/restore notifications for a different machine", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      const stateBefore = harness.state.globalSessions;
      harness.controller.notifyArchived("machine-b", "s1", "2026-08-07T10:00:00.000Z");

      expect(harness.state.globalSessions).toBe(stateBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Reconnect re-snapshot behaviour
  // -------------------------------------------------------------------------

  describe("reconnect re-snapshot", () => {
    it("re-fetches and drops stale Blocked status after reconnect re-snapshot", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const pendingAsk = {
        askId: "ask-1",
        askedAt: "2026-08-07T10:00:00.000Z",
        questions: [{ id: "q1", question: "What?", type: "text" as const, options: [] }],
      };

      let callCount = 0;
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => {
          callCount += 1;
          if (callCount === 1) {
            // First snapshot: session has a pending ask (blocked)
            const blockedStatus = makeStatus("s1", { pendingAsk });
            return Promise.resolve(makeListing([s1], [blockedStatus]));
          }
          // After reconnect: sessiond restarted — ask is gone
          return Promise.resolve(makeListing([s1], []));
        }),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      await harness.controller.refresh("local");
      expect(harness.state.globalSessions?.statuses["s1"]?.pendingAsk).toMatchObject({
        askId: "ask-1",
      });

      // Simulate reconnect: re-snapshot
      await harness.controller.refresh("local");
      expect(harness.state.globalSessions?.statuses["s1"]?.pendingAsk).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // WorkspaceScopedStateReset does NOT include globalSessions
  // -------------------------------------------------------------------------

  describe("AppState invariant: globalSessions is not workspace-scoped", () => {
    it("resetWorkspaceScopedState does not include globalSessions", () => {
      const reset = resetWorkspaceScopedState();
      // The globalSessions key must not appear in the reset object.
      // A contributor adding it to WorkspaceScopedStateReset would break the inbox
      // across workspace switches — this test guards that invariant.
      expect(Object.prototype.hasOwnProperty.call(reset, "globalSessions")).toBe(false);
    });

    it("workspace switch does not clear globalSessions", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      expect(harness.state.globalSessions?.sessions).toHaveLength(3);

      // Simulate what PiWebApp does on workspace switch: apply resetWorkspaceScopedState
      const resetPatch = resetWorkspaceScopedState();
      harness.replaceState({ ...harness.state, ...resetPatch });

      // globalSessions must survive
      expect(harness.state.globalSessions?.sessions).toHaveLength(3);
      expect(harness.state.globalSessions?.status).toBe("fresh");
    });
  });

  // -------------------------------------------------------------------------
  // dispose
  // -------------------------------------------------------------------------

  describe("dispose", () => {
    it("stops accepting events after dispose", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      harness.controller.dispose();

      const stateBefore = harness.state.globalSessions;
      harness.controller.applyGlobalEvent("local", {
        type: "session.created",
        session: makeSessionInfo({ id: "post-dispose" }),
      });

      expect(harness.state.globalSessions).toBe(stateBefore);
    });

    it("discards in-flight refresh after dispose", async () => {
      const pending = deferred<MachineSessionListingSnapshot>();
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => pending.promise),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);

      const refreshPromise = harness.controller.refresh("local");
      harness.controller.dispose();

      pending.resolve(makeListing([makeSessionInfo({ id: "late-session" })]));
      await refreshPromise;

      // After dispose, the in-flight listing result must not be applied.
      // The loading state set at the start of refresh() is acceptable to
      // retain; what must NOT happen is the sessions list being populated
      // with the late response.
      const sessions = harness.state.globalSessions?.sessions ?? [];
      expect(sessions.some((s) => s.id === "late-session")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Event buffering during in-flight snapshot
  // -------------------------------------------------------------------------

  describe("event buffering during in-flight snapshot", () => {
    // Helpers shared by all three buffering tests.
    function makeStalledResnapshot(s1: SessionInfo) {
      const pending = deferred<MachineSessionListingSnapshot>();
      let callCount = 0;
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() => {
          callCount += 1;
          if (callCount === 1) return Promise.resolve(makeListing([s1]));
          return pending.promise; // second refresh stalls
        }),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      return { api, pending };
    }

    it("buffers session.created events during a re-snapshot so they survive the snapshot", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const { api, pending } = makeStalledResnapshot(s1);
      const harness = createHarness(api);

      // Seed initial state via first refresh.
      await harness.controller.refresh("local");

      // Second refresh (reconnect): stalls.
      const refreshPromise = harness.controller.refresh("local");

      // A new session is created by the daemon while the snapshot is in flight.
      const newSession = makeSessionInfo({ id: "created-during-snapshot", cwd: "/new" });
      harness.controller.applyGlobalEvent("local", {
        type: "session.created",
        session: newSession,
      });

      // Snapshot resolves without the new session (race window closed before snapshot).
      pending.resolve(makeListing([s1]));
      await refreshPromise;

      const ids = harness.state.globalSessions?.sessions.map((s) => s.id) ?? [];
      // The session created during the snapshot window must survive.
      expect(ids).toContain("created-during-snapshot");
      // The session from the snapshot must also be present.
      expect(ids).toContain("s1");
    });

    it("buffers session.name events during a re-snapshot so they survive the snapshot", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const { api, pending } = makeStalledResnapshot(s1);
      const harness = createHarness(api);

      await harness.controller.refresh("local");

      const refreshPromise = harness.controller.refresh("local");

      // A name update arrives while the snapshot is in flight.
      harness.controller.applyGlobalEvent("local", {
        type: "session.name",
        sessionId: "s1",
        name: "Renamed During Snapshot",
      });

      // Snapshot resolves with s1 having no name (older metadata).
      pending.resolve(makeListing([s1]));
      await refreshPromise;

      const s1State = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(s1State?.name).toBe("Renamed During Snapshot");
    });

    it("buffers activity.update events during a re-snapshot so they survive the snapshot", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const { api, pending } = makeStalledResnapshot(s1);
      const harness = createHarness(api);

      await harness.controller.refresh("local");
      const refreshPromise = harness.controller.refresh("local");
      const activity: SessionActivity = {
        sessionId: "s1",
        phase: "active",
        label: "running tool",
        at: "2026-08-08T10:00:00.000Z",
      };
      harness.controller.applyGlobalEvent("local", { type: "activity.update", activity });

      pending.resolve(makeListing([s1]));
      await refreshPromise;

      expect(harness.state.globalSessions?.activities["s1"]).toEqual(activity);
    });

    it("buffers status.update events during a re-snapshot so they survive the snapshot", async () => {
      const s1 = makeSessionInfo({ id: "s1", cwd: "/w1" });
      const { api, pending } = makeStalledResnapshot(s1);
      const harness = createHarness(api);

      await harness.controller.refresh("local");

      const refreshPromise = harness.controller.refresh("local");

      // A live status update arrives while the snapshot is in flight.
      const liveStatus = makeStatus("s1", { isStreaming: true });
      harness.controller.applyGlobalEvent("local", {
        type: "status.update",
        status: liveStatus,
      });

      // Snapshot resolves with no statuses (session stopped before snapshot was taken).
      pending.resolve(makeListing([s1], []));
      await refreshPromise;

      // The live status update must survive on top of the snapshot.
      expect(harness.state.globalSessions?.statuses["s1"]?.isStreaming).toBe(true);
    });

    it("batches live activity and status deltas into one global projection write", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      const before = harness.state.globalSessions;
      const activity: SessionActivity = {
        sessionId: "s1",
        phase: "active",
        label: "running tool",
        at: "2026-08-08T10:00:00.000Z",
      };

      harness.controller.applyGlobalEvent("local", { type: "activity.update", activity });
      harness.controller.applyGlobalEvent("local", {
        type: "status.update",
        status: makeStatus("s1", { isStreaming: true }),
      });
      expect(harness.state.globalSessions).toBe(before);

      harness.controller.flushPendingSessionStateToGlobal();

      expect(harness.state.globalSessions?.activities["s1"]).toEqual(activity);
      expect(harness.state.globalSessions?.statuses["s1"]?.isStreaming).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // notifyDeleted
  // -------------------------------------------------------------------------

  describe("notifyDeleted", () => {
    it("removes sessions from globalSessions", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      expect(harness.state.globalSessions?.sessions).toHaveLength(3);

      harness.controller.notifyDeleted("local", ["s1", "s2"]);

      const sessions = harness.state.globalSessions?.sessions ?? [];
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.id).toBe("s3");
    });

    it("removes deleted sessions from the statuses map", async () => {
      const liveStatus = makeStatus("s1", { isStreaming: true });
      const api: Partial<SessionInboxApi> = {
        machineListing: vi.fn(() =>
          Promise.resolve(makeListing([makeSessionInfo({ id: "s1", cwd: "/w1" })], [liveStatus])),
        ),
        asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
      };
      const harness = createHarness(api);
      await harness.controller.refresh("local");
      expect(harness.state.globalSessions?.statuses["s1"]).toBeDefined();

      harness.controller.notifyDeleted("local", ["s1"]);

      expect(harness.state.globalSessions?.statuses["s1"]).toBeUndefined();
    });

    it("is a no-op for an empty sessionIds list", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      const stateBefore = harness.state.globalSessions;

      harness.controller.notifyDeleted("local", []);

      expect(harness.state.globalSessions).toBe(stateBefore);
    });

    it("ignores notifyDeleted for a different machine", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      const stateBefore = harness.state.globalSessions;

      harness.controller.notifyDeleted("machine-b", ["s1"]);

      expect(harness.state.globalSessions).toBe(stateBefore);
    });
  });

  // -------------------------------------------------------------------------
  // notifySessionUpdated
  // -------------------------------------------------------------------------

  describe("notifySessionUpdated", () => {
    it("replaces the matching session entry in globalSessions", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      const updated = makeSessionInfo({ id: "s1", cwd: "/workspace-1", name: "Updated Name" });
      harness.controller.notifySessionUpdated("local", updated);

      const s1 = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(s1?.name).toBe("Updated Name");
      // Other sessions must remain unchanged.
      expect(harness.state.globalSessions?.sessions).toHaveLength(3);
    });

    it("ignores notifySessionUpdated for a different machine", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");
      const stateBefore = harness.state.globalSessions;

      harness.controller.notifySessionUpdated("machine-b", makeSessionInfo({ id: "s1" }));

      expect(harness.state.globalSessions).toBe(stateBefore);
    });

    it("notifyRestored uses the shared update path (delegates to notifySessionUpdated)", async () => {
      const harness = createHarness();
      await harness.controller.refresh("local");

      // Archive s1, then restore it with fresh metadata.
      harness.controller.notifyArchived("local", "s1", "2026-08-07T10:00:00.000Z");
      const archivedS1 = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(archivedS1?.archived).toBe(true);

      const restored = makeSessionInfo({ id: "s1", cwd: "/workspace-1" });
      harness.controller.notifyRestored("local", restored);

      const after = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
      expect(after?.archived).toBeUndefined();
      expect(after?.archivedAt).toBeUndefined();
    });
  });
});
