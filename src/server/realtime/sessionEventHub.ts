import { DurableRunBoundaries } from "../sessions/durableRunBoundaries.js";
import { DurableHistoryGenerations } from "../sessions/durableHistoryGenerations.js";
import { randomUUID } from "node:crypto";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import type { SessionOpenResult } from "../sessions/sessionOpen.js";
import type { ConversationId, Harness, SubmissionId } from "@earendil-works/pi-durable";
import type { SessionOpenTransientEvent } from "../../shared/sessionOpen.js";
import type { GlobalSessionEvent, RealtimeEvent, SessionNotificationSummaryEvent, SessionUiEvent } from "../../shared/apiTypes.js";
import { durableBrowserSnapshotSchema, type DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import { projectBrowserSessionEvent } from "../browserMessageProjection.js";
import { SESSION_FRAME_BYTES, SESSION_SOCKET_MAX_BYTES, SESSION_SOCKET_SEND_TIMEOUT_MS, sessionWireChunks } from "../../shared/sessionWire.js";

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
  readonly bufferedAmount?: number;
  send(payload: string, callback?: (error?: Error | null) => void): void;
  terminate(): void;
  on(event: "close", listener: () => void): unknown;
}

/** Bound queued wire bytes, independently of the size of a complete native cut. */
const DURABLE_SOCKET_MAX_BYTES = SESSION_SOCKET_MAX_BYTES;
const DURABLE_SOCKET_SEND_TIMEOUT_MS = SESSION_SOCKET_SEND_TIMEOUT_MS;

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
  private readonly nativeSockets = new WeakSet<RealtimeSocket>();
  private readonly chunkedSockets = new WeakSet<RealtimeSocket>();
  private readonly globalSockets = new Set<RealtimeSocket>();
  private readonly seqBySession = new Map<string, number>();
  readonly epoch = randomUUID();
  private readonly nativeHistories = new DurableHistoryGenerations();
  private readonly nativeRuns = new DurableRunBoundaries(sessionId => {
    const seq = this.currentSeq(sessionId) + 1; this.seqBySession.set(sessionId, seq); return seq;
  });

  observeNativeRuns(sessionId: string, harness: Harness, conversationId: ConversationId): void {
    this.nativeRuns.observe(sessionId, harness, conversationId);
  }
  nativeRunStartSeq(sessionId: string, harness: Harness, conversationId: ConversationId, firstInput: SubmissionId | undefined): number {
    return this.nativeRuns.checkpoint(sessionId, harness, conversationId, firstInput);
  }

  nativeHistoryId(journalId: string, harness: Harness, conversationId: ConversationId): string {
    return this.nativeHistories.identify(journalId, harness, conversationId);
  }
  private readonly hostBySession = new Map<string, { shells: { events: SessionOpenTransientEvent[]; after?: string | undefined }[]; consumed: Set<string>; command?: Extract<SessionOpenTransientEvent, { type: "command.output" }> }>();
  private readonly nativeRefresh = new Map<string, Set<() => void>>();

  /** Scalar ownership counts only; identities and transcript data never leave the hub. */
  diagnostics() {
    return {
      socketSessions: this.socketsBySession.size,
      sessionSockets: [...this.socketsBySession.values()].reduce((count, sockets) => count + sockets.size, 0),
      globalSockets: this.globalSockets.size,
      hostObservers: [...this.nativeRefresh.values()].reduce((count, listeners) => count + listeners.size, 0),
      sequenceSessions: this.seqBySession.size,
      hostStateSessions: this.hostBySession.size,
    };
  }

  /** Host-only state has no Durable commit. Reacquire a native cut instead of forwarding SDK status. */
  observeHostState(sessionId: string, changed: () => void): () => void {
    const listeners = this.nativeRefresh.get(sessionId) ?? new Set<() => void>();
    this.nativeRefresh.set(sessionId, listeners); listeners.add(changed);
    return () => { listeners.delete(changed); if (listeners.size === 0) this.nativeRefresh.delete(sessionId); };
  }

  /** Optional metadata needs a newer transport cut, not a Durable write or history invalidation. */
  noteDecisionHintChange(sessionId: string): void {
    this.seqBySession.set(sessionId, this.currentSeq(sessionId) + 1);
  }

  private readonly shellAnchor = new Map<string, string | undefined>();

  prepareHostShell(sessionId: string, after: string | undefined): void { this.shellAnchor.set(sessionId, after); }
  private readonly adopted = new WeakMap<Harness, Map<string, { count: number; stop: () => void }>>();

  /** One checkpoint per adopted native commit, independent of SDK callbacks and watch revisions. */
  observeNative(sessionId: string, harness: Harness, conversationId: number): () => void {
    let sessions = this.adopted.get(harness);
    if (!sessions) { sessions = new Map(); this.adopted.set(harness, sessions); }
    const key = `${sessionId}:${String(conversationId)}`;
    let observation = sessions.get(key);
    if (!observation) {
      observation = { count: 0, stop: harness.subscribeCommits((publication) => {
        if (publication.changes.some(change => (change.type === "document" || change.type === "document.copy")
          ? change.conversationId === conversationId || change.conversationId === undefined
          : change.type === "conversation" ? change.value.id === conversationId : change.value.conversationId === conversationId)) {
          this.seqBySession.set(sessionId, this.currentSeq(sessionId) + 1);
        }
      }) };
      sessions.set(key, observation);
    }
    observation.count++;
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--observation.count === 0) { observation.stop(); sessions.delete(key); }
    };
  }

  transientEvents(sessionId: string): SessionOpenTransientEvent[] {
    const host = this.hostBySession.get(sessionId);
    return host === undefined ? [] : structuredClone([...host.shells.flatMap(row => row.events), ...(host.command === undefined ? [] : [host.command])]);
  }

  /** Consume only records after the command's saved-history anchor, including repeated identical commands. */
  savedHostOutput(sessionId: string, messages: readonly { id?: string | undefined; role: string; command?: string | undefined; output?: string | undefined; exitCode?: number | null | undefined; cancelled?: boolean | undefined }[]): void {
    const host = this.hostBySession.get(sessionId);
    if (host === undefined) return;
    const consumed = new Set<number>();
    host.shells = host.shells.filter(row => {
      const start = row.events[0], end = row.events.at(-1);
      if (start?.type !== "shell.start" || end?.type !== "shell.end" || end.isError === true) return true;
      const anchor = row.after === undefined ? -1 : messages.findIndex(message => message.id === row.after);
      const index = messages.findIndex((message, index) => index > anchor && !consumed.has(index) && !host.consumed.has(message.id ?? String(index)) && message.role === "bashExecution"
        && message.command === start.command && message.output === end.output && (message.exitCode ?? undefined) === (end.exitCode ?? undefined)
        && (message.cancelled === true) === (end.cancelled === true));
      if (index < 0) return true;
      consumed.add(index); host.consumed.add(messages[index]?.id ?? String(index)); return false;
    });
  }

  private rememberHostOutput(sessionId: string, event: SessionUiEvent): void {
    if (!event.type.startsWith("shell.") && event.type !== "command.output") return;
    let host = this.hostBySession.get(sessionId);
    if (host === undefined) { host = { shells: [], consumed: new Set() }; this.hostBySession.set(sessionId, host); }
    if (event.type === "shell.start") {
      host.shells.push({ events: [event], after: this.shellAnchor.get(sessionId) }); this.shellAnchor.delete(sessionId);
    } else if (event.type === "shell.chunk") {
      const row = host.shells.at(-1);
      if (row === undefined) return;
      const previous = row.events.find(item => item.type === "shell.chunk");
      // Same live tail as shellRun.LIVE_OUTPUT_LIMIT; final output retains the producer's disclosure.
      const chunk = ((previous?.type === "shell.chunk" ? previous.chunk : "") + event.chunk).slice(-DEFAULT_MAX_BYTES);
      row.events = [row.events[0] ?? { type: "shell.start", command: "" }, { type: "shell.chunk", chunk }];
    } else if (event.type === "shell.end") host.shells.at(-1)?.events.push(event);
    else if (event.type === "command.output") host.command = event;
  }

  add(sessionId: string, socket: RealtimeSocket): void {
    let sockets = this.socketsBySession.get(sessionId);
    if (!sockets) {
      sockets = new Set();
      this.socketsBySession.set(sessionId, sockets);
    }
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      this.releaseEmptySessionSockets(sessionId, sockets);
    });
  }

  /** Drop only this empty browser-socket bucket. Sequence and history identities stay for reattachment. */
  private releaseEmptySessionSockets(sessionId: string, sockets: Set<RealtimeSocket>): void {
    // A late close from an earlier connection must not remove a replacement bucket.
    if (sockets.size === 0 && this.socketsBySession.get(sessionId) === sockets) this.socketsBySession.delete(sessionId);
  }

  addDurable(sessionId: string, socket: RealtimeSocket): void {
    this.markDurable(socket);
    this.add(sessionId, socket);
  }

  markDurable(socket: RealtimeSocket, chunks = false): void {
    this.nativeSockets.add(socket);
    if (chunks) this.chunkedSockets.add(socket);
  }

  addGlobal(socket: RealtimeSocket): void {
    this.globalSockets.add(socket);
    socket.on("close", () => this.globalSockets.delete(socket));
  }

  /** Called only by a serialized Durable watch. No host queue hides slow network delivery. */
  async sendDurableSnapshot(socket: RealtimeSocket, snapshot: DurableBrowserSnapshot, limits?: { maxBytes?: number; timeoutMs?: number }): Promise<void> {
    return this.sendCut(socket, JSON.stringify(durableBrowserSnapshotSchema.parse(snapshot)), limits);
  }

  sendOpenSnapshot(socket: RealtimeSocket, open: SessionOpenResult): Promise<void> {
    return this.sendCut(socket, JSON.stringify({ type: "session.open", open }));
  }

  private async sendCut(socket: RealtimeSocket, payload: string, limits?: { maxBytes?: number; timeoutMs?: number }): Promise<void> {
    if (!this.chunkedSockets.has(socket) || Buffer.byteLength(payload) <= SESSION_FRAME_BYTES) return this.sendBounded(socket, payload, limits);
    // The native publisher awaits this whole send and keeps only its latest pending cut.
    // Await each frame's completion rather than queueing the entire large turn.
    for (const chunk of sessionWireChunks(payload, randomUUID())) await this.sendBounded(socket, chunk, limits);
  }

  private async sendBounded(socket: RealtimeSocket, payload: string, limits?: { maxBytes?: number; timeoutMs?: number }): Promise<void> {
    const bytes = Buffer.byteLength(payload);
    const maxBytes = limits?.maxBytes ?? DURABLE_SOCKET_MAX_BYTES;
    if (socket.readyState !== socket.OPEN || socket.bufferedAmount === undefined || socket.bufferedAmount + bytes > maxBytes) {
      socket.terminate();
      throw new Error("Durable browser transport is closed, unbounded, or exceeds its byte limit");
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error !== undefined && error !== null) { socket.terminate(); reject(error); }
        else if ((socket.bufferedAmount ?? maxBytes + 1) > maxBytes) { socket.terminate(); reject(new Error("Durable browser transport exceeded its byte limit")); }
        else resolve();
      };
      const timer = setTimeout(() => { finish(new Error("Durable browser transport stalled; reattach to resync")); }, limits?.timeoutMs ?? DURABLE_SOCKET_SEND_TIMEOUT_MS);
      timer.unref();
      try { socket.send(payload, finish); }
      catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  publish(sessionId: string, event: SessionUiEvent): void {
    this.rememberHostOutput(sessionId, event);
    const seq = (this.seqBySession.get(sessionId) ?? 0) + 1;
    this.seqBySession.set(sessionId, seq);
    if (event.type === "status.update") for (const changed of this.nativeRefresh.get(sessionId) ?? []) changed();
    const payload = JSON.stringify({ ...projectBrowserSessionEvent(event), seq });
    const sockets = this.socketsBySession.get(sessionId);
    this.sendToSockets(sockets, payload, event.type.startsWith("shell.") || event.type === "command.output" || event.type.startsWith("dialog.") || event.type === "session.error" || event.type === "pi.event" || event.type === "processes.update" || event.type === "processes.output");
    if (sockets !== undefined) this.releaseEmptySessionSockets(sessionId, sockets);
  }

  /**
   * Last per-session sequence number stamped by {@link publish} (0 before any
   * event). Callers building a join-time stream snapshot read this as the
   * watermark: buffered live events with `seq <= currentSeq` are already
   * reflected in the snapshot's partial and must be dropped by the client.
   */
  currentSeq(sessionId: string): number {
    return this.seqBySession.get(sessionId) ?? 0;
  }

  publishGlobal(event: GlobalSessionEvent): void {
    this.publishRealtime(event);
  }

  publishNotificationSummary(event: SessionNotificationSummaryEvent): void {
    const payload = JSON.stringify(event);
    this.sendToSockets(this.globalSockets, payload);
  }

  publishRealtime(event: RealtimeEvent): void {
    const payload = JSON.stringify(event);
    this.sendToSockets(this.globalSockets, payload);
  }

  private sendToSockets(sockets: Set<RealtimeSocket> | undefined, payload: string, nativeAllowed = true): void {
    if (sockets === undefined) return;
    for (const socket of sockets) {
      if (socket.readyState !== socket.OPEN || this.nativeSockets.has(socket) && !nativeAllowed) continue;
      try {
        // Ephemeral shell/dialog events share the same bounded socket, but never become
        // a second transcript authority. Their producer does not have a Durable watch.
        if (this.nativeSockets.has(socket) && ((socket.bufferedAmount ?? DURABLE_SOCKET_MAX_BYTES) + Buffer.byteLength(payload) > DURABLE_SOCKET_MAX_BYTES)) {
          socket.terminate(); sockets.delete(socket); continue;
        }
        socket.send(payload);
      } catch {
        sockets.delete(socket);
        try {
          socket.terminate();
        } catch {
          // Removal is authoritative; cleanup failure must not block healthy sockets.
        }
      }
    }
  }
}
