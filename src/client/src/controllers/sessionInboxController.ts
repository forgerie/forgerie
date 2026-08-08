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
