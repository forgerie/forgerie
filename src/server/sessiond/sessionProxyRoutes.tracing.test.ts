import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { registerSessionProxyRoutes, type SessionProxyDaemon, type SessionProxyRouteOptions } from "./sessionProxyRoutes";
import type { StackLatencySpan } from "../../shared/stackLatency";

const TRACE = "0123456789abcdef0123456789abcdef";
interface Response { statusCode: number; headers: Record<string, string>; body: string }

/** Real proxy-daemon contract with configurable responses; records what the proxy forwarded. */
class RecordingSessionDaemon implements SessionProxyDaemon {
  readonly calls: { path: string; traceId: string | undefined }[] = [];
  constructor(private readonly behavior: Response | Error) {}
  request(_method: string, path: string, _body?: unknown, _signal?: AbortSignal, options?: { traceId?: string }): Promise<Response> {
    this.calls.push({ path, traceId: options?.traceId });
    return this.behavior instanceof Error ? Promise.reject(this.behavior) : Promise.resolve(this.behavior);
  }
  connectWebSocket(): WebSocket { throw new Error("No sockets in tracing tests"); }
}

const json = (body: unknown, headers: Record<string, string> = {}): Response =>
  ({ statusCode: 200, headers: { "content-type": "application/json; charset=utf-8", ...headers }, body: JSON.stringify(body) });

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

async function proxy(daemon: SessionProxyDaemon, options?: SessionProxyRouteOptions) {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  registerSessionProxyRoutes(app, daemon, "/api", options);
  return app;
}

describe("opt-in proxy measurement", () => {
  it("forwards no trace identity or upstream timing by default", async () => {
    const daemon = new RecordingSessionDaemon(json({ page: [1, 2] }, { "server-timing": "sessiond-execute;dur=4" }));
    const response = await (await proxy(daemon)).inject({ url: "/api/sessions/s1/open?cwd=%2Frepo", headers: { "x-forgerie-trace": TRACE } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ page: [1, 2] });
    expect(response.headers["server-timing"]).toBeUndefined();
    expect(daemon.calls).toEqual([{ path: "/sessions/s1/open?cwd=%2Frepo", traceId: undefined }]);
  });

  it("records web transport, decode and serialization intervals for a validated trace without changing the response", async () => {
    const spans: StackLatencySpan[] = [];
    const daemon = new RecordingSessionDaemon(json({ page: [1, 2] }, {
      "server-timing": 'sessiond-execute;dur=12.5;desc="private", other;dur=3, sessiond-admission;dur=abc, sessiond-serialize;dur=1, sessiond-execute;dur=-1',
    }));
    const response = await (await proxy(daemon, { measurement: true, sink: { record: span => { spans.push(span); } } }))
      .inject({ url: "/api/sessions/s1/open?cwd=%2Frepo", headers: { "x-forgerie-trace": TRACE } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ page: [1, 2] });
    expect(response.headers["server-timing"]).toBe("sessiond-execute;dur=12.5, sessiond-serialize;dur=1");
    expect(daemon.calls).toEqual([{ path: "/sessions/s1/open?cwd=%2Frepo", traceId: TRACE }]);
    expect(spans.map(span => span.phase)).toEqual(["transport", "decode", "serialize"]);
    for (const span of spans) expect(span).toMatchObject({ traceId: TRACE, clock: "web", operation: "session-open", outcome: "ok" });
  });

  it("ignores malformed or unrecognised traces and still serves the request", async () => {
    const spans: StackLatencySpan[] = [];
    const daemon = new RecordingSessionDaemon(json({ ok: true }));
    const routes = await proxy(daemon, { measurement: true, sink: { record: span => { spans.push(span); } } });
    for (const header of ["ABCDEF0123456789ABCDEF0123456789", "short", `${TRACE},${TRACE}`]) {
      expect((await routes.inject({ url: "/api/sessions/s1/open?cwd=%2Frepo", headers: { "x-forgerie-trace": header } })).statusCode).toBe(200);
    }
    // A valid trace on a route without an agreed operation is not measured.
    expect((await routes.inject({ url: "/api/activity", headers: { "x-forgerie-trace": TRACE } })).statusCode).toBe(200);
    expect(spans).toEqual([]);
    expect(daemon.calls.map(call => call.traceId)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("keeps the daemon-unavailable error and records the failed transport", async () => {
    const spans: StackLatencySpan[] = [];
    const daemon = new RecordingSessionDaemon(new Error("socket closed"));
    const response = await (await proxy(daemon, { measurement: true, sink: { record: span => { spans.push(span); } } }))
      .inject({ url: "/api/backlog", headers: { "x-forgerie-trace": TRACE } });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "Session daemon unavailable: socket closed" });
    expect(spans[0]).toMatchObject({ phase: "transport", operation: "backlog", outcome: "error" });
  });

  it("sends error responses exactly once while measuring", async () => {
    // A deferred send used to make Fastify send again after the handler resolved,
    // writing headers twice (ERR_HTTP_HEADERS_SENT) outside the request.
    const unhandled: unknown[] = [];
    const capture = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", capture);
    try {
      const spans: StackLatencySpan[] = [];
      const sink = { record: (span: StackLatencySpan) => { spans.push(span); } };
      const unavailable = await (await proxy(new RecordingSessionDaemon(new Error("socket closed")), { measurement: true, sink }))
        .inject({ url: "/api/sessions/s1/open?cwd=%2Frepo", headers: { "x-forgerie-trace": TRACE } });
      await app?.close();
      const invalid = await (await proxy(new RecordingSessionDaemon({ statusCode: 200, headers: { "content-type": "application/json" }, body: "{not json" }), { measurement: true, sink }))
        .inject({ url: "/api/sessions/s1/open?cwd=%2Frepo", headers: { "x-forgerie-trace": TRACE } });
      await new Promise(resolve => setTimeout(resolve, 50));
      expect([unavailable.statusCode, invalid.statusCode]).toEqual([502, 502]);
      expect(invalid.json<{ error: string }>().error).toMatch(/^Session daemon unavailable: /u);
      expect(spans.map(span => `${span.phase}:${span.outcome}`)).toEqual(["transport:error", "serialize:ok", "transport:ok", "decode:error", "serialize:ok"]);
      expect(unhandled).toEqual([]);
    } finally { process.off("unhandledRejection", capture); }
  });

  it("never lets a failing sink change the product response", async () => {
    const daemon = new RecordingSessionDaemon(json({ ok: true }));
    const response = await (await proxy(daemon, { measurement: true, sink: { record: () => { throw new Error("sink failed"); } } }))
      .inject({ url: "/api/sessions/s1/open?cwd=%2Frepo", headers: { "x-forgerie-trace": TRACE } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
