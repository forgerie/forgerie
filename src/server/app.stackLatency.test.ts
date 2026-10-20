import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectStore } from "./storage/projectStore.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import { createUnavailableSpeechService } from "./speech/speechRoutes.js";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import type { StackLatencySpan } from "../shared/stackLatency.js";

const TRACE = "fedcba9876543210fedcba9876543210";
const page = { messages: Array.from({ length: 200 }, (_, index) => ({ id: `m${String(index)}`, text: "deterministic transcript content" })) };

class RecordingSessionDaemon implements SessionProxyDaemon {
  readonly traces: (string | undefined)[] = [];
  request(_method: string, _path: string, _body?: unknown, _signal?: AbortSignal, options?: { traceId?: string }) {
    this.traces.push(options?.traceId);
    return Promise.resolve({ statusCode: 200, headers: { "content-type": "application/json; charset=utf-8", "server-timing": "sessiond-execute;dur=7" }, body: JSON.stringify(page) });
  }
  connectWebSocket(): WebSocket { throw new Error("No sockets in this test"); }
}

let app: FastifyInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  await app?.close(); app = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function edge(daemon: SessionProxyDaemon, spans?: StackLatencySpan[]) {
  directory = await mkdtemp(join(tmpdir(), "forgerie-stack-latency-app-"));
  app = await buildApp({
    projects: new ProjectService(new ProjectStore(join(directory, "projects.json"))),
    workspaces: new WorkspaceService(),
    sessionDaemon: daemon,
    agentProfileProvider: { getActiveAgentProfile: () => Promise.resolve({ status: "unavailable", error: "not used" }) },
    speech: createUnavailableSpeechService(),
    clientDist: false,
    logger: false,
    ...(spans === undefined ? {} : { stackLatency: { sink: { record: (span: StackLatencySpan) => { spans.push(span); } } } }),
  });
  return app;
}

describe("web edge measurement composition", () => {
  it("is absent by default: no trace forwarding, timing header or spans", async () => {
    const daemon = new RecordingSessionDaemon();
    const response = await (await edge(daemon)).inject({ url: "/api/sessions/s1/open?cwd=%2Frepo", headers: { "x-forgerie-trace": TRACE } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["server-timing"]).toBeUndefined();
    expect(daemon.traces).toEqual([undefined]);
  });

  it("records spans through the compressed edge on both route prefixes without changing the body", async () => {
    const spans: StackLatencySpan[] = [];
    const daemon = new RecordingSessionDaemon();
    const routes = await edge(daemon, spans);
    for (const url of ["/api/sessions/s1/open?cwd=%2Frepo", "/api/machines/local/sessions/s1/open?cwd=%2Frepo"]) {
      const response = await routes.inject({ url, headers: { "x-forgerie-trace": TRACE, "accept-encoding": "gzip" } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-encoding"]).toBe("gzip");
      expect(response.headers["server-timing"]).toBe("sessiond-execute;dur=7");
      expect(JSON.parse(gunzipSync(response.rawPayload).toString("utf8"))).toEqual(page);
    }
    expect(daemon.traces).toEqual([TRACE, TRACE]);
    expect(spans.map(span => span.phase)).toEqual(["transport", "decode", "serialize", "transport", "decode", "serialize"]);
  });
});
