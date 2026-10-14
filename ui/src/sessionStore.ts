import type { ReadTracker } from "./readReceipt";
import { z } from "zod";
import { abortResultSchema, acceptedSchema, askCloseResponseSchema, catalogSchema, dialogCloseResponseSchema, durableBrowserSnapshotSchema, errorSchema, historySchema, isAskEvent, isOperationEvent, modelsResponseSchema, parseEvent, snapshotSchema, statusSchema, thinkingLevelsResponseSchema, type DurableBrowserSnapshot, type AskAnswer, type AskEvent, type OperationEvent, type Session, type SessionEvent, type SessionStatus } from "./contracts";
import { deliverPrompt, promptDelivery } from "./promptDelivery";
import { noAsk, reduceAskEvent, resyncAsk, whileOpen, type AskAction, type AskState } from "./ask";
import { carryUnsavedShellRows, fromHistory, hasRunningShell, reconcileTranscriptIdentity, reduceEvent, seedTranscript, type Transcript } from "./transcript";
import { shellAvailability, shellDraftOf, type ShellAvailability } from "./shellDraft";
import { commandCatalogSchema, commandResultSchema, isCommand, type CommandCatalog, type CommandResult } from "./commands";
import { savedAttachmentsSchema, type PromptAttachment } from "./attachments";
import { compactionFromOutput, compactionFromStatus, idleCompaction, isCompactCommand, type CompactionState } from "./compaction";
import { workingSend } from "./queue";
import { noDialogPhase, type StoredDialogPhase } from "./dialog";
import type { PromptDiffAnnotation } from "./changes/diffNotes";
import { afterFork, afterNavigate, closedTree, openTree, sessionTreeResponseSchema, treeForkResultSchema, treeNavigateResultSchema, withOperation as withTreeOperation, type SessionTreeSummaryChoice, type TreeNavigator, type TreeOutcome } from "./sessionTree";

export type Connection = { type: "loading" } | { type: "ready" }
  /** `attempt` counts tries since the last join; `retryAt` is when the next one starts (now or earlier: it runs already). */
  | { type: "reconnecting"; message: string; attempt: number; retryAt: number } | { type: "failed"; message: string };
/** Something that went wrong and that the reader may want to read in full. It stays until they dismiss it. */
export interface Problem { id: number; title: string; message: string; at: number }
const MAX_PROBLEMS = 20;
export interface SessionState {
  connection: Connection;
  /** When the live connection last finished a join. */
  lastReadyAt?: number;
  /** Newest first. */
  problems: readonly Problem[];
  session?: Session;
  transcript: Transcript;
  ask: AskState;
  sending: boolean;
  commandError?: string;
  commands: CommandCatalog;
  commandResult?: CommandResult;
  status?: SessionStatus;
  compaction: CompactionState;
  tree: TreeNavigator;
  /** The browser's side of the oldest open extension dialog. The dialogs themselves live in status. */
  dialogPhase: StoredDialogPhase;
}
export interface SessionTransport {
  request: (path: string, init: RequestInit) => Promise<Response>;
  connect: (path: string) => WebSocket;
  /** Enable only after the daemon composes native locators and parent app-document watches. */
  nativeReadModel?: boolean;
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
interface RecoveryTiming {
  retryDelayMs?: number; maxRetryDelayMs?: number; openTimeoutMs?: number;
  /** Most requests. */
  requestTimeoutMs?: number;
  /** Tree actions. A summary uses the model, so Forgerie's own proxy waits 5 minutes for them. */
  treeActionTimeoutMs?: number;
  now?: () => number;
}
interface Join {
  controller: AbortController;
  socket?: WebSocket;
  buffered: SessionEvent[];
  askBuffered: AskEvent[];
  operationBuffered: OperationEvent[];
  seeding: boolean;
  seq: number;
  nativeSnapshot?: DurableBrowserSnapshot;
  nativeReady?: () => void;
}
class ReadFailure extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/**
 * The server read the mutation and refused it, so it did not apply. A 5xx,
 * a proxy error, a timeout, or a lost reply proves nothing: it may have applied.
 */
function refused(error: unknown): error is ReadFailure {
  return error instanceof ReadFailure && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
function permanent(error: unknown) {
  return error instanceof z.ZodError || error instanceof SyntaxError
    || error instanceof ReadFailure && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
const SLASH_WAIT_MS = 10 * 60_000;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
/** The client stopped waiting for a command; the command itself may still run. */
class LostWait extends Error {
  constructor() { super("Lost the live connection while waiting for the command. It may still be running in Pi. Check the transcript before you run it again."); }
}
/** A mutation refused before any request. Nothing reached the server, so the draft can simply come back. */
export class NotSentError extends Error {}

/** A user's `!` command runs. Status lags its start, so an open shell row counts too. */
export function isBashRunning(state: SessionState): boolean {
  return state.status?.isBashRunning === true || hasRunningShell(state.transcript);
}
export function shellAvailabilityOf(state: SessionState): ShellAvailability {
  return shellAvailability({ connected: state.connection.type === "ready", sending: state.sending,
    bashRunning: isBashRunning(state), compaction: state.compaction });
}

/**
 * `known` lets a caller that already holds the session (the picker) skip the
 * machine catalog read: 2.7 MB and ~0.4 s on the reference machine. Without
 * it, the store finds the session's cwd in `/api/sessions/all` itself.
 */
export function createSessionStore(id: string, transport: SessionTransport, timing: RecoveryTiming = {}, known?: Session, reads?: ReadTracker,
  /** Server events the transcript does not use, by Pi event type, such as a child agent's change. */
  onPiEvent?: (eventType: string) => void) {
  let state: SessionState = { connection: { type: "loading" }, problems: [], ...(known?.id === id ? { session: known } : {}), transcript: fromHistory([]), ask: noAsk, sending: false, commands: { type: "loading" }, compaction: idleCompaction, tree: closedTree, dialogPhase: noDialogPhase };
  const now = timing.now ?? Date.now;
  let problemId = 0;
  /** The same words twice add nothing: a reconnect can replay the event that reported them. */
  function withProblem(next: SessionState, title: string, message: string): SessionState {
    if (next.problems.some((problem) => problem.title === title && problem.message === message)) return next;
    return { ...next, problems: [{ id: ++problemId, title, message, at: now() }, ...next.problems].slice(0, MAX_PROBLEMS) };
  }
  /** A failed action: the latest failure for callers that check it, and a problem the reader can open. */
  function fail(title: string, message: string, detail = message) {
    update(withProblem({ ...state, commandError: message }, title, detail));
  }
  let attempts = 0;
  let statusVersion = 0;
  const listeners = new Set<() => void>();
  const lifetime = new AbortController();
  let join: Join | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const initialDelay = timing.retryDelayMs ?? 500;
  let retryDelay = initialDelay;
  let unwatch: (() => void) | undefined;
  let unwatchUnread: (() => void) | undefined;
  let readRefreshRequested = false;
  let started = false;
  const update = (next: SessionState) => {
    if (lifetime.signal.aborted) return;
    // Pi reports a failed run on the transcript. Each new report becomes a problem.
    const error = next.transcript.error;
    state = error !== undefined && error !== state.transcript.error ? withProblem(next, "Pi reported an error", error) : next;
    for (const listener of listeners) listener();
  };
  const current = (attempt: Join) => join === attempt && !lifetime.signal.aborted;
  /** Slash commands waiting for Pi. They end with the live connection they were sent on. */
  const slashWaits = new Set<AbortController>();
  function closeJoin() {
    const old = join;
    join = undefined; // Invalidate before close/abort can publish callbacks.
    old?.controller.abort();
    old?.socket?.close();
    for (const wait of slashWaits) wait.abort(new LostWait());
  }
  function stop(error: unknown) {
    clearTimeout(retryTimer);
    closeJoin();
    update({ ...state, connection: { type: "failed", message: messageOf(error) } });
  }
  function retry(attempt: Join, error: unknown) {
    if (!current(attempt)) return;
    closeJoin();
    attempts++;
    update({ ...state, connection: { type: "reconnecting", message: messageOf(error), attempt: attempts, retryAt: now() + retryDelay } });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { void connect(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 1.6, timing.maxRetryDelayMs ?? 5000);
  }
  async function request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}, signal = lifetime.signal,
    timeoutMs: number | null = timing.requestTimeoutMs ?? 20_000, idempotentPrompt = false): Promise<T> {
    const send = idempotentPrompt ? (path: string, init: RequestInit) => deliverPrompt(transport.request, path, init) : transport.request;
    const response = await send(path, {
      ...init, signal: timeoutMs === null ? signal : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
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
  function withStatus(next: SessionState, incoming: SessionStatus): SessionState {
    // Live status events leave out the worktree and the read-only mark; only the status read carries them.
    const previous = next.status;
    const status: SessionStatus = { ...incoming,
      ...(incoming.worktree === undefined && previous?.worktree ? { worktree: previous.worktree } : {}),
      ...(incoming.readOnly === undefined && previous?.readOnly !== undefined ? { readOnly: previous.readOnly } : {}) };
    // A shell command is not an agent run: Stop cannot end it and prompts may start beside it.
    return { ...next, status, compaction: compactionFromStatus(next.compaction, status),
      transcript: { ...next.transcript, isRunning: status.isStreaming || status.isCompacting } };
  }
  function withOperation(next: SessionState, event: OperationEvent): SessionState {
    if (event.type === "status.update") return withStatus(next, event.status);
    const compaction = compactionFromOutput(event);
    if (compaction) return { ...next, compaction };
    const done: SessionState = { ...next, commandResult: { type: "done", message: event.message } };
    return event.level === "error" ? withProblem({ ...done, commandError: event.message }, "Command reported an error", event.message) : done;
  }
  async function refreshStatus() {
    const session = state.session;
    const attempt = join;
    const version = statusVersion;
    if (!session || !attempt) return;
    try {
      const status = await request(readPath("status", session), statusSchema, {}, attempt.controller.signal);
      if (current(attempt) && version === statusVersion) { statusVersion++; update(withStatus(state, status)); }
    } catch {
      // The mutation already succeeded. Recover reads only; never restore its text as an unsent command.
      if (current(attempt)) recover();
    }
  }
  function withNativeSnapshot(previous: SessionState, frame: DurableBrowserSnapshot): SessionState {
    const running = frame.isStreaming || frame.isCompacting;
    const seed = seedTranscript(frame.history.messages, frame.partial, -1, running, [], previous.status?.isBashRunning);
    // The normalizer records the raw source position. Replace timestamp keys with the
    // journal's stable presentation IDs before reconciling disclosures, including equal timestamps.
    let transcript: Transcript = { ...seed, messages: seed.messages.map((message) => {
      const source = message.position === undefined ? undefined : frame.history.messages[message.position];
      return source?.id === undefined ? message : { ...message, key: source.id };
    }) };
    for (const tool of frame.tools) {
      if (tool.status === "done") continue; // Completed results are already in committed history.
      transcript = reduceEvent(transcript, { type: "tool.start", toolCallId: tool.toolCallId, toolName: tool.toolName, args: undefined });
      transcript = reduceEvent(transcript, { type: "tool.update", toolCallId: tool.toolCallId, toolName: tool.toolName, text: tool.output });
    }
    // Shell output is not transcript authority yet. Keep it through replacements while it runs.
    const oldRunning = previous.transcript.messages.filter((message) => message.role === "shell" && message.parts.some((part) => part.type === "shell" && part.run.result.type === "running"));
    const carried = carryUnsavedShellRows(previous.transcript, transcript);
    const ids = new Set(carried.messages.map((message) => message.id));
    const merged = { ...carried, messages: [...carried.messages, ...oldRunning.filter((message) => !ids.has(message.id))] };
    const status: SessionStatus = { ...(previous.status ?? { isBashRunning: false }), isStreaming: frame.isStreaming, isCompacting: frame.isCompacting,
      queuedMessages: frame.queuedMessages, ...(frame.app === undefined ? {} : { pendingAsk: frame.app.pendingAsk }) };
    const next = withStatus({ ...previous, transcript: reconcileTranscriptIdentity(previous.transcript, merged),
      ask: frame.app === undefined ? previous.ask : resyncAsk(previous.ask, frame.app.pendingAsk),
      ...(previous.session === undefined || frame.app === undefined ? {} : { session: { ...previous.session, name: frame.app.sessionName } }) }, status);
    return next;
  }

  async function connect() {
    if (lifetime.signal.aborted) return;
    const attempt: Join = { controller: new AbortController(), buffered: [], askBuffered: [], operationBuffered: [], seeding: true, seq: -1 };
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
      const socket = transport.connect(`${root}/events${transport.nativeReadModel ? `?${new URLSearchParams({ cwd: session.cwd, native: "1" })}` : ""}`);
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
          const raw: unknown = JSON.parse(payload);
          if (typeof raw === "object" && raw !== null && "type" in raw && raw.type === "session.snapshot") {
            const frame = durableBrowserSnapshotSchema.parse(raw);
            const old = attempt.nativeSnapshot;
            if (old !== undefined && frame.epoch !== old.epoch) throw new Error("Native connection epoch changed; reconnect to resync.");
            if (old !== undefined && frame.revision <= old.revision) return;
            attempt.nativeSnapshot = frame;
            if (attempt.seeding) attempt.nativeReady?.();
            else update(withNativeSnapshot(state, frame));
            return;
          }
          if (onPiEvent && typeof raw === "object" && raw !== null && "type" in raw && raw.type === "pi.event"
            && "eventType" in raw && typeof raw.eventType === "string") onPiEvent(raw.eventType);
          if (onPiEvent && typeof raw === "object" && raw !== null && "type" in raw
            && (raw.type === "processes.update" || raw.type === "processes.output")) onPiEvent(raw.type);
          const parsed = parseEvent(raw);
          if (!parsed || parsed.seq !== undefined && parsed.seq <= attempt.seq) return;
          if (transport.nativeReadModel && parsed.type !== "command.output" && parsed.type !== "session.error" && !parsed.type.startsWith("shell.")) return;
          if (parsed.seq !== undefined) attempt.seq = parsed.seq;
          if (isAskEvent(parsed)) {
            if (attempt.seeding) attempt.askBuffered.push(parsed);
            else update({ ...state, ask: reduceAskEvent(state.ask, parsed) });
          } else if (isOperationEvent(parsed)) {
            if (parsed.type === "status.update") statusVersion++;
            if (attempt.seeding) attempt.operationBuffered.push(parsed);
            else update(withOperation(state, parsed));
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
      // Capture the read boundary BEFORE loading history. Never acknowledge a newer unseen completion.
      const receipt = await reads?.capture(session, attempt.controller.signal).catch((error: unknown) => { if (!attempt.controller.signal.aborted) console.warn("Could not capture the read boundary.", error); return undefined; });
      if (!current(attempt)) return;
      if (transport.nativeReadModel) {
        await new Promise<void>((resolve, reject) => {
          if (attempt.nativeSnapshot !== undefined) { resolve(); return; }
          const finish = () => { clearTimeout(timer); attempt.controller.signal.removeEventListener("abort", abort); attempt.nativeReady = undefined; resolve(); };
          const abort = () => { clearTimeout(timer); attempt.nativeReady = undefined; reject(new Error("Native connection attempt ended.")); };
          const timer = setTimeout(() => { attempt.nativeReady = undefined; reject(new Error("Native Durable seed timed out.")); }, timing.openTimeoutMs ?? 15_000);
          attempt.nativeReady = finish;
          attempt.controller.signal.addEventListener("abort", abort, { once: true });
        });
        if (!current(attempt) || attempt.nativeSnapshot === undefined) return;
        let joined = withNativeSnapshot(state, attempt.nativeSnapshot);
        // Only unsaved shell/control output is replayed. SDK transcript and ask events are not authority.
        for (const event of attempt.buffered) if (event.type.startsWith("shell.")) joined = { ...joined, transcript: reduceEvent(joined.transcript, event) };
        for (const event of attempt.operationBuffered) if (event.type === "command.output") joined = withOperation(joined, event);
        attempt.seeding = false; attempt.buffered.length = 0; attempt.askBuffered.length = 0; attempt.operationBuffered.length = 0;
        retryDelay = initialDelay; attempts = 0;
        update({ ...joined, connection: { type: "ready" }, lastReadyAt: now() });
        if (receipt && reads) void reads.acknowledge(receipt, attempt.controller.signal).catch((error: unknown) => { if (!attempt.controller.signal.aborted) console.warn("Could not mark the visible session read.", error); });
        void loadCommands();
        return;
      }
      const history = await read(readPath("messages", session), historySchema);
      if (!current(attempt)) return;
      const snapshot = await read(readPath("stream-snapshot", session), snapshotSchema);
      if (!current(attempt)) return;
      const beforeStatusRead = attempt.operationBuffered.length;
      const status = await read(readPath("status", session), statusSchema);
      if (!current(attempt)) return;
      const seeded = seedTranscript(history.messages, snapshot.partial, snapshot.seq,
        status.isStreaming || status.isCompacting, attempt.buffered, status.isBashRunning);
      // Keep persisted message identities, including messages first seen live,
      // so existing disclosures do not remount when fresh history replaces them.
      // Shell rows whose records Pi has not saved yet are not in the history.
      const transcript = reconcileTranscriptIdentity(state.transcript, carryUnsavedShellRows(state.transcript, seeded));
      // Status is read after the snapshot, so it covers every ask event up to
      // the watermark. Later events may be older or newer than the status read;
      // opens and closes are keyed by ask ID, so replaying them is safe.
      const ask = attempt.askBuffered.filter((event) => (event.seq ?? Infinity) > snapshot.seq)
        .reduce(reduceAskEvent, resyncAsk(state.ask, status.pendingAsk));
      attempt.seq = Math.max(attempt.seq, snapshot.seq);
      attempt.seeding = false;
      attempt.buffered.length = 0;
      attempt.askBuffered.length = 0;
      // Outputs are not persisted in the transcript, so even outputs below its
      // watermark must survive. Pre-read statuses yield to the authoritative GET.
      let joined: SessionState = { ...state, connection: { type: "ready" }, lastReadyAt: now(), transcript, ask };
      for (const event of attempt.operationBuffered.slice(0, beforeStatusRead)) {
        if (event.type === "command.output") joined = withOperation(joined, event);
      }
      joined = withStatus(joined, status);
      for (const event of attempt.operationBuffered.slice(beforeStatusRead)) joined = withOperation(joined, event);
      attempt.operationBuffered.length = 0;
      statusVersion++;
      retryDelay = initialDelay; // A socket open alone is not a successful join.
      attempts = 0;
      update(joined);
      if (receipt && reads) void reads.acknowledge(receipt, attempt.controller.signal).catch((error: unknown) => { if (!attempt.controller.signal.aborted) console.warn("Could not mark the visible session read.", error); });
      void loadCommands(); // Discovery failure must not break history or the live connection.
      if (readRefreshRequested && reads?.isVisible()) { readRefreshRequested = false; reload(); }
    } catch (error) {
      if (!current(attempt)) return;
      if (permanent(error)) stop(error);
      else retry(attempt, error);
    }
  }
  function recover(message = "Refreshing the live connection.") {
    if (!started || lifetime.signal.aborted || state.connection.type === "failed") return;
    clearTimeout(retryTimer);
    closeJoin();
    update({ ...state, connection: { type: "reconnecting", message, attempt: attempts + 1, retryAt: now() } });
    void connect();
  }
  /** Re-read history after the branch moved. The join stays "ready": nothing was lost, only replaced. */
  function reload() {
    if (!started || lifetime.signal.aborted || state.connection.type === "failed") return;
    clearTimeout(retryTimer);
    closeJoin();
    void connect();
  }
  async function start() {
    if (started || lifetime.signal.aborted) return;
    started = true;
    unwatch = transport.watchRecovery?.(() => recover());
    unwatchUnread = reads?.observe((sessionId) => {
      if (sessionId !== id || !reads?.isVisible()) return;
      if (state.connection.type === "ready") reload();
      else readRefreshRequested = true;
    });
    await connect();
  }
  async function runSlash(endpoint: "commands/run" | "commands/respond", body: { text: string } | { requestId: string; value: string }): Promise<CommandResult> {
    const session = state.session;
    if (!session || state.connection.type !== "ready") throw new NotSentError("The session is not connected.");
    if (state.sending) throw new NotSentError("Wait for the current command to finish.");
    const previousCompaction = state.compaction;
    update({ ...state, sending: true, commandError: undefined });
    const wait = new AbortController();
    slashWaits.add(wait);
    try {
      // Pi answers when the command ends, and an extension command can wait for
      // the user to answer its dialogs, so the usual 20-second timeout does not
      // apply. The wait ends with the live connection instead, or after ten
      // minutes, twice the daemon's default dialog timeout. Never retried.
      const result = await request(`${root}/${endpoint}`, commandResultSchema, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, ...body }),
      }, AbortSignal.any([lifetime.signal, wait.signal]), SLASH_WAIT_MS).catch((error: unknown) => {
        throw wait.signal.aborted && wait.signal.reason instanceof LostWait ? wait.signal.reason : error;
      });
      if (result.type === "unsupported") throw new Error(result.message);
      const compact = endpoint === "commands/run" && "text" in body && isCompactCommand(body.text);
      update({ ...state, ...(compact ? (state.compaction === previousCompaction && (previousCompaction.type === "idle" || previousCompaction.type === "finished")
        ? { compaction: { type: "checking" as const } } : {}) : result.type === "tree" ? { tree: openTree(result.tree) } : { commandResult: result }),
        ...(result.type === "done" && result.session?.id === id ? { session: result.session } : {}) });
      if (compact) void refreshStatus();
      if (endpoint === "commands/run" && "text" in body && /^\/reload(?:\s|$)/u.test(body.text)) void loadCommands();
      return result;
    } catch (error) {
      fail("Command failed", messageOf(error));
      throw error;
    } finally { slashWaits.delete(wait); update({ ...state, sending: false }); }
  }
  /** Never retried: a lost acknowledgement does not prove the command did not run. */
  async function runShell(text: string) {
    const session = state.session;
    const availability = shellAvailabilityOf(state);
    if (!session || availability.type === "blocked") {
      const message = availability.type === "blocked" ? availability.reason : "The session is not connected.";
      // Refused before any request, so it is the composer's note, not a problem.
      update({ ...state, commandError: message });
      throw new NotSentError(message);
    }
    update({ ...state, sending: true, commandError: undefined });
    try {
      await request(`${root}/shell`, acceptedSchema, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: session.cwd, text }),
      });
    } catch (error) {
      const message = refused(error) ? error.message
        : `${messageOf(error)} The command may have started. Check the conversation before running it again.`;
      fail("Shell command not confirmed", message);
      throw new Error(message, { cause: error });
    } finally { update({ ...state, sending: false }); }
  }
  /**
   * How Pi should deliver a prompt now. Idle prompts carry no behavior, exactly
   * as before. While the session works, a prompt becomes a follow-up, or a
   * steer when asked. Every refusal here happens before any request.
   */
  function deliveryOf(attachments: PromptAttachment[] | undefined, steer: boolean): "steer" | "followUp" | undefined {
    if (state.sending) throw new NotSentError("Wait for the current message to send.");
    const working = workingSend(state.status, state.compaction, state.transcript.isRunning);
    if (!state.transcript.isRunning && !working.queue) return undefined;
    if (!working.queue) throw new NotSentError("Wait for the current run to finish.");
    if (steer && !working.steer) throw new NotSentError("Steering works only while the agent responds. Queue the message instead.");
    // Stop returns only the text of queued work, so a queued inline image could be lost.
    // A file saved to the workspace travels as its path in that text, so it can queue.
    if (attachments?.length) throw new NotSentError("Images attached to a message cannot be queued. Save them to .forgerie/attachments, or send them after the run.");
    return steer ? "steer" : "followUp";
  }
  async function command(endpoint: "prompt" | "abort", text?: string, attachments?: PromptAttachment[], steer = false,
    diffAnnotations?: PromptDiffAnnotation[]) {
    const session = state.session;
    if (!session || state.connection.type !== "ready") throw new NotSentError("The session is not connected.");
    const streamingBehavior = endpoint === "prompt" ? deliveryOf(attachments, steer) : undefined;
    update({ ...state, sending: true, commandError: undefined });
    try {
      const body = { cwd: session.cwd, ...(text === undefined ? {} : { text }), ...(attachments?.length ? { attachments } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}), ...(diffAnnotations?.length ? { diffAnnotations } : {}) };
      const init = endpoint === "prompt" ? promptDelivery(body) : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      };
      const result = await request<z.infer<typeof acceptedSchema> | z.infer<typeof abortResultSchema>>(`${root}/${endpoint}`,
        endpoint === "prompt" ? acceptedSchema : abortResultSchema, init, lifetime.signal, timing.requestTimeoutMs ?? 20_000, endpoint === "prompt");
      if (endpoint === "abort") void refreshStatus();
      return "restoredMessages" in result ? result.restoredMessages : [];
    } catch (error) {
      if (endpoint === "abort") fail("Stop failed", messageOf(error));
      else fail("Message may not have sent", messageOf(error), refused(error)
        ? `${messageOf(error)} Pi did not take the message. It is back in the message box.`
        : `${messageOf(error)} It may have reached Pi. Check the conversation before you send it again; the text is back in the message box.`);
      throw error;
    } finally { update({ ...state, sending: false }); }
  }
  /** Reads for the model picker. They need a joined session but change nothing. */
  async function readForPicker<T>(endpoint: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    const session = state.session;
    if (!session) throw new Error("The session is not connected.");
    return request(readPath(endpoint, session), schema, {}, signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal]));
  }
  /**
   * Change the model or thinking level. Pi answers with its status, which the
   * picker shows; nothing changes in the browser before that. Never retried:
   * a lost acknowledgement does not prove the change did not apply.
   */
  async function changeRuntime(endpoint: "model" | "thinking-level", body: Record<string, string>) {
    const session = state.session;
    if (!session || state.connection.type !== "ready") throw new Error("The session is not connected.");
    const version = statusVersion;
    try {
      const status = await request(`${root}/${endpoint}`, statusSchema, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: session.cwd, ...body }),
      });
      if (version === statusVersion) { statusVersion++; update(withStatus(state, status)); }
    } catch (error) {
      if (refused(error)) throw error;
      throw new Error(`${messageOf(error)} The ${endpoint === "model" ? "model" : "thinking level"} may have changed. Check it before you try again.`, { cause: error });
    }
  }
  /**
   * One tree action at a time, against the tree the navigator showed. Never
   * retried: a lost acknowledgement does not prove the session did not move.
   */
  async function treeAction<T>(operation: "continuing" | "forking", summarizing: boolean, path: string, schema: z.ZodType<T>,
    body: Record<string, unknown>, settle: (result: T) => { outcome: TreeOutcome; notice?: { tone: "status" | "error"; message: string } }): Promise<TreeOutcome> {
    const session = state.session;
    const navigator = state.tree;
    if (!session || navigator.type !== "open" || navigator.operation.type !== "idle") return { type: "unchanged" };
    update({ ...state, tree: withTreeOperation(navigator, operation === "forking" ? { type: "forking" } : { type: "continuing", summarizing, aborting: false }) });
    try {
      const result = await request(`${root}/${path}`, schema, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, expectedLeafId: navigator.tree.activeLeafId, ...body }),
      }, lifetime.signal, timing.treeActionTimeoutMs ?? 5 * 60_000);
      const { outcome, notice } = settle(result);
      if (outcome.type === "unchanged") {
        update({ ...state, tree: withTreeOperation(state.tree, { type: "idle", ...(notice ? { notice } : {}) }) });
        return outcome;
      }
      update({ ...state, tree: closedTree });
      if (outcome.type === "continued") reload();
      return outcome;
    } catch (error) {
      // A 4xx reply carries Pi's reason. Anything else, including a proxy's 5xx, can hide a move
      // that happened, so say so. The server reports some failures after the move as 400 too, so
      // every failure re-reads the history. That is a read, not a retry.
      const refused = error instanceof ReadFailure && error.status < 500;
      const message = refused ? error.message
        : `${messageOf(error)} The session may have changed. Close and reopen the tree to check before you try again.`;
      update({ ...state, tree: withTreeOperation(state.tree, { type: "idle", notice: { tone: "error", message } }) });
      reload();
      return { type: "unchanged" };
    }
  }
  async function abortTree() {
    const session = state.session;
    const navigator = state.tree;
    if (!session || navigator.type !== "open") return;
    const operation = navigator.operation;
    if (operation.type !== "continuing" || !operation.summarizing || operation.aborting) return;
    update({ ...state, tree: withTreeOperation(navigator, { ...operation, aborting: true }) });
    try {
      await request(`${root}/abort`, abortResultSchema, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: session.cwd }),
      });
    } catch (error) {
      const current = state.tree;
      if (current.type === "open" && current.operation.type === "continuing") update({ ...state,
        tree: withTreeOperation(current, { ...current.operation, aborting: false,
          notice: { tone: "error", message: `Could not stop the summary: ${messageOf(error)}` } }) });
    }
  }
  /**
   * Answer or cancel an extension dialog. The daemon answers with status, which
   * drops the dialog; `stale` means another window or a timeout closed it
   * first. Never retried: a lost acknowledgement can mean the extension
   * already has the answer.
   */
  async function closeDialog(dialogId: string, action: "answer" | "cancel", value?: boolean | string) {
    const session = state.session;
    if (!session || state.connection.type !== "ready") return;
    // One answer per dialog at a time. The next dialog can be answered at once:
    // the daemon shows it before it replies about the last one.
    if (dialogsInFlight.has(dialogId)) return;
    dialogsInFlight.add(dialogId);
    const version = statusVersion;
    update({ ...state, dialogPhase: { dialogId, type: "sending" } });
    try {
      const response = await request(`${root}/dialogs/${action}`, dialogCloseResponseSchema, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, dialogId, ...(action === "answer" ? { value } : {}) }),
      });
      let next: SessionState = { ...state, dialogPhase: state.dialogPhase.dialogId === dialogId ? noDialogPhase : state.dialogPhase };
      if (version === statusVersion) { statusVersion++; next = withStatus(next, response.sessionStatus); }
      update(next);
    } catch (error) {
      const message = refused(error) ? error.message
        : `${messageOf(error)} The answer may have reached the extension. Check before you answer again.`;
      update({ ...state, dialogPhase: { dialogId, type: "failed", message } });
    } finally { dialogsInFlight.delete(dialogId); }
  }
  const dialogsInFlight = new Set<string>();
  async function clearQueue() {
    const session = state.session;
    if (!session || state.connection.type !== "ready") throw new Error("The session is not connected.");
    if (state.sending) throw new Error("Wait for the current command to finish.");
    const version = statusVersion;
    const wasQueued = state.compaction.type === "queued";
    update({ ...state, sending: true, commandError: undefined });
    try {
      const status = await request(`${root}/queue/clear`, statusSchema, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd: session.cwd }),
      });
      let next = state;
      if (version === statusVersion) { statusVersion++; next = withStatus(state, status); }
      if (wasQueued && next.compaction.type === "finished" && next.compaction.outcome === "unknown") next = {
        ...next, compaction: { type: "finished", outcome: "cancelled", message: "Queued compaction cancelled." },
      };
      update(next);
    } catch (error) {
      fail("Queue not cleared", messageOf(error));
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
    /**
     * `diffAnnotations` go only with a chat message. A slash or `!` command
     * ignores them; see `carriesNotes`. With notes, the text may be empty.
     */
    send: async (text: string, attachments?: PromptAttachment[], options: { steer?: boolean; diffAnnotations?: PromptDiffAnnotation[] | undefined } = {}) => {
      const shell = shellDraftOf(text);
      if (shell.type !== "chat") {
        if (attachments?.length) throw new NotSentError("Remove attachments before running a shell command.");
        if (shell.type === "empty") throw new NotSentError("Type a command after !.");
        return runShell(shell.text);
      }
      if (isCommand(text)) {
        if (attachments?.length) throw new NotSentError("Remove attachments before running a slash command.");
        return runSlash("commands/run", { text });
      }
      await command("prompt", text, attachments, options.steer === true, options.diffAnnotations);
    },
    respondToCommand: (requestId: string, value: string) => runSlash("commands/respond", { requestId, value }),
    dismissCommand: () => update({ ...state, commandResult: undefined }),
    dismissProblem: (problemId: number) => update({ ...state, problems: state.problems.filter((problem) => problem.id !== problemId) }),
    dismissProblems: () => update({ ...state, problems: [] }),
    /** Skip the wait before the next try. Only while reconnecting. */
    retryNow: () => { if (state.connection.type === "reconnecting") recover("Trying again now."); },
    openTree: () => runSlash("commands/run", { text: "/tree" }),
    /**
     * Reads the tree without the `/tree` command, so a read-only session can
     * show its history too. Nothing on the server changes.
     */
    viewTree: async () => {
      const session = state.session;
      if (!session || state.connection.type !== "ready") throw new NotSentError("The session is not connected.");
      try {
        const { tree } = await request(readPath("tree", session), sessionTreeResponseSchema);
        update({ ...state, tree: openTree(tree) });
      } catch (error) {
        fail("Could not read the session tree", messageOf(error));
        throw error;
      }
    },
    continueTree: (targetId: string, summary: SessionTreeSummaryChoice) => treeAction("continuing", summary.mode !== "none",
      "tree/navigate", treeNavigateResultSchema, { targetId, summary }, afterNavigate),
    forkTree: (entryId: string) => treeAction("forking", false, "tree/fork", treeForkResultSchema, { entryId }, afterFork),
    abortTree,
    /** Closing is refused while an action runs: its result must reach the user. */
    closeTree: () => { if (state.tree.type === "open" && state.tree.operation.type === "idle") update({ ...state, tree: closedTree }); },
    loadCommands,
    clearQueue,
    answerDialog: (dialogId: string, value: boolean | string) => closeDialog(dialogId, "answer", value),
    cancelDialog: (dialogId: string) => closeDialog(dialogId, "cancel"),
    listModels: async (signal?: AbortSignal) => (await readForPicker("models", modelsResponseSchema, signal)).models,
    listThinkingLevels: async (signal?: AbortSignal) => (await readForPicker("thinking-levels", thinkingLevelsResponseSchema, signal)).levels,
    setModel: (provider: string, modelId: string) => changeRuntime("model", { provider, modelId }),
    setThinkingLevel: (level: string) => changeRuntime("thinking-level", { level }),
    dismissCompaction: () => { if (state.compaction.type === "finished") update({ ...state, compaction: idleCompaction }); },
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
    dispose: () => { lifetime.abort(); clearTimeout(retryTimer); closeJoin(); unwatch?.(); unwatchUnread?.(); listeners.clear(); },
  };
}
export type SessionStore = ReturnType<typeof createSessionStore>;
