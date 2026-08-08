/**
 * Integration tests: SessionController notifies SessionInboxBridge after
 * mutations that add, remove, or update sessions in the global projection.
 *
 * Uses a RecordingInboxBridge — a real implementation that records every call
 * — to verify the bridge contract without touching AppState.globalSessions
 * directly.
 */

import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import type { SessionInfo } from "../api";
import type { GlobalSessionEvent } from "../sessionSocket";
import { SessionController } from "./sessionController";
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
import type { SessionInboxBridge } from "./sessionInboxController";

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
