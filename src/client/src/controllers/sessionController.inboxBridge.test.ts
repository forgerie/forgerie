/**
 * Integration tests: SessionController notifies SessionInboxBridge after
 * mutations that add, remove, or update sessions in the global projection.
 *
 * Uses a RecordingInboxBridge — a real implementation that records every call
 * — to verify the bridge contract without touching AppState.globalSessions
 * directly.
 *
 * Also contains end-to-end integration tests that wire SessionController
 * throwing variants into SessionInboxController, proving the correct
 * propagation of API errors through the full archive/restore flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import type { SessionInfo } from "../api";
import type { GlobalSessionEvent } from "../sessionSocket";
import { SessionController } from "./sessionController";
import { SessionInboxController } from "./sessionInboxController";
import { InMemorySessionSelectionMemory } from "./sessionSelection";
import {
  defaultApi,
  emptyPage,
  FakeSocket,
  MemoryStorage,
  oldSession,
  sessionLookupId,
  status,
  workspace,
  type AppState,
} from "./sessionController.testSupport";
import type { SessionInboxBridge, SessionInboxApi } from "./sessionInboxController";
import type { MachineSessionListingSnapshot, SessionAskCatalogSnapshot } from "../../../shared/apiTypes";

// ---------------------------------------------------------------------------
// Real recording bridge
// ---------------------------------------------------------------------------

class RecordingInboxBridge implements SessionInboxBridge {
  readonly globalEvents: { machineId: string; event: GlobalSessionEvent }[] = [];
  readonly archivedCalls: { machineId: string; sessionId: string; archivedAt: string }[] = [];
  readonly bulkArchivedCalls: {
    machineId: string;
    sessionIds: readonly string[];
    archivedAt: string;
  }[] = [];
  readonly restoredCalls: { machineId: string; session: SessionInfo }[] = [];
  readonly deletedCalls: { machineId: string; sessionIds: readonly string[] }[] = [];
  readonly updatedCalls: { machineId: string; session: SessionInfo }[] = [];

  applyGlobalEvent(machineId: string, event: GlobalSessionEvent): void {
    this.globalEvents.push({ machineId, event });
  }
  notifyArchived(machineId: string, sessionId: string, archivedAt: string): void {
    this.archivedCalls.push({ machineId, sessionId, archivedAt });
  }
  notifyBulkArchived(machineId: string, sessionIds: readonly string[], archivedAt: string): void {
    this.bulkArchivedCalls.push({ machineId, sessionIds, archivedAt });
  }
  notifyRestored(machineId: string, session: SessionInfo): void {
    this.restoredCalls.push({ machineId, session });
  }
  notifyDeleted(machineId: string, sessionIds: readonly string[]): void {
    this.deletedCalls.push({ machineId, sessionIds });
  }
  notifySessionUpdated(machineId: string, session: SessionInfo): void {
    this.updatedCalls.push({ machineId, session });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArchivedSession(id = "archived-session"): SessionInfo {
  return {
    ...oldSession,
    id,
    path: `/tmp/${id}.jsonl`,
    archived: true,
    archivedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionController inbox bridge wiring", () => {
  // -------------------------------------------------------------------------
  // deleteArchivedSessions
  // -------------------------------------------------------------------------

  describe("deleteArchivedSessions", () => {
    it("calls inbox.notifyDeleted with deleted session ids after successful deletion", async () => {
      const archivedSession = makeArchivedSession("to-delete");
      const inbox = new RecordingInboxBridge();
      let state: AppState = {
        ...initialAppState(),
        selectedWorkspace: workspace,
        sessions: [archivedSession],
      };
      const api: typeof defaultApi = {
        ...defaultApi,
        deleteArchivedMany: (sessions) =>
          Promise.resolve({
            deleted: true,
            deletedSessionIds: sessions.map(sessionLookupId),
            failures: [],
            generatedAt: "now",
          }),
      };
      const controller = new SessionController(
        () => state,
        (patch) => { state = { ...state, ...patch }; },
        () => undefined,
        new InMemorySessionSelectionMemory(),
        { api, socket: new FakeSocket(), inbox },
      );

      await controller.deleteArchivedSessions([archivedSession]);

      expect(inbox.deletedCalls).toHaveLength(1);
      expect(inbox.deletedCalls[0]).toMatchObject({
        machineId: "local",
        sessionIds: ["to-delete"],
      });
    });

    it("does not call inbox.notifyDeleted when all deletions fail", async () => {
      const archivedSession = makeArchivedSession("will-fail");
      const inbox = new RecordingInboxBridge();
      let state: AppState = {
        ...initialAppState(),
        selectedWorkspace: workspace,
        sessions: [archivedSession],
      };
      const api: typeof defaultApi = {
        ...defaultApi,
        deleteArchivedMany: (sessions) =>
          Promise.resolve({
            deleted: true as const,
            deletedSessionIds: [],
            failures: sessions.map((s) => ({ sessionId: sessionLookupId(s), error: "busy" })),
            generatedAt: "now",
          }),
      };
      const controller = new SessionController(
        () => state,
        (patch) => { state = { ...state, ...patch }; },
        () => undefined,
        new InMemorySessionSelectionMemory(),
        { api, socket: new FakeSocket(), inbox },
      );

      await controller.deleteArchivedSessions([archivedSession]);

      expect(inbox.deletedCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // applySessionCleanupResult
  // -------------------------------------------------------------------------

  describe("applySessionCleanupResult", () => {
    it("calls inbox.notifyBulkArchived for archived ids and inbox.notifyDeleted for deleted ids", async () => {
      const toArchive = { ...oldSession, id: "to-archive", path: "/tmp/to-archive.jsonl", persisted: true };
      const toDelete = makeArchivedSession("to-delete");
      const archivedAt = "2026-08-07T12:00:00.000Z";
      const inbox = new RecordingInboxBridge();
      let state: AppState = {
        ...initialAppState(),
        selectedWorkspace: workspace,
        sessions: [toArchive, toDelete],
      };
      const api: typeof defaultApi = {
        ...defaultApi,
        sessions: () => Promise.resolve([toArchive, toDelete]),
      };
      const controller = new SessionController(
        () => state,
        (patch) => { state = { ...state, ...patch }; },
        () => undefined,
        new InMemorySessionSelectionMemory(),
        { api, socket: new FakeSocket(), inbox },
      );

      await controller.applySessionCleanupResult({
        generatedAt: archivedAt,
        thresholds: { archiveIdleDays: 30, deleteArchivedDays: 60 },
        projects: [{ cwd: workspace.path, archiveCount: 1, deleteCount: 1 }],
        totals: { archiveCount: 1, deleteCount: 1 },
        archivedSessionIds: [toArchive.id],
        deletedSessionIds: [toDelete.id],
      });

      expect(inbox.bulkArchivedCalls).toHaveLength(1);
      expect(inbox.bulkArchivedCalls[0]).toMatchObject({
        machineId: "local",
        sessionIds: [toArchive.id],
        archivedAt,
      });
      expect(inbox.deletedCalls).toHaveLength(1);
      expect(inbox.deletedCalls[0]).toMatchObject({
        machineId: "local",
        sessionIds: [toDelete.id],
      });
    });

    it("skips inbox calls when there are no archived or deleted ids", async () => {
      const inbox = new RecordingInboxBridge();
      let state: AppState = {
        ...initialAppState(),
        selectedWorkspace: workspace,
        sessions: [],
      };
      const api: typeof defaultApi = {
        ...defaultApi,
        sessions: () => Promise.resolve([]),
      };
      const controller = new SessionController(
        () => state,
        (patch) => { state = { ...state, ...patch }; },
        () => undefined,
        new InMemorySessionSelectionMemory(),
        { api, socket: new FakeSocket(), inbox },
      );

      await controller.applySessionCleanupResult({
        generatedAt: "2026-08-07T12:00:00.000Z",
        thresholds: { archiveIdleDays: 30, deleteArchivedDays: 60 },
        projects: [],
        totals: { archiveCount: 0, deleteCount: 0 },
        archivedSessionIds: [],
        deletedSessionIds: [],
      });

      expect(inbox.bulkArchivedCalls).toHaveLength(0);
      expect(inbox.deletedCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // detachParent
  // -------------------------------------------------------------------------

  describe("detachParent", () => {
    it("calls inbox.notifySessionUpdated with the detached session (parentSessionPath removed)", async () => {
      const sessionWithParent: SessionInfo = {
        ...oldSession,
        id: "child-session",
        parentSessionPath: "/tmp/parent.jsonl",
        persisted: true,
      };
      const inbox = new RecordingInboxBridge();
      let state: AppState = {
        ...initialAppState(),
        selectedWorkspace: workspace,
        selectedSession: sessionWithParent,
        sessions: [sessionWithParent],
      };
      const api: typeof defaultApi = {
        ...defaultApi,
        detachParent: () => Promise.resolve({ detached: true as const }),
      };
      const controller = new SessionController(
        () => state,
        (patch) => { state = { ...state, ...patch }; },
        () => undefined,
        new InMemorySessionSelectionMemory(),
        { api, socket: new FakeSocket(), inbox },
      );

      await controller.detachParent(sessionWithParent);

      expect(inbox.updatedCalls).toHaveLength(1);
      expect(inbox.updatedCalls[0]).toMatchObject({ machineId: "local" });
      // The notified session must not carry parentSessionPath.
      expect(inbox.updatedCalls[0]?.session.parentSessionPath).toBeUndefined();
      expect(inbox.updatedCalls[0]?.session.id).toBe("child-session");
    });

    it("does not call inbox.notifySessionUpdated when detachParent errors", async () => {
      const sessionWithParent: SessionInfo = {
        ...oldSession,
        id: "child-session",
        parentSessionPath: "/tmp/parent.jsonl",
        persisted: true,
      };
      const inbox = new RecordingInboxBridge();
      let state: AppState = {
        ...initialAppState(),
        selectedWorkspace: workspace,
        selectedSession: sessionWithParent,
        sessions: [sessionWithParent],
      };
      const api: typeof defaultApi = {
        ...defaultApi,
        detachParent: () => Promise.reject(new Error("server error")),
      };
      const controller = new SessionController(
        () => state,
        (patch) => { state = { ...state, ...patch }; },
        () => undefined,
        new InMemorySessionSelectionMemory(),
        { api, socket: new FakeSocket(), inbox },
      );

      await controller.detachParent(sessionWithParent);

      expect(inbox.updatedCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // deleteCachedNewSession
  // -------------------------------------------------------------------------

  describe("deleteCachedNewSession", () => {
    it("calls inbox.notifyDeleted with the session id after deletion", async () => {
      const storage = new MemoryStorage();
      Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

      const transientSession: SessionInfo = {
        ...oldSession,
        id: "transient-session",
        persisted: false,
      };
      const nextSession = {
        ...oldSession,
        id: "next-session",
        path: "/tmp/next-session.jsonl",
        persisted: true,
      };
      const inbox = new RecordingInboxBridge();
      let state: AppState = {
        ...initialAppState(),
        selectedWorkspace: workspace,
        selectedSession: transientSession,
        sessions: [transientSession, nextSession],
        sessionStatuses: {
          [transientSession.id]: {
            ...status(transientSession.id),
            persisted: false,
          },
        },
      };
      const api: typeof defaultApi = {
        ...defaultApi,
        stop: () => Promise.resolve({ stopped: true as const }),
        messages: () => Promise.resolve(emptyPage),
        status: (s) => Promise.resolve(status(sessionLookupId(s))),
      };
      const controller = new SessionController(
        () => state,
        (patch) => { state = { ...state, ...patch }; },
        () => undefined,
        new InMemorySessionSelectionMemory(),
        { api, socket: new FakeSocket(), inbox },
      );

      await controller.deleteCachedNewSession(transientSession);

      expect(inbox.deletedCalls).toHaveLength(1);
      expect(inbox.deletedCalls[0]).toMatchObject({
        machineId: "local",
        sessionIds: ["transient-session"],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end integration: SessionController throwing variants →
// SessionInboxController archive/restore flow
// ---------------------------------------------------------------------------

/**
 * Minimal inline SessionInboxApi that serves a pre-seeded machine listing.
 * Keeps each test self-contained without needing a full HTTP layer.
 */
function makeInboxApi(sessions: SessionInfo[] = []): SessionInboxApi {
  return {
    machineListing: (): Promise<MachineSessionListingSnapshot> =>
      Promise.resolve({ sessions, statuses: [] }),
    asksCatalog: (): Promise<SessionAskCatalogSnapshot> =>
      Promise.resolve({ sessions: [] }),
  };
}

/**
 * Wire up a SessionController and a SessionInboxController so the
 * SessionController’s inbox bridge points at the SessionInboxController.
 *
 * `sessionApi` overrides are applied on top of the default no-op api so each
 * test can control exactly which HTTP calls succeed or fail without touching
 * private fields.
 */
function createIntegrationHarness(
  sessions: SessionInfo[],
  sessionApiOverrides: Partial<typeof defaultApi> = {},
) {
  let state: AppState = {
    ...initialAppState(),
    selectedWorkspace: workspace,
    sessions,
  };
  const getState = () => state;
  const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };

  const inboxController = new SessionInboxController(getState, setState, {
    api: makeInboxApi(sessions),
  });

  // Expose a typed api so tests can spy on specific methods without resorting
  // to private-field access casts that confuse the type checker.
  const sessionApi: typeof defaultApi = { ...defaultApi, ...sessionApiOverrides };

  const sessionController = new SessionController(
    getState,
    setState,
    () => undefined, // updateUrl no-op
    new InMemorySessionSelectionMemory(),
    { api: sessionApi, socket: new FakeSocket(), inbox: inboxController },
  );

  return {
    get state() { return state; },
    setState,
    inboxController,
    sessionController,
    /** The typed api object — spy on individual methods in tests. */
    sessionApi,
    async seedInbox(machineId = "local") {
      await inboxController.refresh(machineId);
    },
  };
}

describe("archiveSessionThrowing — integration with SessionInboxController", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("archive API rejection leaves globalSessions unchanged (no archived move)", async () => {
    const session = { ...oldSession, persisted: true };
    const harness = createIntegrationHarness([session]);
    await harness.seedInbox();

    // Verify session starts unarchived in globalSessions
    const before = harness.state.globalSessions?.sessions.find((s) => s.id === session.id);
    expect(before?.archived).toBeUndefined();

    vi.spyOn(harness.sessionApi, "archive").mockRejectedValueOnce(new Error("server reject 500"));

    await expect(
      harness.inboxController.archiveWithUndo(session, {
        machineId: "local",
        archiveSession: (s) => harness.sessionController.archiveSessionThrowing(s),
        confirm: () => true,
      }),
    ).rejects.toThrow("server reject 500");

    // globalSessions must not have changed
    const after = harness.state.globalSessions?.sessions.find((s) => s.id === session.id);
    expect(after?.archived).toBeUndefined();
  });

  it("archive API rejection leaves inboxUndoToast unset", async () => {
    const session = { ...oldSession, persisted: true };
    const harness = createIntegrationHarness([session]);
    await harness.seedInbox();

    vi.spyOn(harness.sessionApi, "archive").mockRejectedValueOnce(new Error("server reject 500"));

    try {
      await harness.inboxController.archiveWithUndo(session, {
        machineId: "local",
        archiveSession: (s) => harness.sessionController.archiveSessionThrowing(s),
        confirm: () => true,
      });
    } catch {
      // expected
    }

    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("archive API rejection does not mark session archived in workspace sessions list", async () => {
    const session = { ...oldSession, persisted: true };
    const harness = createIntegrationHarness([session]);
    await harness.seedInbox();

    vi.spyOn(harness.sessionApi, "archive").mockRejectedValueOnce(new Error("server reject 500"));

    try {
      await harness.inboxController.archiveWithUndo(session, {
        machineId: "local",
        archiveSession: (s) => harness.sessionController.archiveSessionThrowing(s),
        confirm: () => true,
      });
    } catch {
      // expected
    }

    const workspaceSession = harness.state.sessions.find((s) => s.id === session.id);
    expect(workspaceSession?.archived).toBeUndefined();
  });

  it("successful archive updates both globalSessions and workspace sessions list without duplicate notification", async () => {
    const session = { ...oldSession, persisted: true };
    const harness = createIntegrationHarness([session]);
    await harness.seedInbox();

    let notifyArchivedCalls = 0;
    const origNotify = harness.inboxController.notifyArchived.bind(harness.inboxController);
    vi.spyOn(harness.inboxController, "notifyArchived").mockImplementation((mid, sid, at) => {
      notifyArchivedCalls += 1;
      origNotify(mid, sid, at);
    });

    const archiveSpy = vi.spyOn(harness.sessionApi, "archive").mockResolvedValueOnce({ archived: true });

    await harness.inboxController.archiveWithUndo(session, {
      machineId: "local",
      archiveSession: (s) => harness.sessionController.archiveSessionThrowing(s),
      confirm: () => true,
      timerMs: 5000,
    });

    expect(archiveSpy).toHaveBeenCalledOnce();
    // notifyArchived called exactly once (from archiveWithUndo, not from archiveSessionThrowing)
    expect(notifyArchivedCalls).toBe(1);
    // globalSessions updated
    const globalSession = harness.state.globalSessions?.sessions.find((s) => s.id === session.id);
    expect(globalSession?.archived).toBe(true);
    // workspace sessions updated
    const workspaceSession = harness.state.sessions.find((s) => s.id === session.id);
    expect(workspaceSession?.archived).toBe(true);
  });
});

describe("restoreSessionThrowing — integration with SessionInboxController.undoArchive", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function seedArchivedUndo(sessions: SessionInfo[], session: SessionInfo) {
    const harness = createIntegrationHarness(sessions);
    await harness.seedInbox();

    // Archive to install an undo state; use the spy on the exposed sessionApi
    vi.spyOn(harness.sessionApi, "archive").mockResolvedValueOnce({ archived: true });

    await harness.inboxController.archiveWithUndo(session, {
      machineId: "local",
      archiveSession: (s) => harness.sessionController.archiveSessionThrowing(s),
      confirm: () => true,
      timerMs: 5000,
    });

    expect(harness.state.inboxUndoToast).toBeDefined();
    return harness;
  }

  it("restore 'Session not found' reaches SessionInboxController.undoArchive and sets 'Session was already deleted'", async () => {
    const session = { ...oldSession, persisted: true };
    const harness = await seedArchivedUndo([session], session);

    vi.spyOn(harness.sessionApi, "restore").mockRejectedValueOnce(new Error("Session not found"));

    await harness.inboxController.undoArchive({
      restoreSession: (s) => harness.sessionController.restoreSessionThrowing(s),
    });

    // Toast is dismissed
    expect(harness.state.inboxUndoToast).toBeUndefined();
    // Explicit user-readable error is set
    expect(harness.state.error).toContain("Session was already deleted");
  });

  it("restore '404' response reaches SessionInboxController.undoArchive and sets 'Session was already deleted'", async () => {
    const session = { ...oldSession, persisted: true };
    const harness = await seedArchivedUndo([session], session);

    vi.spyOn(harness.sessionApi, "restore").mockRejectedValueOnce(new Error("404 Not Found"));

    await harness.inboxController.undoArchive({
      restoreSession: (s) => harness.sessionController.restoreSessionThrowing(s),
    });

    expect(harness.state.inboxUndoToast).toBeUndefined();
    expect(harness.state.error).toContain("Session was already deleted");
  });

  it("restore generic server error surfaces the raw error message (not 'already deleted')", async () => {
    const session = { ...oldSession, persisted: true };
    const harness = await seedArchivedUndo([session], session);

    vi.spyOn(harness.sessionApi, "restore").mockRejectedValueOnce(new Error("Internal server error"));

    await harness.inboxController.undoArchive({
      restoreSession: (s) => harness.sessionController.restoreSessionThrowing(s),
    });

    expect(harness.state.inboxUndoToast).toBeUndefined();
    expect(harness.state.error).toContain("Internal server error");
    expect(harness.state.error).not.toContain("Session was already deleted");
  });

  it("successful restore notifies inbox bridge (notifyRestored) exactly once", async () => {
    const session = { ...oldSession, persisted: true };
    const harness = await seedArchivedUndo([session], session);

    let notifyRestoredCalls = 0;
    const origNotify = harness.inboxController.notifyRestored.bind(harness.inboxController);
    vi.spyOn(harness.inboxController, "notifyRestored").mockImplementation((mid, s) => {
      notifyRestoredCalls += 1;
      origNotify(mid, s);
    });

    vi.spyOn(harness.sessionApi, "restore").mockResolvedValueOnce({ restored: true });

    await harness.inboxController.undoArchive({
      restoreSession: (s) => harness.sessionController.restoreSessionThrowing(s),
    });

    // notifyRestored called exactly once (from restoreSessionThrowing, not twice)
    expect(notifyRestoredCalls).toBe(1);
  });
});
