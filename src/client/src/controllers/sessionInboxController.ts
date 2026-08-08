/**
 * Machine-scoped global session inbox store.
 *
 * Owns the `globalSessions` AppState slice. Follows the data discipline of
 * `SessionUnreadController`:
 *   - HTTP snapshot establishes join state.
 *   - Contiguous socket events keep it current.
 *   - Reconnect re-snapshots (re-fetches both the machine listing and asks
 *     catalog), which corrects any stale Blocked/Working classifications that
 *     accumulated while disconnected.
 *   - Machine switch increments the generation, clears the old slice, and
 *     re-fetches under the new machine's generation. Responses from the
 *     previous generation are discarded on arrival.
 *
 * Graduated from `prototypes/session-board/sessionBoard.js`.
 */

import { sessionsApi } from "../api";
import type { SessionInfo, SessionStatus } from "../api";
import type {
  MachineSessionListingSnapshot,
  SessionAskCatalogEntry,
  SessionAskCatalogSnapshot,
} from "../../../shared/apiTypes";
import type { GlobalSessionEvent } from "../sessionSocket";
import { markSessionArchived, markSessionsArchived } from "./sessionSelection";
import type { GetState, SetState } from "./types";
import type { GlobalSessionsState } from "../appState";
import {
  sessionBoardState,
  triageQueue,
  type SessionBoard,
} from "../sessionBoard";

// ---------------------------------------------------------------------------
// Public API interface (injectable for tests)
// ---------------------------------------------------------------------------

export interface SessionInboxApi {
  machineListing(machineId?: string): Promise<MachineSessionListingSnapshot>;
  asksCatalog(machineId?: string): Promise<SessionAskCatalogSnapshot>;
}

// ---------------------------------------------------------------------------
// Bridge interface — consumed by SessionController for mutation notifications
// ---------------------------------------------------------------------------

/**
 * Subset of {@link SessionInboxController} that {@link SessionController}
 * calls into. The controller does not depend on the full inbox class; it only
 * needs this bridge so the global store stays consistent after mutations that
 * originate in the workspace-scoped path.
 */
export interface SessionInboxBridge {
  /**
   * Route a global session event to the inbox controller.
   * Called by PiWebApp alongside SessionController.applyGlobalEvent.
   */
  applyGlobalEvent(machineId: string, event: GlobalSessionEvent): void;

  /** The selected-workspace archive path succeeded; update the global store. */
  notifyArchived(machineId: string, sessionId: string, archivedAt: string): void;

  /** A bulk archive (by descendants or by selection) succeeded. */
  notifyBulkArchived(
    machineId: string,
    sessionIds: readonly string[],
    archivedAt: string,
  ): void;

  /** A restore succeeded; update the global store. */
  notifyRestored(machineId: string, session: SessionInfo): void;

  /**
   * Sessions were permanently deleted; remove them from the global projection.
   * Also removes their entries from the statuses map.
   */
  notifyDeleted(machineId: string, sessionIds: readonly string[]): void;

  /**
   * One session's metadata changed (e.g. parentSessionPath removed after
   * detachParent). Replaces the session entry in-place by id.
   */
  notifySessionUpdated(machineId: string, session: SessionInfo): void;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SessionInboxControllerOptions {
  api?: SessionInboxApi | undefined;
  onBackgroundError?:
    | ((
        operation: "listing" | "asks",
        machineId: string,
        error: unknown,
      ) => void)
    | undefined;
}

// ---------------------------------------------------------------------------
// Archive workflow types (U8)
// ---------------------------------------------------------------------------

/**
 * Dependencies injected into {@link SessionInboxController.archiveWithUndo}.
 *
 * Separating concerns allows tests to inject controllable fakes for the
 * server boundary (archiveSession), the confirm dialog, and the timer duration.
 */
export interface ArchiveWithUndoDeps {
  /** The machine this archive is targeting (for undo toast ownership). */
  machineId: string;
  /** Server-side archive call (e.g. `() => sessions.archiveSession(session)`). */
  archiveSession: (session: SessionInfo) => Promise<void>;
  /**
   * Confirmation dialog for Working sessions. Returns true to proceed, false
   * to abort. Defaults to `window.confirm` in production; injected in tests.
   * Not called for Blocked sessions (archiving a Blocked session is safe and
   * does not require confirmation).
   */
  confirm?: (message: string) => boolean;
  /** Undo window duration in milliseconds. Defaults to 5000. */
  timerMs?: number;
}

/**
 * Dependencies injected into {@link SessionInboxController.undoArchive}.
 */
export interface UndoArchiveDeps {
  /** Server-side restore call (e.g. `() => sessions.restoreSession(session)`). */
  restoreSession: (session: SessionInfo) => Promise<void>;
}

/**
 * Dependencies injected into {@link SessionInboxController.archiveAndNext}.
 *
 * Extends {@link ArchiveWithUndoDeps} with queue-advance semantics.
 */
export interface ArchiveAndNextDeps extends ArchiveWithUndoDeps {
  /**
   * Navigate to the given session (e.g. `selectInboxSession`). Called after
   * archive succeeds and a next session is found in the triage queue.
   */
  navigateTo: (session: SessionInfo) => Promise<void>;
  /**
   * Called when the triage queue is empty after the archive. The caller
   * is responsible for returning focus to a real board element or the all-clear.
   */
  onAllClear: () => void;
}

/** Private tagged union for undo timer ownership. */
type InboxUndoState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "active";
      readonly session: SessionInfo;
      readonly machineId: string;
      /**
       * A unique tag incremented whenever a new undo is installed or the
       * existing one is cancelled. The timer callback checks this tag against
       * the value it captured at install time; if they differ, the timer is
       * stale and must not clear the toast.
       */
      readonly tag: number;
      readonly timerId: ReturnType<typeof setTimeout>;
    };

// ---------------------------------------------------------------------------
// Private state
// ---------------------------------------------------------------------------

const defaultApi: SessionInboxApi = {
  machineListing: (machineId) => sessionsApi.machineListing(machineId),
  asksCatalog: (machineId) => sessionsApi.asksCatalog(machineId),
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * Owns the machine-scoped `globalSessions` AppState slice.
 *
 * One instance per PiWebApp; injected into SessionController as
 * {@link SessionInboxBridge} for mutation notifications.
 */
export class SessionInboxController implements SessionInboxBridge {
  private readonly api: SessionInboxApi;
  private readonly onBackgroundError: (
    operation: "listing" | "asks",
    machineId: string,
    error: unknown,
  ) => void;

  private currentMachineId: string | undefined;
  /**
   * Monotonically-increasing counter. Incremented on every machine switch and
   * on dispose. Any in-flight async operation that captures the generation at
   * its start discards its result if the generation has advanced by the time
   * the response arrives.
   */
  private generation = 0;
  private refreshPromise: Promise<void> | undefined;
  private refreshQueued = false;
  private disposed = false;

  // U8: undo toast state
  private undoState: InboxUndoState = { kind: "idle" };
  /** Incremented whenever a new undo is installed; used to tag timer callbacks so stale ones are ignored. */
  private undoTag = 0;
  /**
   * Events buffered while a snapshot fetch is in flight.
   * Set to an array at the start of each `runRefresh`; reset to `undefined`
   * after the snapshot is applied and the buffer has been replayed.
   * `applyGlobalEvent` pushes here instead of applying directly when the
   * buffer is active, so the later snapshot cannot overwrite the events.
   */
  private inflightBuffer: GlobalSessionEvent[] | undefined;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    options: SessionInboxControllerOptions = {},
  ) {
    this.api = options.api ?? defaultApi;
    this.onBackgroundError =
      options.onBackgroundError ??
      ((operation, machineId, error) => {
        console.warn(
          `SessionInboxController: ${operation} snapshot failed for ${machineId}`,
          error,
        );
      });
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.currentMachineId = undefined;
    this.refreshPromise = undefined;
    this.refreshQueued = false;
    this.inflightBuffer = undefined;
    this.clearUndoTimer();
    // Clear the toast from AppState on dispose so it does not outlive the
    // controller's lifetime (e.g. unmount, machine switch with full teardown).
    this.setState({ inboxUndoToast: undefined });
  }

  /**
   * Trigger a snapshot refresh for the given machine.
   *
   * Called by PiWebApp on:
   *   - Initial machine selection.
   *   - Realtime socket (re)connect — corrects stale state after sessiond
   *     restarts (pending asks disappear, running sessions stop, etc.).
   *
   * Machine switch: if `machineId` differs from the current machine, the
   * existing slice is cleared, the generation is bumped, and a fresh fetch
   * starts under the new generation. Any in-flight request for the previous
   * machine is abandoned (generation guard).
   */
  refresh(machineId: string): Promise<void> {
    if (this.disposed) return Promise.resolve();

    // Machine switch: clear old state, bump generation.
    if (this.currentMachineId !== machineId) {
      this.generation += 1;
      this.currentMachineId = machineId;
      this.refreshPromise = undefined;
      this.refreshQueued = false;
      this.inflightBuffer = undefined;
      this.setState({
        globalSessions: {
          machineId,
          status: "loading",
          sessions: [],
          statuses: {},
        },
      });
    }

    // Coalesce concurrent calls: queue a trailing refresh if one is in flight.
    if (this.refreshPromise !== undefined) {
      this.refreshQueued = true;
      return this.refreshPromise;
    }

    // Activate the event buffer so events that arrive while the HTTP snapshot
    // is in flight are held and replayed on top of the snapshot rather than
    // being silently overwritten when the snapshot is applied.
    this.inflightBuffer = [];
    const generation = this.generation;
    const promise = this.runRefresh(machineId, generation).finally(() => {
      if (this.generation === generation && this.refreshPromise === promise) {
        this.refreshPromise = undefined;
        if (this.refreshQueued) {
          this.refreshQueued = false;
          // Promise is discarded; the caller can await the returned promise
          // from refresh() — this trailing kick is fire-and-forget internally.
          void this.refresh(machineId);
        }
      }
    });
    this.refreshPromise = promise;
    return promise;
  }

  // -------------------------------------------------------------------------
  // SessionInboxBridge — event routing
  // -------------------------------------------------------------------------

  /**
   * Route a global session event to the inbox store.
   *
   * Handles: `session.created`, `session.name`, `status.update`.
   * Silently ignores events for a different machine or before any refresh.
   */
  applyGlobalEvent(machineId: string, event: GlobalSessionEvent): void {
    if (this.disposed || this.currentMachineId !== machineId) return;
    const current = this.getState().globalSessions;
    if (current?.machineId !== machineId) return;

    // If a snapshot fetch is in flight, buffer the event so it is replayed on
    // top of the snapshot once it arrives rather than being overwritten by it.
    if (this.inflightBuffer !== undefined) {
      this.inflightBuffer.push(event);
      return;
    }

    this.applyEventToState(current, event);
  }

  private applyEventToState(current: GlobalSessionsState, event: GlobalSessionEvent): void {
    if (event.type === "session.created") {
      this.applyCreatedSession(current, event.session);
    } else if (event.type === "session.name") {
      this.applySessionName(current, event.sessionId, event.name);
    } else if (event.type === "status.update") {
      this.applyStatusUpdate(current, event.status);
    }
  }

  notifyArchived(machineId: string, sessionId: string, archivedAt: string): void {
    if (this.disposed || this.currentMachineId !== machineId) return;
    const current = this.getState().globalSessions;
    if (current?.machineId !== machineId) return;

    const sessions = markSessionArchived([...current.sessions], sessionId, archivedAt);
    this.setState({ globalSessions: { ...current, sessions } });
  }

  notifyBulkArchived(
    machineId: string,
    sessionIds: readonly string[],
    archivedAt: string,
  ): void {
    if (this.disposed || this.currentMachineId !== machineId) return;
    const current = this.getState().globalSessions;
    if (current?.machineId !== machineId) return;

    const sessions = markSessionsArchived([...current.sessions], sessionIds, archivedAt);
    this.setState({ globalSessions: { ...current, sessions } });
  }

  notifyRestored(machineId: string, session: SessionInfo): void {
    // Use the shared update path so there is one implementation of
    // "replace a session entry by id" in the global projection.
    this.notifySessionUpdated(machineId, session);
  }

  notifyDeleted(machineId: string, sessionIds: readonly string[]): void {
    if (this.disposed || this.currentMachineId !== machineId) return;
    const current = this.getState().globalSessions;
    if (current?.machineId !== machineId) return;
    if (sessionIds.length === 0) return;

    const deletedSet = new Set(sessionIds);
    const sessions = current.sessions.filter((s) => !deletedSet.has(s.id));
    const statuses: Record<string, SessionStatus> = {};
    for (const [id, s] of Object.entries(current.statuses)) {
      if (!deletedSet.has(id)) statuses[id] = s;
    }
    this.setState({ globalSessions: { ...current, sessions, statuses } });
  }

  notifySessionUpdated(machineId: string, session: SessionInfo): void {
    if (this.disposed || this.currentMachineId !== machineId) return;
    const current = this.getState().globalSessions;
    if (current?.machineId !== machineId) return;

    const sessions = current.sessions.map((s) => (s.id === session.id ? { ...session } : s));
    this.setState({ globalSessions: { ...current, sessions } });
  }

  // -------------------------------------------------------------------------
  // U8: Archive workflow — undo orchestration
  // -------------------------------------------------------------------------

  /**
   * Archive a session server-first, then present a 5-second undo toast.
   *
   * Working sessions (classified via the board's statuses) require a
   * confirmation dialog before archiving. Blocked sessions archive without
   * confirmation.
   *
   * If a previous undo is active, its timer is cancelled and the toast is
   * replaced with the new one (single-undo model).
   *
   * Returns `true` when the server confirmed the archive and the undo toast
   * is installed. Returns `false` when the controller is disposed or the
   * user declines the Working-session confirmation. Throws if the server
   * archive fails, leaving the session in place with no toast.
   */
  async archiveWithUndo(session: SessionInfo, deps: ArchiveWithUndoDeps): Promise<boolean> {
    if (this.disposed) return false;

    // Working session check: use the board state classifier against the
    // global statuses map. Blocked sessions skip confirmation.
    const statuses = this.getState().globalSessions?.statuses ?? {};
    const status = statuses[session.id];
    const boardState = sessionBoardState(session, { status });

    if (boardState.kind === "working") {
      const confirmFn = deps.confirm ?? defaultConfirm;
      const message =
        "This session is active. Archive it anyway?\n\n" +
        "Archiving an active session may interrupt work in progress.";
      if (!confirmFn(message)) return false; // User declined
    }

    // Server-first archive: throws on failure (caller handles the error).
    await deps.archiveSession(session);

    // Server confirmed; update the global store.
    const archivedAt = new Date().toISOString();
    this.notifyArchived(deps.machineId, session.id, archivedAt);

    // Replace any existing undo toast.
    this.clearUndoTimer();
    this.installUndoToast(session, deps.machineId, deps.timerMs ?? DEFAULT_UNDO_TIMER_MS);

    return true;
  }

  /**
   * Execute the undo (restore) for the active undo toast.
   *
   * No-ops if no undo is active. On "not found" errors (session was
   * permanently deleted between archive and undo), dismisses the toast and
   * surfaces an explicit "Session was already deleted" error instead of the
   * raw server error.
   */
  async undoArchive(deps: UndoArchiveDeps): Promise<void> {
    if (this.disposed) return;
    if (this.undoState.kind !== "active") return;

    const { session } = this.undoState;

    // Cancel the timer first so it does not clear the toast out from under
    // the restore call.
    this.clearUndoTimer();
    this.setState({ inboxUndoToast: undefined });

    try {
      await deps.restoreSession(session);
    } catch (error: unknown) {
      const message = String(error);
      if (isNotFoundError(message)) {
        this.setState({ error: "Session was already deleted" });
      } else {
        this.setState({ error: message });
      }
    }
  }

  /**
   * Dismiss the active undo toast without restoring (navigation path).
   *
   * The archive stands. The timer is cancelled so it does not fire later.
   */
  dismissUndoToast(): void {
    if (this.disposed) return;
    this.clearUndoTimer();
    this.setState({ inboxUndoToast: undefined });
  }

  /**
   * Archive the current session and advance to the next in the triage queue.
   *
   * After a successful archive the triage queue is recomputed from the board
   * (minus the just-archived session). If a next session exists, navigateTo
   * is called; if the queue is empty, onAllClear is called instead.
   *
   * Stops completely (no navigation, no all-clear) when {@link archiveWithUndo}
   * returns `false` — i.e. when the controller is disposed or the user
   * declines the Working-session confirmation.
   *
   * The undo toast is set the same as {@link archiveWithUndo}: the caller
   * can offer undo for the current archive while already viewing the next
   * session.
   */
  async archiveAndNext(
    current: SessionInfo,
    board: SessionBoard<SessionInfo>,
    deps: ArchiveAndNextDeps,
  ): Promise<void> {
    if (this.disposed) return;

    // Archive current session (with confirm if Working).
    // Stop completely on false — user declined or controller disposed.
    const archived = await this.archiveWithUndo(current, deps);
    if (!archived) return;

    // Recompute triage queue excluding the just-archived session.
    const queueAfter = triageQueue(board).filter((row) => row.session.id !== current.id);

    if (queueAfter.length === 0) {
      deps.onAllClear();
    } else {
      const nextRow = queueAfter[0];
      if (nextRow !== undefined) {
        await deps.navigateTo(nextRow.session);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async runRefresh(machineId: string, generation: number): Promise<void> {
    // If we have existing data, mark it stale during the fetch; if this is
    // the first fetch, mark it loading (already done in refresh() above).
    const before = this.getState().globalSessions;
    if (before?.machineId === machineId && before.status === "fresh") {
      this.setState({ globalSessions: { ...before, status: "stale" } });
    }

    try {
      // Fetch in parallel; both must succeed for a fresh snapshot.
      const [listing, asks] = await Promise.all([
        this.api.machineListing(machineId),
        this.api.asksCatalog(machineId),
      ]);

      if (this.disposed || this.generation !== generation) return;

      const statuses = buildStatuses(listing, asks);

      this.setState({
        globalSessions: {
          machineId,
          status: "fresh",
          sessions: listing.sessions,
          statuses,
        },
      });
      this.replayInflightBuffer(machineId, generation);
    } catch (error: unknown) {
      if (this.disposed || this.generation !== generation) return;

      const stale = this.getState().globalSessions;
      if (stale?.machineId === machineId) {
        if (stale.status !== "stale") {
          this.setState({ globalSessions: { ...stale, status: "stale" } });
        }
      } else {
        // No prior data for this machine: install an empty stale projection.
        this.setState({
          globalSessions: {
            machineId,
            status: "stale",
            sessions: [],
            statuses: {},
          },
        });
      }

      this.replayInflightBuffer(machineId, generation);
      this.onBackgroundError("listing", machineId, error);
    }
  }

  /**
   * Replay buffered events that arrived during the in-flight snapshot fetch.
   * Clears the buffer before replay so re-entrant calls from events that
   * themselves trigger state changes apply directly rather than re-buffering.
   */
  private replayInflightBuffer(machineId: string, generation: number): void {
    const buffer = this.inflightBuffer;
    this.inflightBuffer = undefined;
    if (buffer === undefined || buffer.length === 0) return;
    if (this.disposed || this.generation !== generation) return;
    for (const event of buffer) {
      // Re-read current state before each event so each replay sees the result
      // of the previous replay step (important for ordered session.created
      // duplicate-check and sequential name/status updates).
      const current = this.getState().globalSessions;
      if (current?.machineId !== machineId) return;
      this.applyEventToState(current, event);
    }
  }

  private applyCreatedSession(
    current: GlobalSessionsState,
    session: SessionInfo,
  ): void {
    if (current.sessions.some((s) => s.id === session.id)) return;
    this.setState({
      globalSessions: {
        ...current,
        sessions: [session, ...current.sessions],
      },
    });
  }

  private applySessionName(
    current: GlobalSessionsState,
    sessionId: string,
    name: string | undefined,
  ): void {
    const sessions = current.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const next = { ...s };
      if (name === undefined || name === "") delete next.name;
      else next.name = name;
      return next;
    });
    this.setState({ globalSessions: { ...current, sessions } });
  }

  private applyStatusUpdate(
    current: GlobalSessionsState,
    status: SessionStatus,
  ): void {
    this.setState({
      globalSessions: {
        ...current,
        statuses: { ...current.statuses, [status.sessionId]: status },
      },
    });
  }

  // U8: undo timer management

  /**
   * Cancel the active undo timer, if any, and transition to idle.
   * Does NOT clear AppState.inboxUndoToast — callers do that explicitly.
   */
  private clearUndoTimer(): void {
    if (this.undoState.kind === "active") {
      clearTimeout(this.undoState.timerId);
      this.undoState = { kind: "idle" };
    }
  }

  /**
   * Install a new undo toast for the given session. Increments the tag so
   * any stale timer from a previous undo cannot clear this toast.
   */
  private installUndoToast(session: SessionInfo, machineId: string, timerMs: number): void {
    this.undoTag += 1;
    const tag = this.undoTag;
    const timerId = setTimeout(() => {
      // Only clear if this timer is still the active one.
      if (this.undoState.kind === "active" && this.undoState.tag === tag) {
        this.undoState = { kind: "idle" };
        this.setState({ inboxUndoToast: undefined });
      }
    }, timerMs);
    this.undoState = { kind: "active", session, machineId, tag, timerId };
    this.setState({ inboxUndoToast: { session, machineId } });
  }
}

// ---------------------------------------------------------------------------
// Module-level constants and helpers
// ---------------------------------------------------------------------------

const DEFAULT_UNDO_TIMER_MS = 5000;

/**
 * Detect whether an error message indicates the session no longer exists.
 * Matches HTTP 404 patterns and common "not found" / "missing" messages.
 */
function isNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("404") ||
    lower.includes("not found") ||
    lower.includes("missing") ||
    lower.includes("already deleted")
  );
}

/** Production default confirm: delegates to window.confirm. */
function defaultConfirm(message: string): boolean {
  return window.confirm(message);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Build the combined statuses map from the machine listing and asks catalog.
 *
 * The listing statuses are authoritative: they come directly from live
 * runtimes. The asks catalog supplements entries for sessions that have
 * pending asks or dialogs but whose runtime is not in the listing statuses
 * (e.g., ask recorded before the listing snapshot was taken).
 *
 * The listing wins if both sources cover the same session: we never downgrade
 * a full runtime status to a synthetic one.
 */
function buildStatuses(
  listing: MachineSessionListingSnapshot,
  asks: SessionAskCatalogSnapshot,
): Record<string, SessionStatus> {
  const statuses: Record<string, SessionStatus> = {};

  for (const status of listing.statuses) {
    statuses[status.sessionId] = status;
  }

  for (const entry of asks.sessions) {
    // Listing status wins — do not overwrite with a synthetic entry.
    if (statuses[entry.id] !== undefined) continue;
    if (!hasAskOrDialog(entry)) continue;

    // Synthetic minimal status to expose the pending ask/dialog for board
    // derivation. The board only needs the ask/dialog fields; all counters
    // are zero because we have no live runtime data.
    statuses[entry.id] = {
      sessionId: entry.id,
      isStreaming: false,
      isCompacting: false,
      isBashRunning: false,
      pendingMessageCount: 0,
      queuedMessages: [],
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
      ...(entry.pendingAsk !== undefined ? { pendingAsk: entry.pendingAsk } : {}),
      ...(entry.pendingDialogs !== undefined && entry.pendingDialogs.length > 0
        ? { pendingDialogs: entry.pendingDialogs }
        : {}),
    };
  }

  return statuses;
}

function hasAskOrDialog(entry: SessionAskCatalogEntry): boolean {
  return (
    entry.pendingAsk !== undefined ||
    (entry.pendingDialogs !== undefined && entry.pendingDialogs.length > 0)
  );
}
