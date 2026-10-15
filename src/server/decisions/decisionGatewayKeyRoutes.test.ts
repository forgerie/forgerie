import { AttentionHints, type AttentionSession } from "./attentionHints.js";
import type { DecisionAnswers } from "./decisionClient.js";
import { decisionAnnotations } from "./optionalDecisionAnnotations.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDecisionHints, decisionHintsRuntimeStatus } from "./decisionHints.js";
import { registerDecisionGatewayKeyRoutes } from "./decisionGatewayKeyRoutes.js";
import { buildApp } from "../app.js";
import { createFilePiWebConfigService } from "../configRoutes.js";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { createActiveAgentProfileDescriptor } from "../../sessiond/activeAgentProfile.js";
import { ProjectService } from "../projects/projectService.js";
import { ProjectStore } from "../storage/projectStore.js";

const roots: string[] = []; const apps: FastifyInstance[] = []; const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => { resolve(); })); }
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});
const secret = "DISTINCTIVE-private-gateway-October15";
const replacement = "REPLACEMENT-private-gateway-October15";
const path = "/aui/plugins/decision-hints/gateway-key";
async function fixture(environmentKey?: string, answers: DecisionAnswers["answers"] = { attention: { type: "noul", noul: 0.8 } }) {
  const root = await mkdtemp(join(tmpdir(), "gateway-settings-http-")); roots.push(root);
  const configPath = join(root, "config.json"); const dir = join(root, "active-profile");
  const headers: (string | undefined)[] = [];
  const gateway = createServer((request, response) => {
    headers.push(request.headers.authorization); request.resume();
    response.end(JSON.stringify({ model: "fast", answers }));
  }); servers.push(gateway);
  await new Promise<void>(resolve => gateway.listen(0, "127.0.0.1", resolve));
  const address = gateway.address(); if (address === null || typeof address === "string") throw new Error("No gateway port");
  await writeFile(configPath, JSON.stringify({ agent: { dir: join(root, "desired-profile") }, plugins: { "decision-hints": { enabled: true, settings: { gateway_url: `http://127.0.0.1:${String(address.port)}` } } } }));
  const env = { PI_WEB_CONFIG: configPath, ...(environmentKey === undefined ? {} : { DECISION_GATEWAY_API_KEY: environmentKey }) };
  const profile = createActiveAgentProfileDescriptor({ dir, command: "pi", sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR"] });
  const hints = createDecisionHints({ env, agentDir: profile.dir });
  const logs: string[] = [];
  const logger = { level: "info", stream: { write: (line: string) => { logs.push(line); } } };
  const daemon = Fastify({ logger }); apps.push(daemon);
  registerDecisionGatewayKeyRoutes(daemon, hints.gatewayKey, profile.revision);
  daemon.get("/runtime", () => ({ component: "sessiond", label: "Session daemon", available: true, capabilities: [], activeAgentProfile: profile, ...decisionHintsRuntimeStatus(hints) }));
  const daemonUrl = await daemon.listen({ host: "127.0.0.1", port: 0 }); vi.stubEnv("PI_WEB_SESSIOND_URL", daemonUrl);
  const web = await buildApp({ clientDist: false, logger, sessionDaemon: new SessionDaemonClient(), config: createFilePiWebConfigService({ env }),
    projects: new ProjectService(new ProjectStore(join(root, "projects.json"))),
    uiSettings: { pluginServices: { read: () => Promise.resolve({ available: false, stamp: [] }), restart: () => Promise.resolve() } } });
  apps.push(web);
  const webUrl = await web.listen({ host: "127.0.0.1", port: 0 });
  const catalog = z.object({ revision: z.string() }).parse(await (await fetch(`${webUrl}/aui/plugins`)).json());
  const change = async (apiKey?: string) => {
    const response = await fetch(`${webUrl}${path}${apiKey === undefined ? "/clear" : ""}`, { method: "POST", headers: { "content-type": "application/json", origin: webUrl },
      body: JSON.stringify({ revision: catalog.revision, ...(apiKey === undefined ? {} : { apiKey }) }) });
    return { status: response.status, body: await response.text() };
  };
  const ask = () => hints.client.ask({ model: "fast", state: "hello", questions: { attention: { type: "noul", instructions: "Needs attention?" } } });
  return { root, dir, web, daemon, webUrl, catalog, hints, headers, logs, change, ask, profile };
}

describe("write-only gateway settings HTTP path", () => {
  it("sets, replaces and clears on the next real HTTP ask without restarting either process", async () => {
    const f = await fixture();
    await f.ask(); expect(f.headers).toEqual([undefined]);
    const replies = [];
    replies.push(await f.change(secret));
    expect(replies.at(-1)).toEqual({ status: 200, body: JSON.stringify({ keyPresent: true, source: "settings" }) });
    await f.ask(); expect(f.headers.at(-1)).toBe(`Bearer ${secret}`);
    replies.push(await f.change(replacement)); await f.ask(); expect(f.headers.at(-1)).toBe(`Bearer ${replacement}`);
    const runtime = await f.web.inject("/api/pi-web/runtime"); replies.push({ body: runtime.body });
    expect(z.object({ components: z.object({ sessiond: z.object({ decisionHints: z.unknown() }) }) }).parse(runtime.json()).components.sessiond.decisionHints).toEqual({ keyPresent: true, source: "settings" });
    const status = await f.web.inject(path); replies.push({ body: status.body });
    expect(status.json()).toEqual({ keyPresent: true, source: "settings" });
    replies.push(await f.change()); await f.ask(); expect(f.headers.at(-1)).toBeUndefined();
    expect(f.hints.status()).toEqual({ keyPresent: false, source: "none" });
    expect(await readFile(join(f.root, "config.json"), "utf8")).not.toMatch(/DISTINCTIVE|REPLACEMENT|apiKey/);
    const visible = JSON.stringify([replies, f.logs]);
    expect(visible).not.toContain(secret); expect(visible).not.toContain(replacement);
  });
  it("reports environment precedence and refuses save and remove without echoing credentials", async () => {
    const f = await fixture(secret);
    for (const result of [await f.change(replacement), await f.change()]) {
      expect(result.status).toBe(409); expect(result.body).toContain("DECISION_GATEWAY_API_KEY"); expect(result.body).not.toContain(secret); expect(result.body).not.toContain(replacement);
    }
    expect(f.hints.status()).toEqual({ keyPresent: true, source: "environment" });
    await f.ask(); expect(f.headers.at(-1)).toBe(`Bearer ${secret}`);
    expect(JSON.stringify(f.logs)).not.toContain(secret);
  });
  it("keeps the credential out of published hint events and optional annotation storage", async () => {
    const f = await fixture(undefined, {
      kind: { type: "choice", choice: "review", probabilities: { decision: 0, review: 1, blocked: 0, failed: 0, done: 0, fyi: 0 }, confidence: 1 },
      asks_user: { type: "noul", noul: 0.9 }, stopped_early: { type: "noul", noul: 0.1 },
      urgency: { type: "score", score: 1, probabilities: { "0": 0, "1": 1, "2": 0 }, confidence: 1 },
    });
    await f.change(secret);
    const events: string[] = []; const errors: unknown[] = [];
    const hub = new SessionEventHub();
    hub.add("session", { OPEN: 1, readyState: 1, send: payload => { events.push(payload); }, terminate: () => { throw new Error("Unexpected socket termination"); }, on: () => undefined });
    const store = decisionAnnotations({});
    const attention = new AttentionHints(f.hints, error => { errors.push(error); }, () => new Date("2026-10-15T12:00:00Z"));
    const session: AttentionSession = {
      branch: () => [{ id: "reply", type: "message", message: { role: "assistant" } }],
      messages: () => [{ role: "assistant", content: [{ type: "text", text: "Please review." }] }], awaiting: () => "nothing",
      persist: value => store.write("session", "attention", value),
      publish: () => {
        const hint = attention.read(session);
        hub.publish("session", { type: "status.update", status: { sessionId: "session", isStreaming: false, isCompacting: false, isBashRunning: false,
          pendingMessageCount: 0, queuedMessages: [], tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
          ...(hint === undefined ? {} : { attentionHint: hint }) } });
      },
    };
    try {
      attention.settled(session);
      await vi.waitFor(() => { expect(events).toHaveLength(1); });
      expect(events[0]).toContain("attentionHint"); expect(errors).toEqual([]);
      expect(f.headers).toEqual([`Bearer ${secret}`]);
      expect(JSON.stringify([events, errors, store.values("session"), f.logs])).not.toContain(secret);
    } finally { attention.dispose(); store.close(); }
  });
  it("does not echo damaged credential files in routes, logs, or optional ask errors", async () => {
    const f = await fixture(); await f.change(secret);
    await writeFile(join(f.dir, "decision-gateway.json"), `{"apiKey":"${secret}`);
    const replies = [await f.web.inject(path), await f.daemon.inject("/decision-hints/gateway-key"), await f.web.inject("/api/pi-web/runtime")];
    expect(replies[0]?.statusCode).toBe(500); expect(replies[1]?.statusCode).toBe(500);
    expect(JSON.stringify(replies.map(reply => reply.body))).not.toContain(secret);
    await expect(f.ask()).resolves.toBeUndefined(); expect(f.headers).toEqual([]);
    expect(JSON.stringify(f.logs)).not.toContain(secret);
    expect((await f.change()).status).toBe(200);
  });
  it("validates bodies, same-origin writes and both revision boundaries with safe failures", async () => {
    const f = await fixture();
    for (const body of [{ apiKey: secret }, { revision: "old", apiKey: secret }, ...["", "   ", `${secret}\n`, `${secret}\u007f`, "x".repeat(4097)].map(apiKey => ({ revision: f.catalog.revision, apiKey })), { revision: f.catalog.revision, [secret]: secret }]) {
      const result = await f.web.inject({ method: "POST", url: path, headers: { "content-type": "application/json" }, payload: JSON.stringify(body) });
      expect([400, 409]).toContain(result.statusCode); expect(result.body).not.toContain(secret);
    }
    const cross = await f.web.inject({ method: "POST", url: path, headers: { origin: "https://other.example", "content-type": "application/json" }, payload: { revision: f.catalog.revision, apiKey: secret } });
    expect(cross.statusCode).toBe(403);
    expect((await f.web.inject({ method: "POST", url: path, payload: secret })).statusCode).toBe(415);
    expect((await f.web.inject({ method: "POST", url: path, headers: { "content-type": "application/json" }, payload: secret.repeat(2000) })).statusCode).toBe(413);
    for (const payload of [`{"apiKey":"${secret}`, JSON.stringify({ revision: "stale-profile", apiKey: secret })]) {
      const result = await f.daemon.inject({ method: "POST", url: "/decision-hints/gateway-key", headers: { "content-type": "application/json" }, payload });
      expect([400, 409]).toContain(result.statusCode); expect(result.body).not.toContain(secret);
    }
    expect(f.hints.status()).toEqual({ keyPresent: false, source: "none" });
    expect(JSON.stringify(f.logs)).not.toContain(secret);
  });
});
