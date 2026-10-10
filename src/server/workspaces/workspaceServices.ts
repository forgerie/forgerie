import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Check } from "typebox/value";
import { WorkspaceServicesWaitSchema } from "../../shared/workspaceServices.js";
import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";
import type { WorkspaceServiceAction, WorkspaceServicesLogs, WorkspaceServicesSnapshot, WorkspaceServicesWait, WorkspaceEnvironment } from "../../shared/workspaceServices.js";
import { loadProjectPiWebConfig } from "./projectPiWebConfig.js";
import { pathInside, type SessionWorktreeStore } from "./sessionWorktreeStore.js";
import { ProcessComposeClient } from "./processComposeClient.js";
import { type WorkspaceServicesRecord, WorkspaceServicesStore } from "./workspaceServicesStore.js";
import { LocalWorkspaceServicesLauncher, type WorkspaceServicesLauncher } from "./workspaceServicesLauncher.js";

interface ServicesOptions {
  directory: string; worktrees: SessionWorktreeStore; launcher?: WorkspaceServicesLauncher;
  publish?: (snapshot: WorkspaceServicesSnapshot) => void;
  onError: (error: unknown) => void;
}

export class ManagedWorktreeRequired extends Error {
  constructor() { super("Workspace services require a managed worktree"); }
}

/** Workspace ownership, launch admission and shutdown, shared by HTTP and native Pi tools. */
export class WorkspaceServices {
  private readonly store: WorkspaceServicesStore;
  private readonly launcher: WorkspaceServicesLauncher;
  private readonly client = new ProcessComposeClient();
  private mutations = Promise.resolve();
  private readonly observed = new Map<string, string>();
  private readonly listeners = new Map<string, Set<(snapshot: WorkspaceServicesSnapshot) => void>>();
  private timer: NodeJS.Timeout | undefined;
  private observing: Promise<void> | undefined;
  private closing = false;
  constructor(private readonly options: ServicesOptions) {
    this.store = new WorkspaceServicesStore(options.directory);
    this.launcher = options.launcher ?? new LocalWorkspaceServicesLauncher(options.directory);
  }
  async initialize(): Promise<void> {
    await this.store.initialize();
    try { await this.observe(); } catch (error) { await this.store.dispose(); throw error; }
    this.timer = setInterval(() => { void this.observe().catch(this.options.onError); }, 2000);
    this.timer.unref();
  }
  async dispose(): Promise<void> {
    this.closing = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    try { await this.observing; }
    finally {
      await this.mutations;
      this.listeners.clear();
      await this.store.dispose();
    }
  }
  async forCwd(cwd: string): Promise<string> {
    const path = await realpath(cwd);
    const record = (await this.options.worktrees.list()).find((item) => item.path === path && item.state.kind === "active");
    if (record === undefined) throw new ManagedWorktreeRequired();
    return record.id;
  }
  subscribe(id: string, listener: (snapshot: WorkspaceServicesSnapshot) => void): () => void {
    const set = this.listeners.get(id) ?? new Set();
    set.add(listener); this.listeners.set(id, set);
    return () => { set.delete(listener); if (set.size === 0) this.listeners.delete(id); };
  }
  async status(id: string, signal?: AbortSignal): Promise<WorkspaceServicesSnapshot> {
    const worktree = await this.options.worktrees.require(id);
    const record = this.store.get(id);
    if (record === undefined) {
      const configured = await configuration(worktree);
      return configured === undefined ? { kind: "not-configured", worktreeId: id } : { kind: "stopped", worktreeId: id, ports: {}, stateDirectory: join(this.directory(id), "data") };
    }
    if (record.cwd !== worktree.path) return { kind: "unavailable", worktreeId: id, ports: record.ports, stateDirectory: join(record.directory, "data"), error: "Recorded workspace identity no longer matches the checkout" };
    return this.snapshot(record, signal);
  }
  async action(id: string, input: WorkspaceServiceAction): Promise<WorkspaceServicesSnapshot> {
    return this.exclusive(async () => {
      const worktree = await this.options.worktrees.require(id);
      if (worktree.state.kind !== "active" || worktree.operation !== undefined || worktree.setup.phase !== "done") throw new Error("This worktree is closed, setup is incomplete, or a lifecycle action is running");
      if (input.service === undefined && input.action === "restart") throw new Error("Restart requires a service name. Stop then start to change the project configuration.");
      if (input.service !== undefined) {
        const record = this.requireInstance(id);
        if (record.cwd !== worktree.path) throw new Error("Recorded workspace identity no longer matches the checkout");
        if (input.action === "start" && input.approve !== true) throw new Error("Starting a service requires explicit approval: approve=true.");
        const snapshot = await this.snapshot(record);
        if (snapshot.kind !== "running") throw new Error("Workspace services are not reachable");
        if (!snapshot.processes.some((service) => service.name === input.service)) throw new Error("Service not found");
        await this.client.control(record, input.action, input.service);
      } else if (input.action === "stop") await this.stop(id);
      else await this.start(worktree, input.approve === true);
      const snapshot = await this.status(id); this.publish(snapshot); return snapshot;
    });
  }
  async logs(id: string, service: string, lines: number): Promise<WorkspaceServicesLogs> {
    if (!Number.isSafeInteger(lines) || lines < 1 || lines > 200) throw new Error("lines must be an integer from 1 to 200");
    const record = this.requireInstance(id);
    const snapshot = await this.status(id);
    if (snapshot.kind !== "running" || !snapshot.processes.some((item) => item.name === service)) throw new Error("Service is unavailable or not found");
    return this.client.logs(record, service, lines);
  }
  async wait(id: string, input: WorkspaceServicesWait, signal?: AbortSignal): Promise<{ kind: "ready" | "timeout" | "failed"; snapshot: WorkspaceServicesSnapshot }> {
    if (!Check(WorkspaceServicesWaitSchema, input)) throw new Error("Invalid workspace services readiness deadline");
    const deadline = performance.now() + input.timeoutMs;
    const deadlineSignal = AbortSignal.timeout(input.timeoutMs);
    const requestSignal = signal === undefined ? deadlineSignal : AbortSignal.any([signal, deadlineSignal]);
    let last: WorkspaceServicesSnapshot | undefined;
    for (;;) {
      signal?.throwIfAborted();
      const snapshot = await this.status(id, requestSignal);
      signal?.throwIfAborted();
      if (deadlineSignal.aborted) return { kind: "timeout", snapshot: last ?? snapshot };
      last = snapshot;
      if (snapshot.kind !== "running") return { kind: "failed", snapshot };
      const processes = input.service === undefined ? snapshot.processes : snapshot.processes.filter((item) => item.name === input.service);
      if (processes.length === 0) throw new Error("No services match the readiness wait");
      if (processes.some((item) => item.kind === "failed" || item.kind === "unknown" || item.kind === "stopped")) return { kind: "failed", snapshot };
      // A process without a readiness probe is running, not proven ready.
      if (processes.every((item) => item.kind === "ready" || item.kind === "completed")) return { kind: "ready", snapshot };
      if (performance.now() >= deadline) return { kind: "timeout", snapshot };
      await delay(Math.min(250, Math.max(1, deadline - performance.now())), undefined, { signal });
    }
  }
  /** Called after the worktree's durable input gate, before hooks or checkout deletion. Data stays retained. */
  async beforeRemoval(id: string): Promise<void> { await this.exclusive(() => this.stop(id)); }

  private async start(worktree: SessionWorktreeRecord, approved: boolean): Promise<void> {
    const existing = this.store.get(worktree.id);
    if (existing !== undefined) {
      const snapshot = await this.snapshot(existing);
      if (existing.cwd !== worktree.path) throw new Error("Recorded workspace identity no longer matches the checkout");
      if (snapshot.kind === "running") return;
      if (snapshot.kind === "unavailable") throw new Error(`Cannot replace an unverified service instance: ${snapshot.error}`);
    }
    if (!approved) throw new Error("Starting workspace services executes repository code. Explicit approval is required: approve=true.");
    const configured = await configuration(worktree);
    if (configured === undefined) throw new Error("This worktree has no service definition");
    const prefix = await environmentPrefix(worktree.path, configured.env);
    const directory = this.directory(worktree.id);
    await mkdir(join(directory, "data"), { recursive: true, mode: 0o700 });
    const socket = join(directory, "pc.sock");
    if (Buffer.byteLength(socket) > 100) throw new Error("Workspace services socket path is too long. Use a shorter Forgerie data directory.");
    // Reuse ports after confirmed exit, but never take a port held by another recorded workspace.
    const activeIds = new Set((await this.options.worktrees.list()).filter((item) => item.state.kind === "active").map((item) => item.id));
    const otherPorts = new Set(this.store.list().filter((item) => item.worktreeId !== worktree.id && (item.phase !== "stopped" || activeIds.has(item.worktreeId))).flatMap((item) => Object.values(item.ports)));
    const ports: Record<string, number> = {};
    for (const name of configured.ports) {
      const previous = existing !== undefined && Object.hasOwn(existing.ports, name) ? existing.ports[name] : undefined;
      if (previous !== undefined && !otherPorts.has(previous)) { await availablePort(previous); ports[name] = previous; }
      else {
        let port: number | undefined;
        for (let attempt = 0; attempt < 128; attempt++) {
          const candidate = await availablePort();
          if (!otherPorts.has(candidate)) { port = candidate; break; }
        }
        if (port === undefined) throw new Error("Named-port allocation exceeded its retry limit. Inspect the workspace inventory before retrying.");
        ports[name] = port;
      }
      otherPorts.add(ports[name]);
    }
    const owner = await this.launcher.prepare();
    let record: WorkspaceServicesRecord = { worktreeId: worktree.id, cwd: worktree.path, directory, socket, tokenFile: join(directory, "token"), ports, phase: "launching", ...(owner === undefined ? {} : { owner }) };
    await rm(socket, { force: true });
    await writeFile(record.tokenFile, randomBytes(32).toString("hex"), { mode: 0o600 });
    await this.store.put(record);
    await this.launcher.launch(record, prefix, configured.file, async (nextOwner) => { record = { ...record, owner: nextOwner }; await this.store.put(record); });
    record = { ...record, phase: "started" }; await this.store.put(record);
    const deadline = performance.now() + 30_000;
    for (;;) {
      const snapshot = await this.snapshot(record);
      if (snapshot.kind === "running") return;
      if (snapshot.kind === "stopped" || performance.now() >= deadline) throw new Error("Workspace services did not become reachable. Inspect the retained launcher and supervisor logs before retrying.");
      await delay(100);
    }
  }
  private async stop(id: string): Promise<void> {
    const record = this.store.get(id);
    if (record === undefined) return;
    const snapshot = await this.snapshot(record);
    if (snapshot.kind === "unavailable") throw new Error(`Cannot confirm service shutdown: ${snapshot.error}`);
    if (snapshot.kind === "running") {
      await this.client.stop(record);
      const deadline = performance.now() + 30_000;
      while (record.owner !== undefined && await this.launcher.state(record.owner) !== "exited") {
        if (performance.now() >= deadline) throw new Error("Workspace services shutdown is incomplete. The worktree and service data remain retained.");
        await delay(100);
      }
      if (record.owner === undefined) throw new Error("Cannot confirm service supervisor identity");
    }
    const stopped: WorkspaceServicesRecord = { ...record, phase: "stopped" };
    delete stopped.owner;
    await this.store.put(stopped);
  }
  private async snapshot(record: WorkspaceServicesRecord, signal?: AbortSignal): Promise<WorkspaceServicesSnapshot> {
    const base = { worktreeId: record.worktreeId, ports: record.ports, stateDirectory: join(record.directory, "data") };
    try { return { ...base, kind: "running", processes: await this.client.processes(record, signal) }; }
    catch (error) {
      if (signal?.aborted === true) return { ...base, kind: "unavailable", error: "Service status request was cancelled" };
      if (record.owner !== undefined && await this.launcher.state(record.owner, signal) === "exited") return { ...base, kind: "stopped" };
      if (record.phase === "stopped" && record.owner === undefined) return { ...base, kind: "stopped" };
      return { ...base, kind: "unavailable", error: error instanceof Error ? error.message : String(error) };
    }
  }
  private requireInstance(id: string): WorkspaceServicesRecord { const record = this.store.get(id); if (record === undefined) throw new Error("Workspace services have not started"); return record; }
  private directory(id: string): string { return join(this.options.directory, createHash("sha256").update(id).digest("hex").slice(0, 16)); }
  private observe(): Promise<void> {
    this.observing ??= Promise.all(this.store.list().map(async (record) => { this.publish(await this.snapshot(record)); })).then(() => undefined).finally(() => { this.observing = undefined; });
    return this.observing;
  }
  private publish(snapshot: WorkspaceServicesSnapshot): void {
    const encoded = JSON.stringify(snapshot);
    if (this.observed.get(snapshot.worktreeId) === encoded) return;
    this.observed.set(snapshot.worktreeId, encoded);
    this.options.publish?.(snapshot);
    for (const listener of this.listeners.get(snapshot.worktreeId) ?? []) listener(snapshot);
  }
  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error("Workspace services manager is closing");
    // Serialize inventory mutations across worktrees so named-port allocations cannot race each other.
    const previous = this.mutations;
    let release = (): void => undefined;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    this.mutations = pending; await previous;
    try { return await run(); } finally { release(); }
  }
}

async function configuration(worktree: SessionWorktreeRecord): Promise<{ file: string; ports: string[]; env: WorkspaceEnvironment } | undefined> {
  const loaded = await loadProjectPiWebConfig(worktree.path);
  if (loaded.config.version !== 2) return undefined;
  const services = loaded.config.services;
  if (services === undefined) return undefined;
  const value = typeof services === "string" ? { file: services } : services;
  const root = await realpath(worktree.path);
  const file = await realpath(resolve(root, value.file));
  if (!pathInside(root, file)) throw new Error("Service definition must stay inside its worktree");
  const ports = value.ports ?? [];
  if (value.preview !== undefined && !ports.includes(value.preview)) throw new Error("services.preview must name a declared port");
  return { file, ports, env: loaded.config.env ?? "auto" };
}
async function environmentPrefix(cwd: string, env: WorkspaceEnvironment): Promise<string[]> {
  if (Array.isArray(env)) return env;
  if (env === "none") return [];
  const exists = async (name: string) => { try { await readFile(join(cwd, name)); return true; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; } };
  if (await exists("devenv.nix")) return ["devenv", "shell", "--"];
  if (await exists("flake.nix")) return ["nix", "develop", "-c"];
  if (await exists("shell.nix") || await exists("default.nix")) throw new Error("env:auto requires an explicit argv prefix for legacy Nix shells. Use env:none or a wrapper executable.");
  if (await exists(".envrc")) return ["direnv", "exec", "."];
  if (await exists("mise.toml") || await exists(".tool-versions")) return ["mise", "exec", "--"];
  return [];
}
async function availablePort(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { const address = server.address(); server.close((error) => { if (error !== undefined) reject(error); else if (address === null || typeof address === "string") reject(new Error("Port allocation failed")); else resolve(address.port); }); });
  });
}
