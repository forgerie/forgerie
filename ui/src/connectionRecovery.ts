import { connectionPongSchema } from "@shared/connectionHealth";

/** A real round trip distinguishes a healthy socket from a half-open one after sleep. */
export function checkConnection(socket: WebSocket, timeoutMs = 3000): Promise<boolean> {
  if (socket.readyState !== WebSocket.OPEN) return Promise.resolve(false);
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const finish = (healthy: boolean) => {
      clearTimeout(timer);
      socket.removeEventListener("message", message);
      socket.removeEventListener("close", closed);
      socket.removeEventListener("error", closed);
      resolve(healthy);
    };
    const closed = () => finish(false);
    const message = (event: MessageEvent) => {
      const text = typeof event.data === "string" ? event.data
        : event.data instanceof ArrayBuffer && event.data.byteLength <= 256 ? new TextDecoder().decode(event.data) : undefined;
      if (text === undefined || text.length > 256) return;
      let value: unknown;
      try { value = JSON.parse(text); } catch { return; }
      const pong = connectionPongSchema.safeParse(value);
      if (pong.success && pong.data.id === id) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.addEventListener("message", message);
    socket.addEventListener("close", closed);
    socket.addEventListener("error", closed);
    try { socket.send(JSON.stringify({ type: "connection.ping", id })); } catch { finish(false); }
  });
}

interface RecoveryTransport {
  watchRecovery?: (recover: () => void) => () => void;
  checkConnection?: (socket: WebSocket) => Promise<boolean>;
}

/** Keep lifecycle checks outside retained screens, and coalesce repeated wake events. */
export function watchConnectionRecovery(transport: RecoveryTransport, currentSocket: () => WebSocket | undefined, recover: () => void): (() => void) | undefined {
  let stopped = false;
  let checking: WebSocket | undefined;
  const unwatch = transport.watchRecovery?.(() => {
    const socket = currentSocket();
    // A join already in progress must not be cancelled by another browser event.
    if (socket?.readyState === WebSocket.CONNECTING) return;
    if (!transport.checkConnection || !socket || socket.readyState !== WebSocket.OPEN) { recover(); return; }
    if (checking === socket) return;
    checking = socket;
    void transport.checkConnection(socket).catch(() => false).then(healthy => {
      if (!stopped && currentSocket() === socket && !healthy) recover();
    }).finally(() => { if (checking === socket) checking = undefined; });
  });
  return unwatch === undefined ? undefined : () => { stopped = true; unwatch(); };
}
