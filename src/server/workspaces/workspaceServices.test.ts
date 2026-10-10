import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceServices } from "./workspaceServices.js";
import { ConfiguredServicesLauncher, servicesFixture } from "./workspaceServices.testSupport.js";
import { registerWorkspaceServicesRoutes } from "./workspaceServicesRoutes.js";

it("requires execution approval, serializes duplicate starts and publishes bounded state without tokens", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one");
    await expect(f.services.action(record.id, { action: "start" })).rejects.toThrow("approval");
    const snapshots = await Promise.all([f.services.action(record.id, { action: "start", approve: true }), f.services.action(record.id, { action: "start", approve: true })]);
    expect(launcher.launches).toBe(1);
    expect(snapshots[0]).toMatchObject({ kind: "running", processes: [{ name: "web", kind: "ready" }] });
    expect(JSON.stringify(snapshots)).not.toContain("token");
    expect(f.events).toHaveLength(1);
    expect(await f.services.logs(record.id, "web", 10)).toMatchObject({ truncated: true });
    expect(JSON.stringify(await f.services.logs(record.id, "web", 10)).length).toBeLessThan(34 * 1024);
  } finally { await f.dispose(); }
});

it("reattaches after manager disposal without starting a second instance", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  let resumed: WorkspaceServices | undefined;
  try {
    const record = await f.add("one");
    await f.services.action(record.id, { action: "start", approve: true });
    await f.services.dispose();
    expect(launcher.alive).toBe("alive");
    resumed = new WorkspaceServices({ directory: f.directory, worktrees: f.store, launcher, onError: () => undefined });
    await resumed.initialize();
    expect(await resumed.action(record.id, { action: "start" })).toMatchObject({ kind: "running" });
    expect(launcher.launches).toBe(1);
    await resumed.beforeRemoval(record.id);
    expect(await resumed.status(record.id)).toMatchObject({ kind: "stopped" });
    await expect(readFile(join(f.directory, "instances.json"), "utf8")).resolves.toContain('"stopped"');
  } finally { await resumed?.dispose(); await launcher.dispose(); await f.dispose(); }
});

it("keeps live or unverifiable instances unavailable and blocks replacement and cleanup", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one"); await f.services.action(record.id, { action: "start", approve: true });
    launcher.reachable = false;
    for (const state of ["alive", "unknown"] as const) {
      launcher.alive = state;
      expect(await f.services.status(record.id)).toMatchObject({ kind: "unavailable" });
      await expect(f.services.action(record.id, { action: "start", approve: true })).rejects.toThrow("unverified");
      await expect(f.services.beforeRemoval(record.id)).rejects.toThrow("Cannot confirm");
    }
    expect(launcher.launches).toBe(1);
    launcher.reachable = true;
  } finally { await f.dispose(); }
});

it("distinguishes readiness deadlines, failures and cancellation", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one"); await f.services.action(record.id, { action: "start", approve: true });
    launcher.ready = false;
    expect(await f.services.wait(record.id, { timeoutMs: 1 })).toMatchObject({ kind: "timeout" });
    launcher.ready = true;
    expect(await f.services.wait(record.id, { timeoutMs: 1000 })).toMatchObject({ kind: "ready" });
    const controller = new AbortController(); controller.abort();
    await expect(f.services.wait(record.id, { timeoutMs: 1000 }, controller.signal)).rejects.toThrow();
    launcher.reachable = false;
    expect(await f.services.wait(record.id, { timeoutMs: 1000 })).toMatchObject({ kind: "failed" });
    launcher.reachable = true;
  } finally { await f.dispose(); }
});

it("allocates a newly declared constructor port without reading inherited object properties", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one");
    await f.services.action(record.id, { action: "start", approve: true });
    await f.services.action(record.id, { action: "stop" });
    await writeFile(join(record.path, ".forgerie/config.json"), JSON.stringify({ version: 2, env: "none", services: { file: "process-compose.yaml", ports: ["constructor"] } }));
    const snapshot = await f.services.action(record.id, { action: "start", approve: true });
    if (snapshot.kind !== "running") throw new Error("Service did not start");
    expect(snapshot.ports.constructor).toBeTypeOf("number"); expect(launcher.launches).toBe(2);
  } finally { await f.dispose(); }
});

it("releases inventory ownership when initial snapshot publication fails", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  let resumed: WorkspaceServices | undefined;
  try {
    const record = await f.add("one"); await f.services.action(record.id, { action: "start", approve: true });
    await f.services.dispose();
    const failed = new WorkspaceServices({ directory: f.directory, worktrees: f.store, launcher,
      publish: () => { throw new Error("Configured publication failure"); }, onError: (error) => { throw error; } });
    await expect(failed.initialize()).rejects.toThrow("Configured publication failure");
    resumed = new WorkspaceServices({ directory: f.directory, worktrees: f.store, launcher, onError: (error) => { throw error; } });
    await resumed.initialize();
    expect(await resumed.status(record.id)).toMatchObject({ kind: "running" }); expect(launcher.launches).toBe(1);
    await resumed.beforeRemoval(record.id);
  } finally { await resumed?.dispose(); await f.dispose(); }
});

it("finishes admitted launches but rejects new mutations during disposal and leaves services alive", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  let resumed: WorkspaceServices | undefined;
  try {
    const record = await f.add("one");
    const admitted = f.services.action(record.id, { action: "start", approve: true });
    const closing = f.services.dispose();
    await expect(f.services.action(record.id, { action: "start", approve: true })).rejects.toThrow("manager is closing");
    await admitted; await closing;
    resumed = new WorkspaceServices({ directory: f.directory, worktrees: f.store, launcher, onError: (error) => { throw error; } });
    await resumed.initialize();
    expect(await resumed.status(record.id)).toMatchObject({ kind: "running" });
    expect(launcher.launches).toBe(1);
    await resumed.beforeRemoval(record.id);
  } finally { await resumed?.dispose(); await f.dispose(); }
});

it("enforces a readiness deadline and cancellation while the control request is still pending", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one"); await f.services.action(record.id, { action: "start", approve: true });
    launcher.statusDelayMs = 10_000;
    const began = performance.now();
    expect(await f.services.wait(record.id, { timeoutMs: 30 })).toMatchObject({ kind: "timeout" });
    expect(performance.now() - began).toBeLessThan(1000);
    const reads = launcher.processReads;
    const controller = new AbortController();
    const pending = f.services.wait(record.id, { timeoutMs: 1000 }, controller.signal);
    await vi.waitFor(() => { expect(launcher.processReads).toBeGreaterThan(reads); });
    controller.abort();
    await expect(pending).rejects.toThrow();
  } finally { launcher.statusDelayMs = 0; await f.dispose(); }
});

it("gates closed worktrees and rejects symlink escapes before launching code", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one");
    await mkdir(join(f.root, "outside")); await writeFile(join(f.root, "outside/pc.yaml"), "version: '0.5'");
    await symlink(join(f.root, "outside/pc.yaml"), join(record.path, "escaped.yaml"));
    await writeFile(join(record.path, ".forgerie/config.json"), JSON.stringify({ version: 2, services: "escaped.yaml" }));
    await expect(f.services.action(record.id, { action: "start", approve: true })).rejects.toThrow("inside");
    expect(launcher.launches).toBe(0);
    await f.store.update(record.id, { operation: "land" });
    await expect(f.services.action(record.id, { action: "start", approve: true })).rejects.toThrow("lifecycle");
  } finally { await f.dispose(); }
});

it("exposes manager operations through validated HTTP", async () => {
  const launcher = new ConfiguredServicesLauncher(); const f = await servicesFixture(launcher);
  const app = Fastify(); registerWorkspaceServicesRoutes(app, f.services);
  try {
    const record = await f.add("one"); const url = `/sessions/worktrees/${record.id}/services`;
    expect((await app.inject({ method: "POST", url, payload: { action: "start" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url, payload: { action: "explode" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, payload: { action: "start", approve: true } })).statusCode).toBe(200);
    expect((await app.inject(`${url}/logs?service=web&lines=0`)).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${url}/wait`, payload: { timeoutMs: 120001 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${url}/wait`, payload: { timeoutMs: 100 } })).json()).toMatchObject({ kind: "ready" });
    expect((await app.inject({ method: "POST", url, payload: { action: "restart", service: "web" } })).statusCode).toBe(200);
  } finally { await app.close(); await f.dispose(); }
});

it.each([
  ["Pending", 0, "waiting"], ["Launching", 0, "waiting"], ["Completed", 0, "completed"], ["Completed", 7, "failed"],
  ["Disabled", 0, "stopped"], ["Stopped", 0, "stopped"], ["Error", 7, "failed"], ["Restarting", 0, "starting"], ["future-status", 0, "unknown"],
] as const)("normalizes Process Compose %s with exit %i as %s", async (status, code, kind) => {
  const launcher = new ConfiguredServicesLauncher(); launcher.status = status; launcher.exitCode = code;
  const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one");
    expect(await f.services.action(record.id, { action: "start", approve: true })).toMatchObject({ kind: "running", processes: [{ name: "web", kind }] });
  } finally { await f.dispose(); }
});

it("does not claim readiness without a probe and bounds malformed or excessive responses", async () => {
  const launcher = new ConfiguredServicesLauncher(); launcher.hasProbe = false;
  const f = await servicesFixture(launcher);
  try {
    const record = await f.add("one");
    expect(await f.services.action(record.id, { action: "start", approve: true })).toMatchObject({ processes: [{ kind: "running" }] });
    expect(await f.services.wait(record.id, { timeoutMs: 1 })).toMatchObject({ kind: "timeout" });
    launcher.logCharacter = "𝄞";
    const bounded = await f.services.logs(record.id, "web", 5);
    expect(Buffer.byteLength(bounded.logs.join("\n"), "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(bounded.logs.join("\n")).not.toContain("\ufffd");
    launcher.logCharacters = 2 * 1024 * 1024;
    await expect(f.services.logs(record.id, "web", 5)).rejects.toThrow("exceeded 1 MiB");
    launcher.invalidResponse = true;
    expect(await f.services.status(record.id)).toMatchObject({ kind: "unavailable", error: "Invalid Process Compose process response" });
    launcher.invalidResponse = false;
    await expect(f.services.action(record.id, { action: "restart" })).rejects.toThrow("service name");
    await expect(f.services.action(record.id, { action: "restart", service: "missing" })).rejects.toThrow("not found");
  } finally { await f.dispose(); }
});

describe("inventory admission", () => {
  it("refuses a second manager for the same inventory", async () => {
    const f = await servicesFixture(new ConfiguredServicesLauncher());
    const other = new WorkspaceServices({ directory: f.directory, worktrees: f.store, onError: () => undefined });
    try { await expect(other.initialize()).rejects.toThrow("already being held"); }
    finally { await f.dispose(); }
  });
});
