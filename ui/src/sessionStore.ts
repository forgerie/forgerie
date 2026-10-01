import { z } from "zod";
import { acceptedSchema, askCloseResponseSchema, catalogSchema, errorSchema, historySchema, isAskEvent, parseEvent, snapshotSchema, statusSchema, type AskAnswer, type AskEvent, type Session, type SessionEvent } from "./contracts";
import { noAsk, reduceAskEvent, resyncAsk, whileOpen, type AskAction, type AskState } from "./ask";
import { fromHistory, reconcileTranscriptIdentity, reduceEvent, seedTranscript, type Transcript } from "./transcript";
import { commandCatalogSchema, commandResultSchema, isCommand, type CommandCatalog, type CommandResult } from "./commands";
import { savedAttachmentsSchema, type PromptAttachment } from "./attachments";

export type Connection = { type: "loading" } | { type: "ready" }
  | { type: "reconnecting"; message: string } | { type: "failed"; message: string };
export interface SessionState {
  connection: Connection;
  session?: Session;
  transcript: Transcript;
  ask: AskState;
  sending: boolean;
  commandError?: string;
  commands: CommandCatalog;
  commandResult?: CommandResult;
}
export interface SessionTransport {
  request: (path: string, init: RequestInit) => Promise<Response>;
  connect: (path: string) => WebSocket;
  watchRecovery?: (recover: () => void) => () => void;
}
export const browserTransport: SessionTransport = {
  request: (path, init) => fetch(path, init),
  connect: (path) => {
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return new WebSocket(url);
  },
  watchRecovery: (recover) => {
    // Mobile sleep can leave a half-open socket without a close event. A return
    // to the page always opens a fresh subscription and authoritative join.
    const visible = () => { if (document.visibilityState === "visible") recover(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) recover(); };
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", restored);
    return () => {
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", restored);
    };
  },
};
interface RecoveryTiming { retryDelayMs?: number; maxRetryDelayMs?: number; openTimeoutMs?: number }
interface Join {
  controller: AbortController;
  socket?: WebSocket;
  buffered: SessionEvent[];
  askBuffered: AskEvent[];
  seeding: boolean;
  seq: number;
}
class ReadFailure extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
function permanent(error: unknown) {
  return error instanceof z.ZodError || error instanceof SyntaxError
    || error instanceof ReadFailure && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * `known` lets a caller that already holds the session (the picker) skip the
 * machine catalog read: 2.7 MB and ~0.4 s on the reference machine. Without
 * it, the store finds the session's cwd in `/api/sessions/all` itself.
 */
export function createSessionStore(id: string, transport: SessionTransport, timing: RecoveryTiming = {}, known?: Session) {
  let state: SessionState = { connection: { type: "loading" }, ...(known?.id === id ? { session: known } : {}), transcript: fromHistory([]), ask: noAsk, sending: false, commands: { type: "loading" } };
  const listeners = new Set<() => void>();
  const lifetime = new AbortController();
  let join: Join | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const initialDelay = timing.retryDelayMs ?? 500;
  let retryDelay = initialDelay;
  let unwatch: (() => void) | undefined;
  let started = false;
  const update = (next: SessionState) => {
    if (lifetime.signal.aborted) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const current = (attempt: Join) => join === attempt && !lifetime.signal.aborted;
  function closeJoin() {
    const old = join;
    join = undefined; // Invalidate before close/abort can publish callbacks.
    old?.controller.abort();
    old?.socket?.close();
  }
  function stop(error: unknown) {
    clearTimeout(retryTimer);
    closeJoin();
    update({ ...state, connection: { type: "failed", message: messageOf(error) } });
  }
  function retry(attempt: Join, error: unknown) {
    if (!current(attempt)) return;
    closeJoin();
    update({ ...state, connection: { type: "reconnecting", message: messageOf(error) } });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { void connect(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 1.6, timing.maxRetryDelayMs ?? 5000);
  }
  async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}, signal = lifetime.signal): Promise<T> {
    const response = await transport.request(path, {
      ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => undefined);
      const error = errorSchema.safeParse(body);
      throw new ReadFailure(error.success ? error.data.error : `Request failed: HTTP ${response.status}`, response.status);
    }
    return schema.parse(await response.json());
  }
  const root = `/api/sessions/${encodeURIComponent(id)}`;
  function readPath(endpoint: string, session: Session) {
    return `${root}/${endpoint}?${new URLSearchParams({ cwd: session.cwd })}`;
  }
  let catalogAttempt = 0;
  async function loadCommands() {
    const session = state.session;
    if (!session || lifetime.signal.aborted) return;
    const attempt = ++catalogAttempt;
    update({ ...state, commands: { type: "loading" } });
    try {
      const commands = await request(readPath("commands", session), commandCatalogSchema);
      if (attempt === catalogAttempt) update({ ...state, commands: { type: "ready", commands } });
    } catch (error) {
      if (attempt === catalogAttempt) update({ ...state, commands: { type: "failed", message: messageOf(error) } });
    }
  }
  async function connect() {
    if (lifetime.signal.aborted) return;
    const attempt: Join = { controller: new AbortController(), buffered: [], askBuffered: [], seeding: true, seq: -1 };
    join = attempt;
    const read = <T>(path: string, schema: z.ZodType<T>) => request(path, schema, {}, attempt.controller.signal);
    try {
      let session = state.session;
      if (!session) {
        const catalog = await read("/api/sessions/all", catalogSchema);
        if (!current(attempt)) return;
        session = catalog.sessions.find((item) => item.id === id);
        if (!session) { stop(new Error(`Session ${id} was not found. Check the session ID in the URL.`)); return; }
        update({ ...state, session });
      }
      const socket = transport.connect(`${root}/events`);
      attempt.socket = socket;
      // Decode synchronously: the proxy forwards binary frames and Blob awaits
      // can reorder deltas and completed messages.
      socket.binaryType = "arraybuffer";
      socket.addEventListener("message", (event) => {
        if (!current(attempt)) return;
        try {
          const payload = typeof event.data === "string" ? event.data
            : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : undefined;
          if (payload === undefined) throw new Error("Unsupported WebSocket payload.");
          const parsed = parseEvent(JSON.parse(payload));
          if (!parsed || parsed.seq !== undefined && parsed.seq <= attempt.seq) return;
          if (parsed.seq !== undefined) attempt.seq = parsed.seq;
          if (isAskEvent(parsed)) {
            if (attempt.seeding) attempt.askBuffered.push(parsed);
            else update({ ...state, ask: reduceAskEvent(state.ask, parsed) });
          } else if (attempt.seeding) attempt.buffered.push(parsed);
          else update({ ...state, transcript: reduceEvent(state.transcript, parsed) });
        } catch (error) { stop(new Error(`Invalid session event: ${messageOf(error)}`)); }
      });
      socket.addEventListener("close", () => retry(attempt, new Error("Live connection closed.")));
      socket.addEventListener("error", () => retry(attempt, new Error("Live connection failed.")));
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          attempt.controller.signal.removeEventListener("abort", onAbort);
          socket.removeEventListener("open", onOpen);
        };
        const onAbort = () => { cleanup(); reject(new Error("Connection attempt ended.")); };
        const onOpen = () => { cleanup(); resolve(); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error("Live connection timed out.")); }, timing.openTimeoutMs ?? 15_000);
        attempt.controller.signal.addEventListener("abort", onAbort, { once: true });
        socket.addEventListener("open", onOpen, { once: true });
      });
      // Every connection gets its own buffer and watermark. A previous hub's
      // sequence is meaningless after a daemon restart. Subscribe before reads.
      const history = await read(readPath("messages", session), historySchema);
      if (!current(attempt)) return;
      const snapshot = await read(readPath("stream-snapshot", session), snapshotSchema);
      if (!current(attempt)) return;
      const status = await read(readPath("status", session), statusSchema);
      if (!current(attempt)) return;
      const seeded = seedTranscript(history.messages, snapshot.partial, snapshot.seq,
        status.isStreaming || status.isCompacting || status.isBashRunning, attempt.buffered);
      // Keep persisted message identities, including messages first seen live,
      // so existing disclosures do not remount when fresh history replaces them.
      const transcript = reconcileTranscriptIdentity(state.transcript, seeded);
      // Status is read after the snapshot, so it covers every ask event up to
      // the watermark. Later events may be older or newer than the status read;
      // opens and closes are keyed by ask ID, so replaying them is safe.
      const ask = attempt.askBuffered.filter((event) => (event.seq ?? Infinity) > snapshot.seq)
        .reduce(reduceAskEvent, resyncAsk(state.ask, status.pendingAsk));
      attempt.seq = Math.max(attempt.seq, snapshot.seq);
      attempt.seeding = false;
      attempt.buffered.length = 0;
      attempt.askBuffered.length = 0;
      retryDelay = initialDelay; // A socket open alone is not a successful join.
      update({ ...state, connection: { type: "ready" }, transcript, ask });
      void loadCommands(); // Discovery failure must not break history or the live connection.
    } catch (error) {
      if (!current(attempt)) return;
      if (permanent(error)) stop(error);
      else retry(attempt, error);
    }
  }
  function recover() {
    if (!started || lifetime.signal.aborted || state.connection.type === "failed") return;
    clearTimeout(retryTimer);
    closeJoin();
    update({ ...state, connection: { type: "reconnecting", message: "Refreshing the live connection." } });
    void connect();
  }
  async function start() {
    if (started || lifetime.signal.aborted) return;
    started = true;
    unwatch = transport.watchRecovery?.(recover);
    await connect();
  }
  async function runSlash(endpoint: "commands/run" | "commands/respond", body: { text: string } | { requestId: string; value: string }): Promise<CommandResult> {
    const session = state.session;
    if (!session || state.connection.type !== "ready") throw new Error("The session is not connected.");
    if (state.sending) throw new Error("Wait for the current command to finish.");
    update({ ...state, sending: true, commandError: undefined });
    try {
      const result = await request(`${root}/${endpoint}`, commandResultSchema, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, ...body }),
      });
      if (result.type === "unsupported") throw new Error(result.message);
      update({ ...state, commandResult: result,
        ...(result.type === "done" && result.session?.id === id ? { session: result.session } : {}) });
      if (endpoint === "commands/run" && "text" in body && /^\/reload(?:\s|$)/u.test(body.text)) void loadCommands();
      return result;
    } catch (error) {
      update({ ...state, commandError: messageOf(error) });
      throw error;
    } finally { update({ ...state, sending: false }); }
  }
  async function command(endpoint: "prompt" | "abort", text?: string, attachments?: PromptAttachment[]) {
    const session = state.session;
    if (!session || state.connection.type !== "ready") throw new Error("The session is not connected.");
    if (endpoint === "prompt" && (state.transcript.isRunning || state.sending)) throw new Error("Wait for the current run to finish.");
    update({ ...state, sending: true, commandError: undefined });
    try {
      // Never automatically retry a mutation: the server may have accepted it
      // even if its HTTP acknowledgement was lost.
      await request(`${root}/${endpoint}`, endpoint === "prompt" ? acceptedSchema : z.unknown(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, ...(text === undefined ? {} : { text }), ...(attachments?.length ? { attachments } : {}) }),
      });
    } catch (error) {
      update({ ...state, commandError: messageOf(error) });
      throw error;
    } finally { update({ ...state, sending: false }); }
  }
  /**
   * Submit or dismiss the open ask. The form stays open until the server
   * confirms, and a failure keeps the user's answers. Never retried: the
   * server may have closed the ask even if its reply was lost.
   */
  async function closeAsk(action: AskAction, answers: AskAnswer[] = []) {
    const session = state.session;
    const open = state.ask;
    if (!session || state.connection.type !== "ready" || open.type !== "open" || open.phase.type !== "answering") return;
    const { askId } = open.ask;
    update({ ...state, ask: { ...open, phase: { type: "sending", action } } });
    try {
      const response = await request(`${root}/ask/${action === "submit" ? "submit" : "cancel"}`, askCloseResponseSchema, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, askId, ...(action === "submit" ? { answers } : {}) }),
      });
      // `stale` means another browser or a newer ask won. Either way the
      // returned status names the open ask now.
      const pending = response.sessionStatus.pendingAsk;
      update({ ...state, ask: whileOpen(state.ask, askId, () => resyncAsk(noAsk, pending?.askId === askId ? undefined : pending)) });
    } catch (error) {
      update({ ...state, ask: whileOpen(state.ask, askId, (current) => ({ ...current, phase: { type: "answering", error: messageOf(error) } })) });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start,
    send: async (text: string, attachments?: PromptAttachment[]) => {
      if (isCommand(text)) {
        if (attachments?.length) throw new Error("Remove attachments before running a slash command.");
        return runSlash("commands/run", { text });
      }
      return command("prompt", text, attachments);
    },
    respondToCommand: (requestId: string, value: string) => runSlash("commands/respond", { requestId, value }),
    dismissCommand: () => update({ ...state, commandResult: undefined }),
    loadCommands,
    saveAttachment: async (attachment: PromptAttachment, signal?: AbortSignal) => {
      const session = state.session;
      if (!session || state.connection.type !== "ready") throw new Error("The session is not connected. Your file stays here.");
      const response = await request(`${root}/attachments`, savedAttachmentsSchema, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, attachments: [attachment] }),
      }, signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal]));
      return response.attachments[0]!;
    },
    cancel: () => command("abort"),
    submitAsk: (answers: AskAnswer[]) => closeAsk("submit", answers),
    dismissAsk: () => closeAsk("dismiss"),
    dispose: () => { lifetime.abort(); clearTimeout(retryTimer); closeJoin(); unwatch?.(); listeners.clear(); },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
