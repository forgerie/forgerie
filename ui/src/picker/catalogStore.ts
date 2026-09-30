import { z } from "zod";
import { asksSchema, deleteArchivedSchema, listingSchema, parseCatalogEvent, projectsSchema, unreadSchema, type CatalogEvent, type WireStatus } from "./contracts";
import type { PickerActivity, PickerProject, PickerSession, PickerStatus } from "./board";
import type { SessionTransport } from "../sessionStore";

/** How far the picker's copy of the machine catalog can be trusted. */
export type CatalogConnection =
  | { type: "loading" }
  | { type: "ready" }
  | { type: "reconnecting" }
  | { type: "failed"; message: string };
export interface CatalogState {
  connection: CatalogConnection;
  sessions: PickerSession[];
  statuses: Record<string, PickerStatus>;
  activities: Record<string, PickerActivity>;
  unread: ReadonlySet<string>;
  projects: PickerProject[];
}
interface Timing { retryDelayMs?: number; maxRetryDelayMs?: number }

const toStatus = (status: WireStatus): PickerStatus => ({
  isStreaming: status.isStreaming, isCompacting: status.isCompacting, isBashRunning: status.isBashRunning,
  workingAgents: status.workingAgents, runningProcesses: status.runningProcesses,
  blocked: status.pendingAsk !== undefined || (status.pendingDialogs?.length ?? 0) > 0,
});

/**
 * Changes this client made and the server confirmed. The server broadcasts pins
 * but not archive, restore, or delete, so the store applies those itself.
 */
export type LocalChange =
  | { type: "local.archived"; sessionId: string; archived: boolean }
  | { type: "local.deleted"; sessionId: string };

/** Apply one live event or confirmed local change. Pure so replay after a snapshot uses the same rules. */
export function applyCatalogEvent(state: CatalogState, event: CatalogEvent | LocalChange): CatalogState {
  switch (event.type) {
    case "local.archived":
      return { ...state, sessions: state.sessions.map((session) => session.id === event.sessionId
        // An archived session is never pinned: the server refuses both at once.
        ? { ...session, archived: event.archived, ...(event.archived ? { pinned: false } : {}) } : session) };
    case "local.deleted": {
      const unread = new Set(state.unread);
      unread.delete(event.sessionId);
      return { ...state, unread, sessions: state.sessions.filter((session) => session.id !== event.sessionId) };
    }
    // The server sends these tens of times a second while sessions run, mostly
    // with nothing the picker draws changed. An unchanged event returns the same
    // state, so the picker does not rebuild thousands of rows for it.
    case "status.update": {
      const next = toStatus(event.status);
      return sameFields(state.statuses[event.status.sessionId], next) ? state
        : { ...state, statuses: { ...state.statuses, [event.status.sessionId]: next } };
    }
    case "activity.update": {
      const next = toActivity(event.activity);
      return sameFields(state.activities[event.activity.sessionId], next) ? state
        : { ...state, activities: { ...state.activities, [event.activity.sessionId]: next } };
    }
    case "session.created":
      return state.sessions.some((session) => session.id === event.session.id) ? state
        : { ...state, sessions: [event.session, ...state.sessions] };
    case "session.name":
      return { ...state, sessions: state.sessions.map((session) => session.id === event.sessionId ? { ...session, name: event.name } : session) };
    case "session.pinned":
      return { ...state, sessions: state.sessions.map((session) => session.id === event.sessionId ? { ...session, pinned: event.pinned } : session) };
    case "sessions.unread": {
      const unread = new Set(state.unread);
      if (event.unread === null) unread.delete(event.sessionId); else unread.add(event.sessionId);
      return { ...state, unread };
    }
  }
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
/** About one frame at 60 Hz. */
const LIVE_FRAME_MS = 16;
const toActivity = (activity: PickerActivity): PickerActivity =>
  ({ phase: activity.phase, ...(activity.activeSince ? { activeSince: activity.activeSince } : {}) });
function sameFields<T extends object>(a: T | undefined, b: T): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof T>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** A refused write. `status` lets a caller tell "already gone" (404) from other refusals. */
export class MutationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/** The identity every session write needs: the server resolves a session by id within its cwd. */
export interface SessionRef { id: string; cwd: string }
const errorBody = z.object({ error: z.string() });

/**
 * One machine's session catalog, kept live.
 *
 * Join order: subscribe, buffer events, read the snapshots, then replay the
 * buffer on top. Every reconnect repeats the whole join, because the server
 * does not replay missed frames and a sessiond restart clears pending asks.
 */
export function createCatalogStore(transport: SessionTransport, options: { timing?: Timing } = {}) {
  // Local machine only. Slice 4 turns this into one store per machine under
  // /api/machines/:id and merges them.
  const prefix = "/api";
  const machine = "/api/machines/local";
  let state: CatalogState = { connection: { type: "loading" }, sessions: [], statuses: {}, activities: {}, unread: new Set(), projects: [] };
  const listeners = new Set<() => void>();
  const lifetime = new AbortController();
  const initialDelay = options.timing?.retryDelayMs ?? 500;
  let retryDelay = initialDelay;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempt: { controller: AbortController; socket?: WebSocket; buffer?: (CatalogEvent | LocalChange)[] } | undefined;
  let unwatch: (() => void) | undefined;

  let frame: ReturnType<typeof setTimeout> | undefined;
  const notify = () => { clearTimeout(frame); frame = undefined; for (const listener of listeners) listener(); };
  const update = (next: CatalogState) => {
    if (lifetime.signal.aborted || next === state) return;
    state = next;
    notify();
  };
  /**
   * Live events land in the state at once but tell the view at most once per
   * frame. A busy machine sends dozens a second; each one rebuilding every row
   * kept the page's main thread busy about 75% of the time while idle.
   */
  const updateLive = (next: CatalogState) => {
    if (lifetime.signal.aborted || next === state) return;
    state = next;
    frame ??= setTimeout(notify, LIVE_FRAME_MS);
  };
  async function read<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    const response = await transport.request(path, { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
    if (!response.ok) throw new Error(`${path} failed: HTTP ${String(response.status)}`);
    return schema.parse(await response.json());
  }
  function closeAttempt() {
    const old = attempt;
    attempt = undefined;
    old?.controller.abort();
    old?.socket?.close();
  }
  function retry(current: typeof attempt) {
    if (attempt !== current || lifetime.signal.aborted) return;
    closeAttempt();
    // Keep the last known rows on screen. The picker marks them as stale.
    update({ ...state, connection: state.sessions.length > 0 ? { type: "reconnecting" } : state.connection });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { void join(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 1.6, options.timing?.maxRetryDelayMs ?? 5000);
  }
  async function join() {
    if (lifetime.signal.aborted) return;
    const current: NonNullable<typeof attempt> = { controller: new AbortController(), buffer: [] };
    attempt = current;
    const live = () => attempt === current && !lifetime.signal.aborted;
    try {
      const socket = transport.connect(`${prefix}/events`);
      current.socket = socket;
      socket.binaryType = "arraybuffer";
      socket.addEventListener("message", (message) => {
        if (!live()) return;
        const text = typeof message.data === "string" ? message.data : new TextDecoder().decode(message.data as ArrayBuffer);
        let event: CatalogEvent | undefined;
        try { event = parseCatalogEvent(JSON.parse(text)); }
        catch (error) { console.warn("Picker ignored a malformed machine event.", error); return; }
        if (!event) return;
        if (current.buffer) current.buffer.push(event); else updateLive(applyCatalogEvent(state, event));
      });
      socket.addEventListener("close", () => retry(current));
      socket.addEventListener("error", () => retry(current));
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        current.controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      const signal = current.controller.signal;
      const [listing, asks, unread, projects] = await Promise.all([
        read(`${prefix}/sessions/all`, listingSchema, signal),
        read(`${prefix}/sessions/asks`, asksSchema, signal),
        read(`${prefix}/sessions/unread`, unreadSchema, signal),
        read(`${machine}/projects`, projectsSchema, signal),
      ]);
      if (!live()) return;
      const statuses: Record<string, PickerStatus> = {};
      for (const status of listing.statuses) statuses[status.sessionId] = toStatus(status);
      for (const entry of asks.sessions) {
        const blocked = entry.pendingAsk !== undefined || (entry.pendingDialogs?.length ?? 0) > 0;
        if (!blocked) continue;
        statuses[entry.id] = { ...(statuses[entry.id] ?? { isStreaming: false, isCompacting: false, isBashRunning: false }), blocked: true };
      }
      let next: CatalogState = {
        connection: { type: "ready" },
        sessions: listing.sessions,
        statuses,
        activities: Object.fromEntries(listing.activities.map((activity) => [activity.sessionId, toActivity(activity)])),
        unread: new Set(unread.sessions.map((entry) => entry.sessionId)),
        projects,
      };
      for (const event of current.buffer ?? []) next = applyCatalogEvent(next, event);
      current.buffer = undefined;
      retryDelay = initialDelay;
      update(next);
    } catch (error) {
      if (!live()) return;
      if (error instanceof z.ZodError) {
        closeAttempt();
        update({ ...state, connection: { type: "failed", message: `The server sent a session list this client cannot read: ${messageOf(error)}` } });
        return;
      }
      retry(current);
    }
  }
  /** A confirmed change also joins a snapshot in flight, so an older snapshot cannot undo it. */
  function record(change: LocalChange) {
    attempt?.buffer?.push(change);
    update(applyCatalogEvent(state, change));
  }
  async function write<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const response = await transport.request(path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(20_000)]),
    });
    const parsed: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = errorBody.safeParse(parsed);
      throw new MutationError(error.success ? error.data.error : `Request failed: HTTP ${String(response.status)}`, response.status);
    }
    return schema.parse(parsed);
  }
  const sessionPath = (ref: SessionRef, action: string) => `${prefix}/sessions/${encodeURIComponent(ref.id)}/${action}`;
  const accepted = z.object({}).passthrough();
  /**
   * Session writes. Each resolves once the server confirmed and the catalog
   * shows the result, or rejects with the server's own reason and leaves the
   * catalog unchanged. None is retried: a write the reader did not see land is
   * one they can repeat.
   */
  const mutations = {
    async setPinned(ref: SessionRef, pinned: boolean) {
      await write(sessionPath(ref, pinned ? "pin" : "unpin"), { cwd: ref.cwd }, accepted);
      // The server also broadcasts session.pinned. Applying it now keeps the
      // row from waiting on the socket; the event then changes nothing.
      update(applyCatalogEvent(state, { type: "session.pinned", sessionId: ref.id, pinned }));
    },
    async setArchived(ref: SessionRef, archived: boolean) {
      await write(sessionPath(ref, archived ? "archive" : "restore"), { cwd: ref.cwd }, accepted);
      record({ type: "local.archived", sessionId: ref.id, archived });
    },
    /** Delete one archived session for good. The route is a bulk one that reports per-session failures with HTTP 200. */
    async deleteArchived(ref: SessionRef) {
      const result = await write(`${prefix}/sessions/bulk/delete-archived`, { sessions: [{ id: ref.id, cwd: ref.cwd }] }, deleteArchivedSchema);
      const failure = result.failures.find((entry) => entry.sessionId === ref.id);
      if (failure || !result.deletedSessionIds.includes(ref.id)) throw new MutationError(failure?.error ?? "The server did not delete the session.", failure?.error === "Archived session not found" ? 404 : 400);
      record({ type: "local.deleted", sessionId: ref.id });
    },
  };
  function recover() {
    if (lifetime.signal.aborted || state.connection.type === "failed") return;
    clearTimeout(retryTimer);
    closeAttempt();
    void join();
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => { unwatch = transport.watchRecovery?.(recover); return join(); },
    retry: () => { update({ ...state, connection: { type: "loading" } }); recover(); },
    ...mutations,
    dispose: () => { lifetime.abort(); clearTimeout(retryTimer); clearTimeout(frame); closeAttempt(); unwatch?.(); listeners.clear(); },
  };
}
export type CatalogStore = ReturnType<typeof createCatalogStore>;
