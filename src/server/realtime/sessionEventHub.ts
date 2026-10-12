import type { GlobalSessionEvent, RealtimeEvent, SessionNotificationSummaryEvent, SessionUiEvent } from "../../shared/apiTypes.js";
import { durableBrowserSnapshotSchema, type DurableBrowserSnapshot } from "../../shared/durableBrowserSnapshot.js";
import { projectBrowserSessionEvent } from "../browserMessageProjection.js";

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
  readonly bufferedAmount?: number;
  send(payload: string, callback?: (error?: Error | null) => void): void;
  terminate(): void;
  on(event: "close", listener: () => void): unknown;
}

/** Provisional limit: large active contexts need measurement before broad native cutover. */
const DURABLE_SOCKET_MAX_BYTES = 8 * 1024 * 1024;
const DURABLE_SOCKET_SEND_TIMEOUT_MS = 10_000;

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
  private readonly globalSockets = new Set<RealtimeSocket>();
  private readonly seqBySession = new Map<string, number>();

  add(sessionId: string, socket: RealtimeSocket): void {
    let sockets = this.socketsBySession.get(sessionId);
    if (!sockets) {
      sockets = new Set();
      this.socketsBySession.set(sessionId, sockets);
    }
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  }

  addGlobal(socket: RealtimeSocket): void {
    this.globalSockets.add(socket);
    socket.on("close", () => this.globalSockets.delete(socket));
  }

  /** Called only by a serialized Durable watch. No host queue hides slow network delivery. */
  async sendDurableSnapshot(socket: RealtimeSocket, snapshot: DurableBrowserSnapshot, limits?: { maxBytes?: number; timeoutMs?: number }): Promise<void> {
    const payload = JSON.stringify(durableBrowserSnapshotSchema.parse(snapshot));
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
    const seq = (this.seqBySession.get(sessionId) ?? 0) + 1;
    this.seqBySession.set(sessionId, seq);
    const payload = JSON.stringify({ ...projectBrowserSessionEvent(event), seq });
    this.sendToSockets(this.socketsBySession.get(sessionId), payload);
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

  private sendToSockets(sockets: Set<RealtimeSocket> | undefined, payload: string): void {
    if (sockets === undefined) return;
    for (const socket of sockets) {
      if (socket.readyState !== socket.OPEN) continue;
      try {
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
