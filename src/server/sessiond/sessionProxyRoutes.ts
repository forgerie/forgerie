import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { WebSocket, type RawData } from "ws";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { RESOURCE_EDITOR_BODY_LIMIT } from "../../shared/resourceEditor.js";
import { SESSION_SOCKET_MAX_BYTES, SESSION_SOCKET_SEND_TIMEOUT_MS } from "../../shared/sessionWire.js";
import { SESSION_IMAGE_MIME_TYPES } from "../sessions/sessionImages.js";
import { createStackLatencyContext, type StackLatencyRecording } from "../realtime/stackLatency.js";
import { STACK_LATENCY_SERVER_TIMING, STACK_LATENCY_TRACE_HEADER, stackLatencyTraceId, type StackLatencySink, type StackLatencySpan } from "../../shared/stackLatency.js";

export interface SessionProxyRequestOptions { traceId?: string }

export interface SessionProxyDaemon {
  request(method: string, path: string, body?: unknown, signal?: AbortSignal, options?: SessionProxyRequestOptions): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
  connectWebSocket(path: string): WebSocket;
}

/** Measurement is opt-in. Without both fields the proxy forwards no trace and records nothing. */
export interface SessionProxyRouteOptions { measurement?: boolean; sink?: StackLatencySink }

interface ProxyTrace { recording: StackLatencyRecording; finishSerialize?: (outcome?: StackLatencySpan["outcome"]) => void }

export function registerSessionProxyRoutes(app: FastifyInstance, daemon: SessionProxyDaemon = new SessionDaemonClient(), prefix = "/api", options: SessionProxyRouteOptions = {}): void {
  const sink = options.measurement === true ? options.sink : undefined;
  const traces = new WeakMap<object, ProxyTrace>();
  if (sink !== undefined) {
    // Fastify serializes (and the edge compresses) between these hooks, so the
    // span is a serialization interval, not pure JSON.stringify CPU time.
    // The hooks complete synchronously on purpose. An async preSerialization or
    // onSend hook defers every reply.send() on this app, so a handler that sends
    // and then resolves undefined (as the proxy's error path does) would make
    // Fastify send a second time and write headers twice.
    app.addHook("preSerialization", (request, _reply, payload, done) => {
      const trace = traces.get(request);
      if (trace !== undefined) trace.finishSerialize = trace.recording.start("serialize");
      done(null, payload);
    });
    app.addHook("onSend", (request, _reply, payload, done) => {
      traces.get(request)?.finishSerialize?.();
      done(null, payload);
    });
    app.addHook("onResponse", (request, _reply, done) => {
      traces.get(request)?.recording.dispose();
      traces.delete(request);
      done();
    });
  }
  const traceFor = (reply: FastifyReply, path: string): ProxyTrace | undefined => {
    if (sink === undefined) return undefined;
    const traceId = stackLatencyTraceId(reply.request.headers[STACK_LATENCY_TRACE_HEADER]);
    const operation = proxyOperation(path);
    if (traceId === undefined || operation === undefined) return undefined;
    const trace = { recording: createStackLatencyContext({ traceId, clock: "web", operation, sink }) };
    traces.set(reply.request, trace);
    return trace;
  };
  const proxy = async (request: { method: string; url: string; body?: unknown }, reply: FastifyReply) => {
    const controller = new AbortController();
    const disconnected = () => { if (!reply.raw.writableFinished) controller.abort(); };
    reply.raw.once("close", disconnected);
    const path = stripPrefix(request.url, prefix);
    const trace = traceFor(reply, path);
    try {
      const finishTransport = trace?.recording.start("transport");
      let upstream: Awaited<ReturnType<SessionProxyDaemon["request"]>>;
      try {
        upstream = trace === undefined
          ? await daemon.request(request.method, path, request.body, controller.signal)
          : await daemon.request(request.method, path, request.body, controller.signal, { traceId: trace.recording.traceId });
        finishTransport?.();
      } catch (error) { finishTransport?.(controller.signal.aborted ? "aborted" : "error"); throw error; }
      reply.code(upstream.statusCode);
      const contentType = upstream.headers["content-type"];
      if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
      const retryAfter = upstream.headers["retry-after"];
      if (retryAfter !== undefined && retryAfter !== "") reply.header("retry-after", retryAfter);
      if (sink !== undefined) {
        const timing = allowedServerTiming(upstream.headers["server-timing"]);
        if (timing !== undefined) reply.header("server-timing", timing);
      }
      if (upstream.body === "") return undefined;
      const finishDecode = trace?.recording.start("decode");
      try {
        const value: unknown = JSON.parse(upstream.body);
        finishDecode?.();
        return value;
      } catch (error) { finishDecode?.("error"); throw error; }
    } catch (error) {
      if (!controller.signal.aborted) requestFailed(reply, error);
      else trace?.recording.dispose();
      return undefined;
    } finally { reply.raw.off("close", disconnected); }
  };

  app.get(`${prefix}/sessiond/health`, (_request, reply) => proxy({ method: "GET", url: `${prefix}/health` }, reply));
  app.get(`${prefix}/sessiond/runtime`, (_request, reply) => proxy({ method: "GET", url: `${prefix}/runtime` }, reply));

  app.get<{ Params: { sessionId: string }; Querystring: { native?: string } }>(`${prefix}/sessions/:sessionId/events`, { websocket: true }, (socket, request) => {
    bridgeSockets(socket, daemon.connectWebSocket(stripPrefix(request.url, prefix)), request.query.native === "1");
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
  // The daemon answers JSON; the browser loads this URL from an <img>, so send the bytes.
  app.get(`${prefix}/sessions/:sessionId/images`, async (request, reply) => {
    try {
      const upstream = await daemon.request("GET", stripPrefix(request.url, prefix));
      const image = upstream.statusCode === 200 ? sessionImageBody(upstream.body) : undefined;
      if (image === undefined) return await reply.code(upstream.statusCode === 200 ? 502 : upstream.statusCode).send({ error: "Image unavailable" });
      // The URL names a committed message, so the bytes never change.
      return await reply.code(200).type(image.mimeType).header("cache-control", "private, max-age=31536000, immutable")
        .header("x-content-type-options", "nosniff").send(Buffer.from(image.data, "base64"));
    } catch (error) {
      requestFailed(reply, error);
      return undefined;
    }
  });
  app.all(`${prefix}/sessions`, (request, reply) => proxy(request, reply));
  app.all(`${prefix}/sessions/*`, (request, reply) => proxy(request, reply));
}

/** Only operations the measurement contract names; other routes stay untraced. */
function proxyOperation(path: string): StackLatencySpan["operation"] | undefined {
  const pathname = path.split("?", 1)[0] ?? path;
  if (/^\/sessions\/[^/]+\/open$/u.test(pathname)) return "session-open";
  if (/^\/sessions\/[^/]+\/processes\/[^/]+\/output$/u.test(pathname)) return "process-output";
  if (/^\/sessions\/[^/]+\/processes$/u.test(pathname)) return "process-list";
  if (/^\/backlog(?:\/|$)/u.test(pathname)) return "backlog";
  if (/^\/project-(?:workspaces|groups)(?:\/|$)/u.test(pathname)) return "project-context";
  return undefined;
}

const SERVER_TIMING_NAMES: ReadonlySet<string> = new Set(STACK_LATENCY_SERVER_TIMING);

/** Keep allow-listed names with a finite nonnegative duration; drop descriptions and other fields. */
function allowedServerTiming(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const entries = value.split(",").flatMap((entry) => {
    const [name, ...params] = entry.split(";").map(part => part.trim());
    if (name === undefined || !SERVER_TIMING_NAMES.has(name)) return [];
    const raw = params.find(param => param.startsWith("dur="))?.slice(4);
    if (raw === undefined || !/^\d+(?:\.\d+)?$/u.test(raw)) return [];
    const duration = Number(raw);
    return Number.isFinite(duration) ? [`${name};dur=${String(duration)}`] : [];
  });
  return entries.length === 0 ? undefined : entries.join(", ");
}

function sessionImageBody(body: string): { mimeType: string; data: string } | undefined {
  const value: unknown = JSON.parse(body);
  if (typeof value !== "object" || value === null || !("mimeType" in value) || !("data" in value)) return undefined;
  const { mimeType, data } = value;
  return typeof mimeType === "string" && SESSION_IMAGE_MIME_TYPES.has(mimeType) && typeof data === "string" ? { mimeType, data } : undefined;
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

function bridgeSockets(client: WebSocket, upstream: WebSocket, nativeRequested = false): void {
  // A native request can be admitted as classic. Apply native limits only
  // after the daemon declares its authority, never to classic large frames.
  let readPath: "native" | "classic" | undefined = nativeRequested ? undefined : "classic";
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
  let downstreamPending = 0;
  upstream.on("message", (data) => {
    const bytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.byteLength, 0) : data.byteLength;
    if (client.readyState !== WebSocket.OPEN) return;
    if (readPath === undefined && bytes <= SESSION_SOCKET_MAX_BYTES) readPath = admittedReadPath(data);
    if (readPath === "native" && client.bufferedAmount + bytes > SESSION_SOCKET_MAX_BYTES) { client.terminate(); upstream.terminate(); return; }
    // Drain each downstream write before reading more daemon frames. Otherwise
    // chunking only moves an unbounded send queue from sessiond into the proxy.
    downstreamPending++;
    upstream.pause();
    const timer = readPath === "native" ? setTimeout(() => { client.terminate(); upstream.terminate(); }, SESSION_SOCKET_SEND_TIMEOUT_MS) : undefined;
    timer?.unref();
    client.send(data, error => {
      clearTimeout(timer);
      downstreamPending--;
      if (error) { client.terminate(); upstream.terminate(); }
      else if (downstreamPending === 0 && upstream.readyState === WebSocket.OPEN) upstream.resume();
    });
  });
  client.on("close", () => { pending.length = 0; pendingBytes = 0; upstream.resume(); upstream.close(); });
  upstream.on("close", () => { client.close(); });
  upstream.on("error", () => { client.close(); });
  client.on("error", () => { upstream.close(); });
}

const admissionSchema = z.object({
  type: z.enum(["session.open", "session.snapshot", "session.chunk", "session.checkpoint"]),
  readPath: z.enum(["native", "classic"]).optional(),
  open: z.object({ readPath: z.enum(["native", "classic"]) }).optional(),
});

/** Inspect only the admission header. Invalid frames remain the client's responsibility. */
function admittedReadPath(data: RawData): "native" | "classic" | undefined {
  try {
    const payload = Buffer.isBuffer(data) ? data.toString("utf8") : new TextDecoder().decode(data instanceof ArrayBuffer ? data : Buffer.concat(data));
    const frame = admissionSchema.safeParse(JSON.parse(payload));
    if (!frame.success) return undefined;
    return frame.data.type === "session.open" ? frame.data.open?.readPath
      : frame.data.type === "session.checkpoint" ? frame.data.readPath : "native";
  } catch { return undefined; }
}

function sendIfOpen(socket: WebSocket, data: RawData): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
}
