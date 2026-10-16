import type { WebSocket } from "ws";
import { connectionPingSchema, connectionPongSchema } from "../../shared/connectionHealth.js";

/** Answer on the daemon socket, so a probe checks the whole proxy chain. */
export function respondToConnectionChecks(socket: WebSocket): void {
  socket.on("message", (data) => {
    const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data;
    if (bytes.byteLength > 256) return;
    const text = bytes.toString("utf8");
    let value: unknown;
    try { value = JSON.parse(text); } catch { return; }
    const ping = connectionPingSchema.safeParse(value);
    if (ping.success && socket.readyState === socket.OPEN) socket.send(JSON.stringify(connectionPongSchema.parse({ type: "connection.pong", id: ping.data.id })));
  });
}
