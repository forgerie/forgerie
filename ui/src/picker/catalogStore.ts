import { z } from "zod";
import { asksSchema, listingSchema, parseCatalogEvent, projectsSchema, unreadSchema, type CatalogEvent, type WireStatus } from "./contracts";
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

/** Apply one live event. Pure so replay after a snapshot uses the same rules. */
export function applyCatalogEvent(state: CatalogState, event: CatalogEvent): CatalogState {
  switch (event.type) {
    case "status.update": return { ...state, statuses: { ...state.statuses, [event.status.sessionId]: toStatus(event.status) } };
    case "activity.update": return { ...state, activities: { ...state.activities, [event.activity.sessionId]: event.activity } };
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
  let attempt: { controller: AbortController; socket?: WebSocket; buffer?: CatalogEvent[] } | undefined;
  let unwatch: (() => void) | undefined;

  const update = (next: CatalogState) => {
    if (lifetime.signal.aborted) return;
    state = next;
    for (const listener of listeners) listener();
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
        if (current.buffer) current.buffer.push(event); else update(applyCatalogEvent(state, event));
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
        activities: Object.fromEntries(listing.activities.map((activity) => [activity.sessionId, activity])),
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
    dispose: () => { lifetime.abort(); clearTimeout(retryTimer); closeAttempt(); unwatch?.(); listeners.clear(); },
  };
}
export type CatalogStore = ReturnType<typeof createCatalogStore>;
