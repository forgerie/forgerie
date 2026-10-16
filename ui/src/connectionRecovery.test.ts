import { createServer } from "node:http";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { respondToConnectionChecks } from "../../src/server/realtime/connectionHealth";
import { checkConnection, watchConnectionRecovery } from "./connectionRecovery";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function connection(answer = true) {
  let serverSocket!: ServerSocket;
  const http = createServer();
  const ws = new WebSocketServer({ server: http });
  ws.on("connection", socket => { serverSocket = socket; if (answer) respondToConnectionChecks(socket); });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
  socket.binaryType = "arraybuffer";
  cleanup.push(async () => {
    socket.close(); for (const client of ws.clients) client.terminate(); ws.close();
    await new Promise<void>(resolve => http.close(() => resolve()));
  });
  await new Promise<void>(resolve => socket.addEventListener("open", () => resolve(), { once: true }));
  return { socket, serverSocket };
}

function recovery(socket: WebSocket) {
  let wake: () => void = () => undefined;
  let current: WebSocket | undefined = socket;
  let checks = 0, recoveries = 0;
  let pending: Promise<boolean> = Promise.resolve(true);
  const dispose = watchConnectionRecovery({
    checkConnection: socket => { checks++; pending = checkConnection(socket, 25); return pending; },
    watchRecovery: recover => { wake = recover; return () => { wake = () => undefined; }; },
  }, () => current, () => { recoveries++; });
  cleanup.push(() => dispose?.());
  return { wake: () => wake(), dispose: () => dispose?.(), replace: (socket?: WebSocket) => { current = socket; },
    settle: async () => { await pending; await Promise.resolve(); }, checks: () => checks, recoveries: () => recoveries };
}

describe("socket liveness after a browser wake", () => {
  it("checks the existing socket without reconnecting when the daemon answers", async () => {
    const api = await connection();
    const watch = recovery(api.socket);
    watch.wake(); await watch.settle();
    expect(watch.checks()).toBe(1);
    expect(watch.recoveries()).toBe(0);
    expect(api.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("accepts a binary reply forwarded through the proxy, ignoring other events and probe IDs", async () => {
    const api = await connection(false);
    api.serverSocket.on("message", data => {
      const ping = JSON.parse(data.toString()) as { id: string };
      api.serverSocket.send('{"type":"connection.pong","id":"other"}');
      api.serverSocket.send('{"type":"connection.pong","id":42}');
      api.serverSocket.send('{"type":"status.update"}');
      api.serverSocket.send(Buffer.from(JSON.stringify({ type: "connection.pong", id: ping.id })));
    });
    expect(await checkConnection(api.socket, 100)).toBe(true);
  });

  it("recovers a half-open socket that never answers even though readyState remains open", async () => {
    const api = await connection(false);
    const watch = recovery(api.socket);
    watch.wake(); await watch.settle();
    expect(api.socket.readyState).toBe(WebSocket.OPEN);
    expect(watch.recoveries()).toBe(1);
  });

  it("coalesces visibility, online and pageshow events during one check", async () => {
    const api = await connection(false);
    const watch = recovery(api.socket);
    watch.wake(); watch.wake(); watch.wake();
    await watch.settle();
    expect(watch.checks()).toBe(1);
    expect(watch.recoveries()).toBe(1);
  });

  it("does not let a stale probe replace a newer join", async () => {
    const api = await connection(false);
    const next = await connection();
    const watch = recovery(api.socket);
    watch.wake(); watch.replace(next.socket);
    await watch.settle();
    expect(watch.recoveries()).toBe(0);
  });

  it("does not recover after the store is disposed", async () => {
    const api = await connection(false);
    const watch = recovery(api.socket);
    watch.wake(); watch.dispose();
    await watch.settle(); watch.wake();
    expect(watch.checks()).toBe(1);
    expect(watch.recoveries()).toBe(0);
  });

  it("fails a check immediately when the connection closes", async () => {
    const api = await connection(false);
    const checked = checkConnection(api.socket, 1000);
    api.serverSocket.close();
    expect(await checked).toBe(false);
  });
});
