import { z } from "zod";
import { acceptedSchema, catalogSchema, errorSchema, historySchema, parseEvent, snapshotSchema, statusSchema, type Session, type SessionEvent } from "./contracts";
import { fromHistory, reduceEvent, seedTranscript, type Transcript } from "./transcript";

export type Connection = { type: "loading" } | { type: "ready" } | { type: "failed"; message: string };
export interface SessionState {
  connection: Connection;
  session?: Session;
  transcript: Transcript;
  sending: boolean;
  commandError?: string;
}
export interface SessionTransport {
  request: (path: string, init: RequestInit) => Promise<Response>;
  connect: (path: string) => WebSocket;
}
export const browserTransport: SessionTransport = {
  request: (path, init) => fetch(path, init),
  connect: (path) => {
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(url);
  },
};
export function createSessionStore(id: string, transport: SessionTransport) {
  let state: SessionState = { connection: { type: "loading" }, transcript: fromHistory([]), sending: false };
  const listeners = new Set<() => void>();
  const controller = new AbortController();
  let socket: WebSocket | undefined;
  let started = false;
  const buffered: SessionEvent[] = [];
  let bootstrapping = true;
  const update = (next: SessionState) => {
    if (controller.signal.aborted) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
  const fail = (error: unknown) => update({ ...state, connection: { type: "failed", message: messageOf(error) } });
  async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await transport.request(path, {
      ...init, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = errorSchema.safeParse(body);
      throw new Error(error.success ? error.data.error : `Request failed: HTTP ${response.status}`);
    }
    return schema.parse(body);
  }
  const root = `/api/sessions/${encodeURIComponent(id)}`;
  function readPath(endpoint: string, session: Session) {
    return `${root}/${endpoint}?${new URLSearchParams({ cwd: session.cwd })}`;
  }
  async function start() {
    if (started) return;
    started = true;
    try {
      const catalog = await request("/api/sessions/all", catalogSchema);
      const session = catalog.sessions.find((item) => item.id === id);
      if (!session) throw new Error(`Session ${id} was not found. Check the session ID in the URL.`);
      update({ ...state, session });
      socket = transport.connect(`${root}/events`);
      // Forgerie's proxy forwards upstream Buffers as binary frames. Decode
      // synchronously to preserve delta/final event order without Blob awaits.
      socket.binaryType = "arraybuffer";
      socket.addEventListener("message", (event) => {
        try {
          const payload = typeof event.data === "string" ? event.data
            : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : undefined;
          if (payload === undefined) throw new Error("Unsupported WebSocket payload.");
          const parsed = parseEvent(JSON.parse(payload));
          if (!parsed) return;
          if (bootstrapping) buffered.push(parsed);
          else update({ ...state, transcript: reduceEvent(state.transcript, parsed) });
        } catch (error) { fail(new Error(`Invalid session event: ${messageOf(error)}`)); }
      });
      socket.addEventListener("close", () => fail(new Error("Live connection closed. Reload to load current history and reconnect.")));
      socket.addEventListener("error", () => fail(new Error("Live connection failed. Check Forgerie on port 8504 and reload.")));
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Live connection timed out.")), 15_000);
        const cleanup = () => {
          clearTimeout(timeout);
          controller.signal.removeEventListener("abort", onAbort);
        };
        const onAbort = () => { cleanup(); reject(new Error("Session closed.")); };
        controller.signal.addEventListener("abort", onAbort, { once: true });
        socket!.addEventListener("open", () => { cleanup(); resolve(); }, { once: true });
        socket!.addEventListener("error", () => { cleanup(); reject(new Error("Cannot open the live connection.")); }, { once: true });
        socket!.addEventListener("close", () => { cleanup(); reject(new Error("Live connection closed.")); }, { once: true });
      });
      // Subscribe before fetching so sends from another browser are not lost.
      const history = await request(readPath("messages", session), historySchema);
      const snapshot = await request(readPath("stream-snapshot", session), snapshotSchema);
      const status = await request(readPath("status", session), statusSchema);
      if (state.connection.type === "failed") return;
      const transcript = seedTranscript(history.messages, snapshot.partial, snapshot.seq,
        status.isStreaming || status.isCompacting || status.isBashRunning, buffered);
      bootstrapping = false;
      buffered.length = 0;
      update({ ...state, connection: { type: "ready" }, transcript });
    } catch (error) { fail(error); }
  }
  async function command(endpoint: "prompt" | "abort", text?: string) {
    const session = state.session;
    if (!session || state.connection.type !== "ready") throw new Error("The session is not connected.");
    if (endpoint === "prompt" && (state.transcript.isRunning || state.sending)) throw new Error("Wait for the current run to finish.");
    update({ ...state, sending: true, commandError: undefined });
    try {
      await request(`${root}/${endpoint}`, endpoint === "prompt" ? acceptedSchema : z.unknown(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, ...(text === undefined ? {} : { text }) }),
      });
    } catch (error) {
      update({ ...state, commandError: messageOf(error) });
      throw error;
    } finally { update({ ...state, sending: false }); }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    send: (text: string) => command("prompt", text),
    cancel: () => command("abort"),
    dispose: () => { controller.abort(); socket?.close(); listeners.clear(); },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
