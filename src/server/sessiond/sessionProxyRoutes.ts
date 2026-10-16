import type { FastifyInstance, FastifyReply } from "fastify";
import { WebSocket, type RawData } from "ws";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { RESOURCE_EDITOR_BODY_LIMIT } from "../../shared/resourceEditor.js";

export interface SessionProxyDaemon {
  request(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
  connectWebSocket(path: string): WebSocket;
}

export function registerSessionProxyRoutes(app: FastifyInstance, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api"): void {
  const proxy = async (request: { method: string; url: string; body?: unknown }, reply: FastifyReply) => {
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableFinished) controller.abort(); };
    reply.raw.once("close", disconnected);
    try {
      const upstream = await daemon.request(request.method, stripPrefix(request.url, prefix), request.body, controller.signal);
      reply.code(upstream.statusCode);
      const contentType = upstream.headers["content-type"];
      if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
      const retryAfter = upstream.headers["retry-after"];
      if (retryAfter !== undefined && retryAfter !== "") reply.header("retry-after", retryAfter);
      if (upstream.body === "") return undefined;
      const value: unknown = JSON.parse(upstream.body);
      return value;
    } catch (error) {
      if (!controller.signal.aborted) requestFailed(reply, error);
      return undefined;
    } finally { reply.raw.off("close", disconnected); }
  };

  app.get(`${prefix}/sessiond/health`, (_request, reply) => proxy({ method: "GET", url: `${prefix}/health` }, reply));
  app.get(`${prefix}/sessiond/runtime`, (_request, reply) => proxy({ method: "GET", url: `${prefix}/runtime` }, reply));

  app.get<{ Params: { sessionId: string } }>(`${prefix}/sessions/:sessionId/events`, { websocket: true }, (socket, request) => {
    bridgeSockets(socket, daemon.connectWebSocket(stripPrefix(request.url, prefix)));
  });

  app.get(`${prefix}/sessions/events`, { websocket: true }, (socket) => {
    bridgeSockets(socket, daemon.connectWebSocket("/sessions/events"));
  });

  app.get(`${prefix}/events`, { websocket: true }, (socket) => {
    bridgeSockets(socket, daemon.connectWebSocket("/events"));
  });

  app.all(`${prefix}/activity`, (request, reply) => proxy(request, reply));
  // Models a composer may choose from before any session exists, so this sits
  // beside the session routes rather than under one.
  app.all(`${prefix}/models`, (request, reply) => proxy(request, reply));
  // Prompt authoring targets the agent profile, not a session, so the prompt
  // dialog can save without one open.
  app.all(`${prefix}/prompts`, (request, reply) => proxy(request, reply));
  // The daemon owns resource discovery and writes for its configured profile.
  app.all(`${prefix}/resources`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/resources/*`, { bodyLimit: RESOURCE_EDITOR_BODY_LIMIT }, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions/:sessionId/resources/:resourceId`, { bodyLimit: RESOURCE_EDITOR_BODY_LIMIT }, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/project-groups`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/project-groups/*`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/project-workspaces`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/project-workspaces/*`, (request, reply) => proxy(request, reply));
  app.register((routes, _options, done) => {
    routes.setErrorHandler((error, _request, reply) => {
      const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
      void reply.code(status).send({ error: error instanceof Error ? error.message : String(error) });
    });
    routes.all(`${prefix}/triggers`, (request, reply) => proxy(request, reply));
    routes.all(`${prefix}/triggers/*`, (request, reply) => proxy(request, reply));
    done();
  });
  app.all(`${prefix}/backlog`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/backlog/*`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/github`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/github/*`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions/*`, (request, reply) => proxy(request, reply));
}

function stripPrefix(url: string, prefix: string): string {
  const path = url.split("?", 1)[0] ?? url;
  const query = url.slice(path.length);
  const stripped = path.startsWith(prefix) ? `${path.slice(prefix.length)}${query}` : url;
  return stripped === "" ? "/" : stripped;
}

function requestFailed(reply: FastifyReply, error: unknown): void {
  reply.code(502).send({ error: `Session daemon unavailable: ${error instanceof Error ? error.message : String(error)}` });
}

function bridgeSockets(client: WebSocket, upstream: WebSocket): void {
  // The browser's handshake can finish before the daemon's. Do not lose a
  // liveness probe sent in that gap; bound the pre-handshake queue instead.
  const pending: RawData[] = [];
  let pendingBytes = 0;
  client.on("message", (data) => {
    if (upstream.readyState !== WebSocket.CONNECTING) { sendIfOpen(upstream, data); return; }
    const bytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0) : data.byteLength;
    if (pending.length >= 32 || pendingBytes + bytes > 64 * 1024) {
      client.close(1009, "Daemon handshake buffer exceeded"); upstream.close(); return;
    }
    pending.push(data); pendingBytes += bytes;
  });
  upstream.once("open", () => {
    for (const data of pending) sendIfOpen(upstream, data);
    pending.length = 0; pendingBytes = 0;
  });
  upstream.on("message", (data) => { sendIfOpen(client, data); });
  client.on("close", () => { pending.length = 0; pendingBytes = 0; upstream.close(); });
  upstream.on("close", () => { client.close(); });
  upstream.on("error", () => { client.close(); });
  client.on("error", () => { upstream.close(); });
}

function sendIfOpen(socket: WebSocket, data: RawData): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
}
