/**
 * Tests for U8: archive workflow in SessionInboxController.
 *
 * Covers:
 *  - archiveWithUndo: server-first archive + 5-second undo toast
 *  - Replacement toast: second archive forfeits first undo
 *  - Navigation/dismiss: dismissUndoToast clears the toast, archive stands
 *  - Timer expiry: archive stands after 5s, toast cleared
 *  - Archive failure: session stays in place, no toast, error state
 *  - undoArchive: success path + stale-undo race
 *  - Working session confirmation: confirm required; Blocked does not require it
 *  - archiveAndNext: queue advance, cross-workspace next, last-item all-clear
 *  - dispose cleanup
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionActivity, SessionInfo, SessionStatus } from "../api";
import type {
  MachineSessionListingSnapshot,
  SessionAskCatalogSnapshot,
} from "../../../shared/apiTypes";
import {
  SessionInboxController,
  type SessionInboxApi,
  type ArchiveWithUndoDeps,
  type UndoArchiveDeps,
  type ArchiveAndNextDeps,
} from "./sessionInboxController";
import { deriveSessionBoard } from "../sessionBoard";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    cwd: "/workspace-1",
    path: `/tmp/${id}.jsonl`,
    created: "2026-08-01T00:00:00.000Z",
    modified: "2026-08-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
    ...overrides,
  };
}

function makeStatus(
  sessionId: string,
  overrides: Partial<SessionStatus> = {},
): SessionStatus {
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
  sessions: SessionInfo[],
  statuses: SessionStatus[] = [],
  activities: SessionActivity[] = [],
): MachineSessionListingSnapshot {
  return { sessions, statuses, activities };
}

function makeAskCatalog(): SessionAskCatalogSnapshot {
  return { sessions: [] };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createHarness(sessions: SessionInfo[] = [], options: {
  apiOverrides?: Partial<SessionInboxApi>;
} = {}) {
  let state: AppState = { ...initialAppState() };
  const api: SessionInboxApi = {
    machineListing: vi.fn(() => Promise.resolve(makeListing(sessions))),
    asksCatalog: vi.fn(() => Promise.resolve(makeAskCatalog())),
    ...options.apiOverrides,
  };

  const controller = new SessionInboxController(
    () => state,
    (patch) => { state = { ...state, ...patch }; },
    { api },
  );

  return {
    controller,
    api,
    get state() { return state; },
    async seed(machineId = "local") {
      await controller.refresh(machineId);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared archive deps builder
// ---------------------------------------------------------------------------

function makeArchiveDeps(
  overrides: Partial<ArchiveWithUndoDeps> = {},
): ArchiveWithUndoDeps {
  return {
    machineId: "local",
    archiveSession: vi.fn(() => Promise.resolve()),
    confirm: () => true,
    timerMs: 5000,
    ...overrides,
  };
}

function makeUndoDeps(
  overrides: Partial<UndoDeps> = {},
): UndoArchiveDeps {
  return {
    restoreSession: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

// Keep TS happy (UndoDeps re-export alias)
type UndoDeps = UndoArchiveDeps;

// ---------------------------------------------------------------------------
// archiveWithUndo — happy path
// ---------------------------------------------------------------------------

describe("archiveWithUndo — happy path", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("moves session to Archived in global store after successful server archive", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const deps = makeArchiveDeps();
    await harness.controller.archiveWithUndo(session, deps);

    const s1 = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
    expect(s1?.archived).toBe(true);
  });

  it("returns true when archive succeeds", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const result = await harness.controller.archiveWithUndo(session, makeArchiveDeps());

    expect(result).toBe(true);
  });

  it("sets inboxUndoToast after successful archive", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const deps = makeArchiveDeps();
    await harness.controller.archiveWithUndo(session, deps);

    expect(harness.state.inboxUndoToast).toBeDefined();
    expect(harness.state.inboxUndoToast?.session.id).toBe("s1");
    expect(harness.state.inboxUndoToast?.machineId).toBe("local");
  });

  it("clears inboxUndoToast after the timer expires (5-second window)", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const deps = makeArchiveDeps({ timerMs: 5000 });
    await harness.controller.archiveWithUndo(session, deps);

    expect(harness.state.inboxUndoToast).toBeDefined();

    vi.advanceTimersByTime(5000);

    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("calls the injected archiveSession function", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const archiveSession = vi.fn(() => Promise.resolve());
    const deps = makeArchiveDeps({ archiveSession });
    await harness.controller.archiveWithUndo(session, deps);

    expect(archiveSession).toHaveBeenCalledWith(session);
  });
});

  it("ignores a completed archive after the selected machine changes", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed("local");
    let finishArchive!: () => void;
    const archiveSession = vi.fn(() => new Promise<void>((resolve) => { finishArchive = resolve; }));

    const archive = harness.controller.archiveWithUndo(session, makeArchiveDeps({ archiveSession }));
    await Promise.resolve();
    await harness.controller.refresh("remote");
    finishArchive();

    await expect(archive).resolves.toBe(false);
    expect(harness.state.globalSessions?.machineId).toBe("remote");
    expect(harness.state.globalSessions?.sessions[0]?.archived).not.toBe(true);
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

// ---------------------------------------------------------------------------
// archiveWithUndo — replacement toast (second archive forfeits first undo)
// ---------------------------------------------------------------------------

describe("archiveWithUndo — replacement toast", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a second archive before first undo expires replaces the toast with the new session", async () => {
    const s1 = makeSession("s1");
    const s2 = makeSession("s2");
    const harness = createHarness([s1, s2]);
    await harness.seed();

    const deps1 = makeArchiveDeps({ timerMs: 5000 });
    await harness.controller.archiveWithUndo(s1, deps1);
    expect(harness.state.inboxUndoToast?.session.id).toBe("s1");

    // Archive s2 before s1's timer expires
    const deps2 = makeArchiveDeps({ timerMs: 5000 });
    await harness.controller.archiveWithUndo(s2, deps2);

    // Toast now shows s2 (s1's undo is forfeited)
    expect(harness.state.inboxUndoToast?.session.id).toBe("s2");
  });

  it("s1 timer expiry after replacement does not clear s2 toast", async () => {
    const s1 = makeSession("s1");
    const s2 = makeSession("s2");
    const harness = createHarness([s1, s2]);
    await harness.seed();

    await harness.controller.archiveWithUndo(s1, makeArchiveDeps({ timerMs: 2000 }));
    await harness.controller.archiveWithUndo(s2, makeArchiveDeps({ timerMs: 5000 }));

    // s1's timer (2s) fires — must NOT clear the s2 toast
    vi.advanceTimersByTime(2001);
    expect(harness.state.inboxUndoToast?.session.id).toBe("s2");

    // s2's timer (5s) fires — toast is now cleared
    vi.advanceTimersByTime(3000);
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// archiveWithUndo — failure path
// ---------------------------------------------------------------------------

describe("archiveWithUndo — failure path", () => {
  it("does not set inboxUndoToast when the server archive throws", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const deps = makeArchiveDeps({
      archiveSession: vi.fn(() => Promise.reject(new Error("server error"))),
    });

    await expect(harness.controller.archiveWithUndo(session, deps)).rejects.toThrow("server error");
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("propagates the error (does not return false) when the server archive throws", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const deps = makeArchiveDeps({
      archiveSession: vi.fn(() => Promise.reject(new Error("server error"))),
    });

    // Must throw, not silently return false
    await expect(harness.controller.archiveWithUndo(session, deps)).rejects.toThrow("server error");
  });

  it("does not move session to Archived in global store when the server archive throws", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const deps = makeArchiveDeps({
      archiveSession: vi.fn(() => Promise.reject(new Error("server error"))),
    });

    try {
      await harness.controller.archiveWithUndo(session, deps);
    } catch {
      // expected
    }

    const s1 = harness.state.globalSessions?.sessions.find((s) => s.id === "s1");
    expect(s1?.archived).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// dismissUndoToast — navigation clears the toast
// ---------------------------------------------------------------------------

describe("dismissUndoToast", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("clears the toast immediately (navigation path)", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));
    expect(harness.state.inboxUndoToast).toBeDefined();

    harness.controller.dismissUndoToast();
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("does not fire the timer callback after dismissal (no double-clear)", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));
    harness.controller.dismissUndoToast();

    // Advancing time should not throw or re-set the toast
    vi.advanceTimersByTime(6000);
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("is a no-op when no undo is active", () => {
    const harness = createHarness();
    // Should not throw
    expect(() => { harness.controller.dismissUndoToast(); }).not.toThrow();
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// undoArchive — success path
// ---------------------------------------------------------------------------

describe("undoArchive — success path", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("calls restoreSession and clears the undo toast on success", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));
    expect(harness.state.inboxUndoToast).toBeDefined();

    const restoreSession = vi.fn(() => Promise.resolve());
    await harness.controller.undoArchive(makeUndoDeps({ restoreSession }));

    expect(restoreSession).toHaveBeenCalledWith(harness.state.inboxUndoToast?.session ?? session);
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("cancels the expiry timer when undo is executed", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));
    await harness.controller.undoArchive(makeUndoDeps());

    // Timer must not re-fire and re-clear something that is already gone
    vi.advanceTimersByTime(6000);
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("is a no-op when no undo is active", async () => {
    const harness = createHarness();
    const restoreSession = vi.fn(() => Promise.resolve());
    // Should not throw
    await expect(harness.controller.undoArchive(makeUndoDeps({ restoreSession }))).resolves.toBeUndefined();
    expect(restoreSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// undoArchive — stale undo race
// ---------------------------------------------------------------------------

describe("undoArchive — stale undo race", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("dismisses the toast and surfaces an explicit error when restore throws a not-found error", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));

    const restoreSession = vi.fn(() =>
      Promise.reject(new Error("404 Not Found: session file missing")),
    );
    await harness.controller.undoArchive(makeUndoDeps({ restoreSession }));

    // Toast is dismissed (archive stands)
    expect(harness.state.inboxUndoToast).toBeUndefined();
    // Explicit error surfaces
    expect(harness.state.error).toContain("Session was already deleted");
  });

  it("dismisses toast and shows explicit error when restore throws a 404 response", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));

    const restoreSession = vi.fn(() =>
      Promise.reject(new Error("Session not found")),
    );
    await harness.controller.undoArchive(makeUndoDeps({ restoreSession }));

    expect(harness.state.inboxUndoToast).toBeUndefined();
    expect(harness.state.error).toContain("Session was already deleted");
  });

  it("dismisses toast and shows generic error when restore throws a non-not-found error", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));

    const restoreSession = vi.fn(() =>
      Promise.reject(new Error("Internal server error")),
    );
    await harness.controller.undoArchive(makeUndoDeps({ restoreSession }));

    expect(harness.state.inboxUndoToast).toBeUndefined();
    expect(harness.state.error).toContain("Internal server error");
  });

  it("does not surface a stale restore failure after a machine switch", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed("local");
    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));
    let rejectRestore!: (error: unknown) => void;
    const restoreSession = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectRestore = reject; }));

    const undo = harness.controller.undoArchive(makeUndoDeps({ restoreSession }));
    await Promise.resolve();
    await harness.controller.refresh("remote");
    rejectRestore(new Error("old machine failed"));
    await undo;

    expect(harness.state.globalSessions?.machineId).toBe("remote");
    expect(harness.state.error).toBe("");
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Working session confirmation
// ---------------------------------------------------------------------------

describe("Working session confirmation", () => {
  it("does not archive when the session is Working and confirm returns false", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    // Seed a Working status into the global store.
    // status.update is buffered; flush so archiveWithUndo sees it in globalSessions.statuses.
    harness.controller.applyGlobalEvent("local", {
      type: "status.update",
      status: makeStatus("s1", { isStreaming: true }),
    });
    harness.controller.flushPendingSessionStateToGlobal();

    const archiveSession = vi.fn(() => Promise.resolve());
    const deps = makeArchiveDeps({
      archiveSession,
      confirm: () => false, // User declines
    });

    await harness.controller.archiveWithUndo(session, deps);

    expect(archiveSession).not.toHaveBeenCalled();
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("returns false when Working session confirm is declined", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    harness.controller.applyGlobalEvent("local", {
      type: "status.update",
      status: makeStatus("s1", { isStreaming: true }),
    });
    harness.controller.flushPendingSessionStateToGlobal();

    const result = await harness.controller.archiveWithUndo(session, makeArchiveDeps({ confirm: () => false }));

    expect(result).toBe(false);
  });

  it("archives without confirm when the session is Blocked (pending ask)", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    // Seed a Blocked status; flush so archiveWithUndo sees it in globalSessions.statuses.
    harness.controller.applyGlobalEvent("local", {
      type: "status.update",
      status: makeStatus("s1", {
        pendingAsk: {
          askId: "ask-1",
          askedAt: "2026-08-07T10:00:00.000Z",
          questions: [{ id: "q1", question: "Proceed?", options: [] }],
        },
      }),
    });
    harness.controller.flushPendingSessionStateToGlobal();

    const confirm = vi.fn(() => false); // Would block if called
    const archiveSession = vi.fn(() => Promise.resolve());
    const deps = makeArchiveDeps({ archiveSession, confirm });

    await harness.controller.archiveWithUndo(session, deps);

    expect(confirm).not.toHaveBeenCalled();
    expect(archiveSession).toHaveBeenCalled();
  });

  it("archives without confirm when the session is Open (no status)", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    const confirm = vi.fn(() => false);
    const archiveSession = vi.fn(() => Promise.resolve());
    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ archiveSession, confirm }));

    expect(confirm).not.toHaveBeenCalled();
    expect(archiveSession).toHaveBeenCalled();
  });

  it("archives when Working session is confirmed (confirm returns true)", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    harness.controller.applyGlobalEvent("local", {
      type: "status.update",
      status: makeStatus("s1", { isStreaming: true }),
    });
    harness.controller.flushPendingSessionStateToGlobal();

    const archiveSession = vi.fn(() => Promise.resolve());
    const deps = makeArchiveDeps({
      archiveSession,
      confirm: () => true,
    });

    await harness.controller.archiveWithUndo(session, deps);

    expect(archiveSession).toHaveBeenCalled();
    expect(harness.state.inboxUndoToast?.session.id).toBe("s1");
  });

  it("uses confirm message mentioning 'Working' or agent is active", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    harness.controller.applyGlobalEvent("local", {
      type: "status.update",
      status: makeStatus("s1", { isStreaming: true }),
    });
    harness.controller.flushPendingSessionStateToGlobal();

    const capturedMessages: string[] = [];
    const deps = makeArchiveDeps({
      archiveSession: vi.fn(() => Promise.resolve()),
      confirm: (msg) => {
        capturedMessages.push(msg);
        return true;
      },
    });

    await harness.controller.archiveWithUndo(session, deps);

    expect(capturedMessages).toHaveLength(1);
    const msg = capturedMessages[0] ?? "";
    // The message should communicate that the session is active/working
    expect(msg.toLowerCase()).toMatch(/working|active|running/);
  });

  it("confirm message does not claim the agent keeps running (server behavior unknown)", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    harness.controller.applyGlobalEvent("local", {
      type: "status.update",
      status: makeStatus("s1", { isStreaming: true }),
    });
    harness.controller.flushPendingSessionStateToGlobal();

    const capturedMessages: string[] = [];
    const deps = makeArchiveDeps({
      archiveSession: vi.fn(() => Promise.resolve()),
      confirm: (msg) => { capturedMessages.push(msg); return true; },
    });

    await harness.controller.archiveWithUndo(session, deps);

    const msg = capturedMessages[0] ?? "";
    // Must not assert server side effects we cannot guarantee
    expect(msg.toLowerCase()).not.toMatch(/will keep running|keep running in the background|finishes or errors/);
  });
});

// ---------------------------------------------------------------------------
// archiveAndNext — queue advance
// ---------------------------------------------------------------------------

describe("archiveAndNext", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function makeBoard(sessions: SessionInfo[], statuses: Record<string, SessionStatus> = {}) {
    return deriveSessionBoard({
      sessions,
      statuses,
      locationOf: () => ({
        projectId: "p1",
        projectName: "Project",
        projectPath: "/repo",
      }),
    });
  }

  function makeNextDeps(overrides: Partial<ArchiveAndNextDeps> = {}): ArchiveAndNextDeps {
    return {
      machineId: "local",
      archiveSession: vi.fn(() => Promise.resolve()),
      navigateTo: vi.fn(() => Promise.resolve()),
      onAllClear: vi.fn(),
      confirm: () => true,
      timerMs: 5000,
      ...overrides,
    };
  }

  it("archives the current session and navigates to the most urgent queue head", async () => {
    const current = makeSession("current", { modified: "2026-08-01T02:00:00.000Z" });
    const blocked = makeSession("blocked", { modified: "2026-08-01T01:00:00.000Z" });
    const unread = makeSession("unread", { modified: "2026-08-01T00:00:00.000Z" });
    const blockedStatus = makeStatus("blocked", {
      pendingAsk: {
        askId: "ask-1",
        askedAt: "2026-08-07T10:00:00.000Z",
        questions: [{ id: "q1", question: "Proceed?", options: [] }],
      },
    });
    const harness = createHarness([current, blocked, unread]);
    await harness.seed();
    const board = deriveSessionBoard({
      sessions: [current, blocked, unread],
      statuses: { blocked: blockedStatus },
      unreadSessionIds: new Set(["unread"]),
      locationOf: () => ({ projectId: "p1", projectName: "Project", projectPath: "/repo" }),
    });
    const navigateTo = vi.fn(() => Promise.resolve());

    await harness.controller.archiveAndNext(current, board, makeNextDeps({ navigateTo }));

    expect(navigateTo).toHaveBeenCalledWith(blocked, { preserveUndoToast: true });
    expect(navigateTo).not.toHaveBeenCalledWith(unread, expect.anything());
  });

  it("when no next in triage queue, calls onAllClear and does not navigate", async () => {
    const current = makeSession("current");
    const harness = createHarness([current]);
    await harness.seed();

    // board with only the 'current' session — after archive, queue is empty
    const board = makeBoard([current]);
    const navigateTo = vi.fn(() => Promise.resolve());
    const onAllClear = vi.fn();
    const deps = makeNextDeps({ navigateTo, onAllClear });

    await harness.controller.archiveAndNext(current, board, deps);

    expect(onAllClear).toHaveBeenCalled();
    // navigateTo must NOT be called when queue is empty
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("skips the current session when computing the next in queue", async () => {
    // current is unread; only other-session is in queue after current is archived
    const current = makeSession("current");
    const otherSession = makeSession("other-unread", { modified: "2026-08-01T00:00:00.000Z" });

    const harness = createHarness([current, otherSession]);
    await harness.seed();

    // Mark otherSession as unread
    const board = deriveSessionBoard({
      sessions: [current, otherSession],
      unreadSessionIds: new Set(["other-unread"]),
      locationOf: () => ({ projectId: "p1", projectName: "Project", projectPath: "/repo" }),
    });

    const navigateTo = vi.fn(() => Promise.resolve());
    const deps = makeNextDeps({ navigateTo });

    await harness.controller.archiveAndNext(current, board, deps);

    expect(navigateTo).toHaveBeenCalledWith(otherSession, { preserveUndoToast: true });
    expect(navigateTo).not.toHaveBeenCalledWith(current, expect.anything());
  });

  it("navigates cross-workspace when the next session has a different cwd", async () => {
    const current = makeSession("current", { cwd: "/workspace-a" });
    const nextSession = makeSession("next-unread", {
      cwd: "/workspace-b",
      modified: "2026-08-01T00:00:00.000Z",
    });

    const harness = createHarness([current, nextSession]);
    await harness.seed();

    const board = deriveSessionBoard({
      sessions: [current, nextSession],
      unreadSessionIds: new Set(["next-unread"]),
      locationOf: (s) => ({
        projectId: "p1",
        projectName: "Project",
        projectPath: s.cwd,
      }),
    });

    const navigateTo = vi.fn(() => Promise.resolve());
    const deps = makeNextDeps({ navigateTo });

    await harness.controller.archiveAndNext(current, board, deps);

    // navigateTo called with the cross-workspace next session
    expect(navigateTo).toHaveBeenCalledWith(nextSession, { preserveUndoToast: true });
  });

  it("activity-only Working session in archiveAndNext requires confirmation", async () => {
    const current = makeSession("activity-working");
    const activity: SessionActivity = {
      sessionId: current.id,
      phase: "active",
      label: "running tool",
      at: "2026-08-08T10:00:00.000Z",
    };
    const harness = createHarness([current], {
      apiOverrides: {
        machineListing: vi.fn(() => Promise.resolve(makeListing([current], [], [activity]))),
      },
    });
    await harness.seed();
    const archiveSession = vi.fn(() => Promise.resolve());
    const confirm = vi.fn(() => false);

    await harness.controller.archiveAndNext(
      current,
      deriveSessionBoard({
        sessions: [current],
        activities: { [current.id]: activity },
        locationOf: () => ({ projectId: "p1", projectName: "Project", projectPath: "/repo" }),
      }),
      makeNextDeps({ archiveSession, confirm }),
    );

    expect(confirm).toHaveBeenCalledOnce();
    expect(archiveSession).not.toHaveBeenCalled();
  });

  it("Working session in archiveAndNext requires confirmation", async () => {
    const current = makeSession("current");
    const harness = createHarness([current]);
    await harness.seed();

    harness.controller.applyGlobalEvent("local", {
      type: "status.update",
      status: makeStatus("current", { isStreaming: true }),
    });
    harness.controller.flushPendingSessionStateToGlobal();

    const board = makeBoard([current], { current: makeStatus("current", { isStreaming: true }) });
    const archiveSession = vi.fn(() => Promise.resolve());
    const navigateTo = vi.fn(() => Promise.resolve());
    const onAllClear = vi.fn();
    const deps = makeNextDeps({
      archiveSession,
      navigateTo,
      onAllClear,
      confirm: () => false, // Decline
    });

    await harness.controller.archiveAndNext(current, board, deps);

    // Declined: no archive, no navigation, no all-clear
    expect(archiveSession).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(onAllClear).not.toHaveBeenCalled();
  });

  it("stops completely (no navigation, no all-clear) when confirmation is declined on a multi-item queue", async () => {
    const current = makeSession("current");
    const nextSession = makeSession("next-unread", { modified: "2026-08-01T00:00:00.000Z" });
    const harness = createHarness([current, nextSession]);
    await harness.seed();

    // Make current Working; flush so archiveWithUndo sees it in globalSessions.statuses.
    harness.controller.applyGlobalEvent("local", {
      type: "status.update",
      status: makeStatus("current", { isStreaming: true }),
    });
    harness.controller.flushPendingSessionStateToGlobal();

    const board = deriveSessionBoard({
      sessions: [current, nextSession],
      unreadSessionIds: new Set(["next-unread"]),
      locationOf: () => ({ projectId: "p1", projectName: "Project", projectPath: "/repo" }),
    });

    const archiveSession = vi.fn(() => Promise.resolve());
    const navigateTo = vi.fn(() => Promise.resolve());
    const onAllClear = vi.fn();
    const deps = makeNextDeps({
      archiveSession,
      navigateTo,
      onAllClear,
      confirm: () => false, // Decline
    });

    await harness.controller.archiveAndNext(current, board, deps);

    expect(archiveSession).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
    expect(onAllClear).not.toHaveBeenCalled();
  });

  it("sets undo toast after archiveAndNext succeeds", async () => {
    const current = makeSession("current");
    const harness = createHarness([current]);
    await harness.seed();

    const board = makeBoard([current]);
    const deps = makeNextDeps({ timerMs: 5000 });

    await harness.controller.archiveAndNext(current, board, deps);

    expect(harness.state.inboxUndoToast?.session.id).toBe("current");
  });

  it("requests internal navigation that preserves the archive undo toast", async () => {
    const current = makeSession("current");
    const unread = makeSession("unread");
    const harness = createHarness([current, unread]);
    await harness.seed();
    const board = deriveSessionBoard({
      sessions: [current, unread],
      unreadSessionIds: new Set([unread.id]),
      locationOf: () => ({ projectId: "p1", projectName: "Project", projectPath: "/repo" }),
    });
    const navigateTo = vi.fn(() => Promise.resolve());

    await harness.controller.archiveAndNext(current, board, makeNextDeps({ navigateTo }));

    expect(navigateTo).toHaveBeenCalledWith(unread, { preserveUndoToast: true });
    expect(harness.state.inboxUndoToast?.session.id).toBe(current.id);
  });
});

// ---------------------------------------------------------------------------
// dispose cleanup
// ---------------------------------------------------------------------------

describe("dispose cleanup", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("dismisses the undo toast on dispose", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));
    expect(harness.state.inboxUndoToast).toBeDefined();

    harness.controller.dispose();
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });

  it("timer does not fire after dispose", async () => {
    const session = makeSession("s1");
    const harness = createHarness([session]);
    await harness.seed();

    await harness.controller.archiveWithUndo(session, makeArchiveDeps({ timerMs: 5000 }));
    harness.controller.dispose();

    // Advancing time after dispose should not throw or reset state
    vi.advanceTimersByTime(6000);
    expect(harness.state.inboxUndoToast).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Selection preservation when live group moves
// ---------------------------------------------------------------------------

describe("inboxUndoToast not in WorkspaceScopedStateReset", () => {
  it("workspace switch does not clear inboxUndoToast", async () => {
    const { resetWorkspaceScopedState } = await import("../appState");
    const reset = resetWorkspaceScopedState();
    expect(Object.prototype.hasOwnProperty.call(reset, "inboxUndoToast")).toBe(false);
  });
});
