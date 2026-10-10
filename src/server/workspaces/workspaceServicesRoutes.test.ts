import http from "node:http";
import { join } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { expect, it, vi } from "vitest";
import { Check } from "typebox/value";
import { WorkspaceServicesSnapshotSchema, WorkspaceServicesLogsSchema } from "../../shared/workspaceServices.js";
import { SessionDaemonClient } from "../../sessiond/sessionDaemonClient.js";
import { registerSessionProxyRoutes } from "../sessiond/sessionProxyRoutes.js";
import { registerWorkspaceServicesRoutes } from "./workspaceServicesRoutes.js";
import { ConfiguredServicesLauncher, servicesFixture } from "./workspaceServices.testSupport.js";

async function proxyFixture(transport: "socket" | "http") {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  const daemon = Fastify(); const proxy = Fastify();
  registerWorkspaceServicesRoutes(daemon, f.services);
  const socket = join(f.root, "daemon.sock");
  let listening = false;
  try {
    const endpoint = transport === "socket" ? await daemon.listen({ path: socket }) : await daemon.listen({ host: "127.0.0.1", port: 0 });
    listening = true;
    vi.stubEnv("PI_WEB_SESSIOND_SOCKET", socket);
    vi.stubEnv("PI_WEB_SESSIOND_URL", transport === "http" ? endpoint : undefined);
    await proxy.register(websocket); registerSessionProxyRoutes(proxy, new SessionDaemonClient());
    const record = await f.add("one");
    return { ...f, record, launcher, proxy, async dispose() { await proxy.close(); await daemon.close(); vi.unstubAllEnvs(); await f.dispose(); } };
  } catch (error) {
    await proxy.close(); if (listening) await daemon.close(); vi.unstubAllEnvs(); await f.dispose(); throw error;
  }
}

it.each(["socket", "http"] as const)("forwards workspace-service snapshots, controls, logs and waits through the web proxy over %s", async (transport) => {
  const f = await proxyFixture(transport); const url = `/api/sessions/worktrees/${f.record.id}/services`;
  try {
    const stopped = await f.proxy.inject(url);
    const snapshot: unknown = stopped.json();
    expect(stopped.statusCode).toBe(200); expect(Check(WorkspaceServicesSnapshotSchema, snapshot)).toBe(true);
    expect(snapshot).toMatchObject({ kind: "stopped", worktreeId: f.record.id });
    expect((await f.proxy.inject({ method: "POST", url, payload: { action: "start", approve: true } })).statusCode).toBe(200);
    const logs = await f.proxy.inject(`${url}/logs?service=web&lines=5`);
    const output: unknown = logs.json();
    expect(logs.statusCode).toBe(200);
    if (!Check(WorkspaceServicesLogsSchema, output)) throw new Error("Invalid service logs response");
    expect(output.truncated).toBe(true); expect(output.logs.at(-1)).toBe("last line");
    expect(Buffer.byteLength(output.logs.join("\n"))).toBeLessThanOrEqual(32 * 1024);
    expect((await f.proxy.inject(`${url}/logs?service=web&lines=5&extra=bad`)).statusCode).toBe(400);
    expect((await f.proxy.inject({ method: "POST", url: `${url}/wait`, payload: { timeoutMs: 1000, service: "web" } })).json()).toMatchObject({ kind: "ready" });
    expect((await f.proxy.inject({ method: "POST", url, payload: { action: "restart", service: "web" } })).statusCode).toBe(200);
    expect((await f.proxy.inject({ method: "POST", url, payload: { action: "stop" } })).statusCode).toBe(200);
  } finally { await f.dispose(); }
});

it.each(["socket", "http"] as const)("cancels a pending readiness request when the browser disconnects over %s", async (transport) => {
  const f = await proxyFixture(transport);
  let request: http.ClientRequest | undefined;
  try {
    await f.services.action(f.record.id, { action: "start", approve: true });
    f.launcher.statusDelayMs = 10_000;
    const endpoint = await f.proxy.listen({ host: "127.0.0.1", port: 0 });
    const payload = JSON.stringify({ timeoutMs: 120_000 });
    request = http.request(new URL(`/api/sessions/worktrees/${f.record.id}/services/wait`, endpoint), {
      method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (response) => { response.resume(); });
    request.on("error", () => undefined);
    const closed = new Promise<void>((resolve) => { request?.once("close", resolve); });
    request.end(payload);
    await vi.waitFor(() => { expect(f.launcher.pendingProcesses).toBeGreaterThan(0); });
    request.destroy(); await closed;
    await vi.waitFor(() => { expect(f.launcher.pendingProcesses).toBe(0); });
    expect(f.launcher.alive).toBe("alive");
  } finally { request?.destroy(); f.launcher.statusDelayMs = 0; await f.dispose(); }
});
