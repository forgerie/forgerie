import Fastify, { type FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSessionProxyRoutes } from "./sessionProxyRoutes";
import { respondToConnectionChecks } from "../realtime/connectionHealth";

let app: FastifyInstance;
let daemon: FakeSessionDaemon;

beforeEach(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  daemon = await FakeSessionDaemon.create();
  registerSessionProxyRoutes(app, daemon, "/api/machines/local");
});

afterEach(async () => {
  await app.close();
  await daemon.close();
});

describe("machine-scoped session proxy routes", () => {
  it("forwards gated action reads, approvals and refusals unchanged", async () => {
    await app.inject({url: "/api/machines/local/sessions/s1/gated-actions?cwd=%2Frepo"});
    for (const action of ["approve", "refuse"]) {
      daemon.respondWith({statusCode: 409, headers: {"content-type": "application/json"}, body: JSON.stringify({error: "Gated action is not waiting"})});
      expect((await app.inject({method: "POST", url: `/api/machines/local/sessions/s1/gated-actions/g1/${action}`, payload: {cwd: "/repo"}})).statusCode).toBe(409);
    }
    expect(daemon.requests).toEqual([
      {method: "GET", path: "/sessions/s1/gated-actions?cwd=%2Frepo", body: undefined},
      {method: "POST", path: "/sessions/s1/gated-actions/g1/approve", body: {cwd: "/repo"}},
      {method: "POST", path: "/sessions/s1/gated-actions/g1/refuse", body: {cwd: "/repo"}},
    ]);
  });
  it("forwards decision reads and overturn corrections through the session wildcard", async () => {
    const payload = { cwd: "/repo", note: "Use the contract" };
    expect((await app.inject({ url: "/api/machines/local/sessions/s1/decisions?cwd=%2Frepo" })).statusCode).toBe(200);
    daemon.respondWith({ statusCode: 409, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Decision already overturned" }) });
    expect((await app.inject({ method: "POST", url: "/api/machines/local/sessions/s1/decisions/d1/overturn", payload })).statusCode).toBe(409);
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/sessions/s1/decisions?cwd=%2Frepo", body: undefined },
      { method: "POST", path: "/sessions/s1/decisions/d1/overturn", body: payload },
    ]);
  });
  it("forwards PR catalogs, structured reads and opt-in watch mutations", async () => {
    await app.inject({ method: "GET", url: "/api/machines/local/github/pulls" });
    await app.inject({ method: "GET", url: "/api/machines/local/sessions/s1/pull-requests?cwd=/repo" });
    await app.inject({ method: "POST", url: "/api/machines/local/sessions/s1/pull-requests/9/watch", payload: { cwd: "/repo" } });
    await app.inject({ method: "DELETE", url: "/api/machines/local/sessions/s1/pull-requests/9/watch?cwd=/repo" });
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/github/pulls", body: undefined },
      { method: "GET", path: "/sessions/s1/pull-requests?cwd=/repo", body: undefined },
      { method: "POST", path: "/sessions/s1/pull-requests/9/watch", body: { cwd: "/repo" } },
      { method: "DELETE", path: "/sessions/s1/pull-requests/9/watch?cwd=/repo", body: undefined },
    ]);
  });
  it("forwards workflow discovery, launches, history, and explicit completion through the session wildcard", async () => {
    const launch = { cwd: "/repo", name: "experiment", inputs: { task: "baseline" }, requestId: "stable-request", models: { build: "faux/faux-1" } };
    const finish = { cwd: "/repo", outcome: "completed", result: "Recorded" };
    const discovery = await app.inject({ method: "GET", url: "/api/machines/local/sessions/s1/workflows?cwd=%2Frepo" });
    const accepted = await app.inject({ method: "POST", url: "/api/machines/local/sessions/s1/workflow-runs", payload: launch });
    const history = await app.inject({ method: "GET", url: "/api/machines/local/sessions/s1/workflow-runs?cwd=%2Frepo" });
    expect((await app.inject({ method: "POST", url: "/api/machines/local/sessions/s1/workflow-runs/r1/cancel", payload: { cwd: "/repo" } })).statusCode).toBe(200);
    const model = { cwd: "/repo", model: null };
    expect((await app.inject({ method: "POST", url: "/api/machines/local/sessions/s1/workflow-runs/r1/workers/build/model", payload: model })).statusCode).toBe(200);
    daemon.respondWith({ statusCode: 409, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Children still running" }) });
    const pending = await app.inject({ method: "POST", url: "/api/machines/local/sessions/s1/workflow-runs/r1/finish", payload: finish });
    expect([discovery.statusCode, accepted.statusCode, history.statusCode, pending.statusCode]).toEqual([200, 200, 200, 409]);
    expect(pending.json()).toEqual({ error: "Children still running" });
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/sessions/s1/workflows?cwd=%2Frepo", body: undefined },
      { method: "POST", path: "/sessions/s1/workflow-runs", body: launch },
      { method: "GET", path: "/sessions/s1/workflow-runs?cwd=%2Frepo", body: undefined },
      { method: "POST", path: "/sessions/s1/workflow-runs/r1/cancel", body: { cwd: "/repo" } },
      { method: "POST", path: "/sessions/s1/workflow-runs/r1/workers/build/model", body: model },
      { method: "POST", path: "/sessions/s1/workflow-runs/r1/finish", body: finish },
    ]);
  });

  it("forwards workflow proposal history and all decisions, including conflict reasons", async () => {
    const start = { cwd: "/repo", inputs: { task: "edited" }, requestId: "start-1", models: { build: null } };
    const changes = { cwd: "/repo", note: "Add review." };
    const base = "/api/machines/local/sessions/s1/workflow-proposals";
    expect((await app.inject({ url: `${base}?cwd=%2Frepo` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${base}/p1/start`, payload: start })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${base}/p1/changes`, payload: changes })).statusCode).toBe(200);
    daemon.respondWith({ statusCode: 409, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "This workflow proposal is not open" }) });
    const dismissed = await app.inject({ method: "POST", url: `${base}/p1/dismiss`, payload: { cwd: "/repo" } });
    expect(dismissed.statusCode).toBe(409);
    expect(dismissed.json()).toEqual({ error: "This workflow proposal is not open" });
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/sessions/s1/workflow-proposals?cwd=%2Frepo", body: undefined },
      { method: "POST", path: "/sessions/s1/workflow-proposals/p1/start", body: start },
      { method: "POST", path: "/sessions/s1/workflow-proposals/p1/changes", body: changes },
      { method: "POST", path: "/sessions/s1/workflow-proposals/p1/dismiss", body: { cwd: "/repo" } },
    ]);
  });

  it("strips the machine prefix before forwarding session requests", async () => {
    const response = await app.inject({ method: "GET", url: "/api/machines/local/sessions?cwd=/repo" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(daemon.requests).toEqual([{ method: "GET", path: "/sessions?cwd=/repo", body: undefined }]);
  });

  it("forwards backlog lists and guarded launches to the single daemon owner", async () => {
    const payload = { requestId: "request", start: { cwd: "/repo", destination: { kind: "fresh-worktree" } } };
    const listing = await app.inject({ method: "GET", url: "/api/machines/local/backlog" });
    daemon.respondWith({ statusCode: 409, headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "conflict", error: "Already claimed" }) });
    const launch = await app.inject({ method: "POST", url: "/api/machines/local/backlog/project/items/item/launch", payload });
    expect(listing.statusCode).toBe(200);
    expect(launch.statusCode).toBe(409);
    expect(launch.json()).toEqual({ kind: "conflict", error: "Already claimed" });
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/backlog", body: undefined },
      { method: "POST", path: "/backlog/project/items/item/launch", body: payload },
    ]);
  });

  it("forwards structured diff annotations unchanged to the session daemon", async () => {
    const payload = {
      cwd: "/repo", text: "Fix", streamingBehavior: "followUp",
      diffAnnotations: [{ path: "src/retry.ts", staged: false, comment: "Keep retries.", lines: [{ kind: "add", newLineNumber: 8, text: "retry();" }] }],
    };
    const response = await app.inject({ method: "POST", url: "/api/machines/local/sessions/session-1/prompt", payload });
    expect(response.statusCode).toBe(200);
    expect(daemon.requests).toEqual([{ method: "POST", path: "/sessions/session-1/prompt", body: payload }]);
  });

  it("forwards queue-clear mutations and their status through the session daemon", async () => {
    const status = { sessionId: "session-1", pendingMessageCount: 0, queuedMessages: [] };
    daemon.respondWith({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(status) });

    const response = await app.inject({ method: "POST", url: "/api/machines/local/sessions/session-1/queue/clear", payload: { cwd: "/repo" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(status);
    expect(daemon.requests).toEqual([{ method: "POST", path: "/sessions/session-1/queue/clear", body: { cwd: "/repo" } }]);
  });

  it("forwards unread snapshots and acknowledgement cutoffs unchanged", async () => {
    const catalog = await app.inject({ method: "GET", url: "/api/machines/local/sessions/unread" });
    const acknowledge = await app.inject({
      method: "POST",
      url: "/api/machines/local/sessions/session-1/unread/acknowledge",
      payload: { cwd: "/repo", catalogId: "catalog-test", throughCompletionOrder: 9 },
    });

    expect([catalog.statusCode, acknowledge.statusCode]).toEqual([200, 200]);
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/sessions/unread", body: undefined },
      { method: "POST", path: "/sessions/session-1/unread/acknowledge", body: { cwd: "/repo", catalogId: "catalog-test", throughCompletionOrder: 9 } },
    ]);
  });

  it("forwards notification snapshots and dismissal bodies unchanged", async () => {
    const catalog = await app.inject({ method: "GET", url: "/api/machines/local/sessions/notifications" });
    const inbox = await app.inject({ method: "GET", url: `/api/machines/local/sessions/session-1/notifications?cwd=${encodeURIComponent("/repo")}` });
    const dismiss = await app.inject({
      method: "POST",
      url: "/api/machines/local/sessions/session-1/notifications/dismiss",
      payload: { cwd: "/repo", daemonInstanceId: "daemon-test", notificationId: "notice-1" },
    });
    const dismissAll = await app.inject({
      method: "POST",
      url: "/api/machines/local/sessions/session-1/notifications/dismiss-all",
      payload: { cwd: "/repo", daemonInstanceId: "daemon-test", throughOrder: 7, throughOverflowWatermark: 2 },
    });

    expect([catalog.statusCode, inbox.statusCode, dismiss.statusCode, dismissAll.statusCode]).toEqual([200, 200, 200, 200]);
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/sessions/notifications", body: undefined },
      { method: "GET", path: "/sessions/session-1/notifications?cwd=%2Frepo", body: undefined },
      { method: "POST", path: "/sessions/session-1/notifications/dismiss", body: { cwd: "/repo", daemonInstanceId: "daemon-test", notificationId: "notice-1" } },
      { method: "POST", path: "/sessions/session-1/notifications/dismiss-all", body: { cwd: "/repo", daemonInstanceId: "daemon-test", throughOrder: 7, throughOverflowWatermark: 2 } },
    ]);
  });

  it("does not forward retired browser auth requests", async () => {
    const response = await app.inject({ method: "POST", url: "/api/machines/local/auth/api-key/interactive", payload: { providerId: "p" } });
    expect(response.statusCode).toBe(404);
    expect(daemon.requests).toEqual([]);
  });

  it("forwards sessiond health and runtime aliases to daemon endpoints", async () => {
    const healthResponse = await app.inject({ method: "GET", url: "/api/machines/local/sessiond/health" });
    const runtimeResponse = await app.inject({ method: "GET", url: "/api/machines/local/sessiond/runtime" });

    expect(healthResponse.statusCode).toBe(200);
    expect(healthResponse.json()).toEqual({ ok: true });
    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toEqual({ ok: true });
    expect(daemon.requests).toEqual([
      { method: "GET", path: "/health", body: undefined },
      { method: "GET", path: "/runtime", body: undefined },
    ]);
  });

  it("forwards empty upstream responses without parsing a body", async () => {
    daemon.respondWith({ statusCode: 204, headers: {}, body: "" });

    const response = await app.inject({ method: "DELETE", url: "/api/machines/local/sessions/session-1" });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
    expect(daemon.requests).toEqual([{ method: "DELETE", path: "/sessions/session-1", body: undefined }]);
  });

  it("forwards the pre-session model catalog, which belongs to no session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/machines/local/models" });

    expect(response.statusCode).toBe(200);
    expect(daemon.requests).toEqual([{ method: "GET", path: "/models", body: undefined }]);
  });

  it("forwards prompt-library writes, which belong to no session", async () => {
    const response = await app.inject({ method: "POST", url: "/api/machines/local/prompts", payload: { name: "tell", body: "Speak plainly." } });

    expect(response.statusCode).toBe(200);
    expect(daemon.requests).toEqual([{ method: "POST", path: "/prompts", body: { name: "tell", body: "Speak plainly." } }]);
  });

  it("returns a 502 response when the daemon request fails", async () => {
    daemon.failWith(new Error("connection refused"));

    const response = await app.inject({ method: "GET", url: "/api/machines/local/sessions" });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "Session daemon unavailable: connection refused" });
    expect(daemon.requests).toEqual([{ method: "GET", path: "/sessions", body: undefined }]);
  });

  it.each(["/events", "/sessions/events", "/sessions/session-1/events"])("forwards an immediate health check while the daemon handshake is pending on %s", async path => {
    const probeApp = Fastify({ logger: false });
    await probeApp.register(fastifyWebsocket);
    const probeDaemon = await FakeSessionDaemon.create(50);
    registerSessionProxyRoutes(probeApp, probeDaemon);
    await probeApp.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(probeApp)}/api${path}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const reply = new Promise<unknown>((resolve, reject) => {
        timer = setTimeout(() => { reject(new Error("Proxy dropped the connection check before the daemon opened")); }, 500);
        socket.once("message", data => {
          if (!Buffer.isBuffer(data)) throw new Error("Expected a socket buffer");
          resolve(JSON.parse(data.toString("utf8")));
        });
      });
      await waitForOpen(socket);
      socket.send(JSON.stringify({ type: "connection.ping", id: "early-probe" }));
      expect(await reply).toEqual({ type: "connection.pong", id: "early-probe" });
    } finally {
      clearTimeout(timer); socket.terminate();
      await probeApp.close(); await probeDaemon.close();
    }
  });

  it.each(["bytes", "frames"])("bounds the daemon handshake queue by %s", async limit => {
    const probeApp = Fastify({ logger: false });
    await probeApp.register(fastifyWebsocket);
    const probeDaemon = await FakeSessionDaemon.create(100);
    registerSessionProxyRoutes(probeApp, probeDaemon);
    await probeApp.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(probeApp)}/api/events`);
    try {
      const closed = new Promise<number>(resolve => socket.once("close", code => { resolve(code); }));
      await waitForOpen(socket);
      if (limit === "bytes") socket.send(Buffer.alloc(64 * 1024 + 1));
      else for (let index = 0; index < 33; index++) socket.send(Buffer.alloc(0));
      expect(await closed).toBe(1009);
    } finally {
      socket.terminate(); await probeApp.close(); await probeDaemon.close();
    }
  });

  it("preserves cwd query context when forwarding session event websockets", async () => {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(`${serverUrl(app)}/api/machines/local/sessions/session-1/events?cwd=${encodeURIComponent("/repo")}`);

    try {
      await waitForOpen(socket);
      expect(daemon.websocketPaths).toEqual(["/sessions/session-1/events?cwd=%2Frepo"]);
    } finally {
      socket.close();
    }
  });
  it("serves a referenced session image as bytes, not JSON", async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
    daemon.respondWith({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ mimeType: "image/png", data: bytes.toString("base64") }) });
    const response = await app.inject({ url: "/api/machines/local/sessions/s1/images?cwd=%2Frepo&message=m1&image=0" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.rawPayload.equals(bytes)).toBe(true);
    expect(daemon.requests).toEqual([{ method: "GET", path: "/sessions/s1/images?cwd=%2Frepo&message=m1&image=0", body: undefined }]);
  });
  it("refuses a daemon image whose type a browser could run as a page", async () => {
    daemon.respondWith({ statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ mimeType: "text/html", data: "PGh0bWw+" }) });
    expect((await app.inject({ url: "/api/machines/local/sessions/s1/images?cwd=%2Frepo&message=m1&image=0" })).statusCode).toBe(502);
    daemon.respondWith({ statusCode: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Image not found" }) });
    expect((await app.inject({ url: "/api/machines/local/sessions/s1/images?cwd=%2Frepo&message=m1&image=9" })).statusCode).toBe(404);
  });
});

interface FakeSessionDaemonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

class FakeSessionDaemon {
  readonly requests: { method: string; path: string; body: unknown }[] = [];
  readonly websocketPaths: string[] = [];
  private readonly queuedResponses: (FakeSessionDaemonResponse | Error)[] = [];
  private readonly sockets = new Set<WebSocket>();

  private constructor(private readonly upstream: WebSocketServer) {
    this.upstream.on("connection", (socket) => {
      this.sockets.add(socket);
      respondToConnectionChecks(socket);
      socket.on("close", () => { this.sockets.delete(socket); });
    });
  }

  static async create(handshakeDelayMs = 0): Promise<FakeSessionDaemon> {
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0,
      ...(handshakeDelayMs === 0 ? {} : { verifyClient: (_info, done) => { setTimeout(() => { done(true); }, handshakeDelayMs); } }),
    });
    await waitForListening(upstream);
    return new FakeSessionDaemon(upstream);
  }

  respondWith(response: FakeSessionDaemonResponse): void {
    this.queuedResponses.push(response);
  }

  failWith(error: Error): void {
    this.queuedResponses.push(error);
  }

  request(method: string, path: string, body?: unknown): Promise<FakeSessionDaemonResponse> {
    this.requests.push({ method, path, body });
    const queuedResponse = this.queuedResponses.shift();
    if (queuedResponse instanceof Error) return Promise.reject(queuedResponse);
    return Promise.resolve(queuedResponse ?? { statusCode: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: true }) });
  }

  connectWebSocket(path: string): WebSocket {
    this.websocketPaths.push(path);
    return new WebSocket(`${webSocketServerUrl(this.upstream)}${path}`);
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    await closeWebSocketServer(this.upstream);
  }
}

function serverUrl(instance: FastifyInstance): string {
  const address = instance.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address");
  return `ws://127.0.0.1:${String(address.port)}`;
}

function webSocketServerUrl(server: WebSocketServer): string {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address");
  return `ws://127.0.0.1:${String(address.port)}`;
}

function waitForListening(server: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    server.once("listening", () => { resolve(); });
  });
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("open", () => { resolve(); });
    socket.once("error", reject);
    socket.once("close", () => { reject(new Error("WebSocket closed before opening")); });
  });
}

describe("consistent read proxy compatibility", () => {
  it("forwards open and identity-bound older pages without changing the cut or error envelope", async () => {
    const open = "/sessions/s1/open?cwd=%2Frepo&limit=50&around=123";
    const older = "/sessions/s1/messages?cwd=%2Frepo&limit=50&before=100&historyId=opaque";
    await app.inject({ url: `/api/machines/local${open}` });
    daemon.respondWith({ statusCode: 409, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "History changed", code: "HISTORY_CHANGED" }) });
    const response = await app.inject({ url: `/api/machines/local${older}` });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "History changed", code: "HISTORY_CHANGED" });
    expect(daemon.requests).toEqual([{ method: "GET", path: open, body: undefined }, { method: "GET", path: older, body: undefined }]);
  });
});
