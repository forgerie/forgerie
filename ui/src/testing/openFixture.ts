import { historySchema, sessionOpenSchema, snapshotSchema, statusSchema, type SessionOpen } from "../contracts";

/** Fixture data only. Production consistency is tested through the server acquisition contract. */
export function openFixture(options: { session?: SessionOpen["session"]; page?: unknown; snapshot?: unknown; status?: unknown;
  epoch?: string; historyId?: string; receipt?: SessionOpen["receipt"]; readPath?: "classic" | "native";
  tools?: SessionOpen["snapshot"]["tools"]; transientEvents?: SessionOpen["snapshot"]["transientEvents"] } = {}): SessionOpen {
  const page = historySchema.parse(options.page ?? { messages: [], start: 0, total: 0 });
  const snapshot = snapshotSchema.parse(options.snapshot ?? { seq: 0, partial: null });
  return sessionOpenSchema.parse({ session: options.session ?? { id: "known", cwd: "/workspace" }, readPath: options.readPath ?? "classic",
    epoch: options.epoch ?? "test-daemon", historyId: options.historyId ?? "test-history", seq: snapshot.seq, page,
    snapshot: { ...snapshot, tools: options.tools ?? [], transientEvents: options.transientEvents ?? [] },
    status: statusSchema.parse(options.status ?? { isStreaming: false, isCompacting: false, isBashRunning: false }), receipt: options.receipt ?? null });
}

/** Adapt existing in-memory route fixtures. No fetch, socket, or production reader is replaced. */
export function withOpenFixture(respond: (path: string, init: RequestInit) => Promise<Response>): (path: string, init: RequestInit) => Promise<Response> {
  return async (path, init) => {
    const url = new URL(path, "http://fixture");
    if (!url.pathname.endsWith("/open")) return respond(path, init);
    const session = { id: decodeURIComponent(url.pathname.split("/").at(-2) ?? "known"), cwd: url.searchParams.get("cwd") ?? "/workspace" };
    const source = (endpoint: string) => respond(path.replace("/open?", `/${endpoint}?`), init);
    const history = await source("messages"); if (!history.ok) return history;
    const snapshot = await source("stream-snapshot"); if (!snapshot.ok) return snapshot;
    const status = await source("status"); if (!status.ok) return status;
    return Response.json(openFixture({ session, page: await history.json(), snapshot: await snapshot.json(), status: await status.json() }));
  };
}

import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import type { SessionTransport } from "../sessionStore";

/** Real transport with configurable fixture data, delays and errors. */
export async function createOpenServer(respond: (url: URL) => unknown | Promise<unknown>) {
  const requests: URL[] = [];
  const sockets = new WebSocketServer({ noServer: true });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture"); requests.push(url);
    try {
      const result = await respond(url);
      if (result instanceof Response) { response.writeHead(result.status, { "content-type": "application/json" }); response.end(await result.text()); }
      else { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(result)); }
    } catch (error) { response.writeHead(503, { "content-type": "application/json" }); response.end(JSON.stringify({ error: String(error) })); }
  });
  server.on("upgrade", (request, socket, head) => sockets.handleUpgrade(request, socket, head, client => { sockets.emit("connection", client, request); }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port");
  const origin = `http://127.0.0.1:${String(address.port)}`;
  const transport: SessionTransport = { request: (path, init) => fetch(origin + path, init), connect: path => new WebSocket(origin.replace("http:", "ws:") + path) };
  return { origin, transport, requests, sockets, emit: (value: unknown) => { for (const socket of sockets.clients) socket.send(JSON.stringify(value)); },
    close: async () => { for (const socket of sockets.clients) socket.terminate(); sockets.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
