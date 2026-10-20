import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { describe, expect, it } from "vitest";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { StackLatencySpan } from "../../shared/stackLatency.js";
import { PiSessionService } from "./piSessionService.js";
import { registerSessionRoutes } from "./sessionRoutes.js";
import { emptyArchiveStore, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, testModelRuntime } from "./piSessionService.testSupport.js";

async function fixture(measurement: boolean, failObserver = false) {
  const spans: StackLatencySpan[] = [];
  const hub = new SessionEventHub();
  const runtime = fakeRuntime("classic", { sessionManager: fakeSessionManager("/workspace", { getSessionId: () => "classic",
    getBranch: () => [{ type: "message", id: "u", message: { role: "user", content: "private input" } }] }) });
  const service = new PiSessionService(hub, { agentDir: "/tmp/forgerie-latency-test", modelRuntime: testModelRuntime,
    archiveStore: emptyArchiveStore(), createAgentRuntime: runtimeCreator(runtime.runtime), sessionManager: sessionGateway([]), heartbeatIntervalMs: 60_000 });
  const app = Fastify({ logger: false });
  await app.register(websocket);
  registerSessionRoutes(app, service, hub, "", undefined, measurement ? { stackLatency: { record(span) { spans.push(span); if (failObserver) throw new Error("observer"); } } } : undefined);
  await service.start("/workspace");
  const base = await app.listen({ host: "127.0.0.1", port: 0 });
  return { spans, service, base, close: async () => { await app.close(); await service.dispose(); } };
}

describe("opt-in session open phase boundaries", () => {
  it("keeps production defaults silent despite a client trace header", async () => {
    const f = await fixture(false);
    try {
      const response = await fetch(`${f.base}/sessions/classic/open?cwd=%2Fworkspace`, { headers: { "x-forgerie-trace": "a".repeat(32) } });
      expect(response.status).toBe(200);
      expect(response.headers.get("server-timing")).toBeNull();
      expect(f.spans).toEqual([]);
      await response.arrayBuffer();
    } finally { await f.close(); }
  });
  it("records admission, execution and actual serialization separately without recording a fictitious queue", async () => {
    const f = await fixture(true);
    try {
      const response = await fetch(`${f.base}/sessions/classic/open?cwd=%2Fworkspace`, { headers: { "x-forgerie-trace": "b".repeat(32) } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ page: { messages: [{ content: "private input" }] } });
      const roots = f.spans.filter(span => span.parentSpanId === "0");
      expect(roots.map(span => span.phase)).toEqual(["admission", "execute", "serialize"]);
      const execute = roots[1];
      // Service phases nest inside execution; a nested span is never added to its parent.
      expect(f.spans.filter(span => span.parentSpanId !== "0").map(span => [span.phase, span.parentSpanId])).toEqual([["admission", execute?.spanId], ["projection", execute?.spanId]]);
      expect(f.spans.some(span => span.phase === "queue")).toBe(false);
      expect(f.spans.every(span => span.outcome === "ok" && span.clock === "sessiond" && span.operation === "session-open")).toBe(true);
      expect(response.headers.get("server-timing")).toMatch(/^sessiond-admission;dur=[\d.]+, sessiond-execute;dur=[\d.]+, sessiond-serialize;dur=[\d.]+$/u);
      expect(JSON.stringify(f.spans)).not.toContain("private input");
      expect(JSON.stringify(f.spans)).not.toContain("workspace");
    } finally { await f.close(); }
  });
  it("ignores invalid trace identities and retains successful responses with a broken observer", async () => {
    const f = await fixture(true, true);
    try {
      const invalid = await fetch(`${f.base}/sessions/classic/open?cwd=%2Fworkspace`, { headers: { "x-forgerie-trace": "session-id" } });
      expect(invalid.status).toBe(200); expect(invalid.headers.get("server-timing")).toBeNull(); await invalid.arrayBuffer();
      expect(f.spans).toEqual([]);
      const valid = await fetch(`${f.base}/sessions/classic/open?cwd=%2Fworkspace`, { headers: { "x-forgerie-trace": "c".repeat(32) } });
      expect(valid.status).toBe(200); await valid.arrayBuffer();
      expect(f.spans.filter(span => span.parentSpanId === "0")).toHaveLength(3);
    } finally { await f.close(); }
  });
});
