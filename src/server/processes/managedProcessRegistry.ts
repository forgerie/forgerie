import type { Dirent } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { hasCode } from "./managedProcessFiles.js";
import { prepareManagedProcessLauncher } from "./managedProcessLauncher.js";
import { ManagedProcesses } from "./managedProcesses.js";
import type { ManagedProcessLauncher } from "./managedProcessTypes.js";

export interface ManagedProcessRegistryOptions {
  stateDirectory: string;
  environment?: NodeJS.ProcessEnv;
  prepareLauncher?: () => Promise<ManagedProcessLauncher>;
  onError(error: unknown, sessionId: string): void;
  intervalMs?: number;
  logCapBytes?: number;
}

/** Sessiond ownership, independent of browser connections and agent runtimes. */
export class ManagedProcessRegistry {
  private readonly owners = new Map<string, Promise<ManagedProcesses>>();
  private readonly closing = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | undefined;
  private maintenance: Promise<void> | undefined;
  private stopped = false;
  constructor(private readonly options: ManagedProcessRegistryOptions) {
    const interval = options.intervalMs ?? 30_000;
    if (!Number.isFinite(interval) || interval <= 0) throw new Error("Managed process maintenance interval must be positive");
  }

  async initialize(isClosed?: (sessionId: string) => Promise<boolean>): Promise<void> {
    let entries: Dirent[];
    try { entries = await readdir(join(this.options.stateDirectory, "managed-processes"), { withFileTypes: true }); }
    catch (error) { if (!hasCode(error, "ENOENT")) throw error; entries = []; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      await this.get(entry.name);
      if (await isClosed?.(entry.name) === true) await this.closeSession(entry.name);
    }
    this.start();
  }

  get(sessionId: string): Promise<ManagedProcesses> {
    if (this.stopped || this.closing.has(sessionId)) return Promise.reject(new Error("Managed process owner is closing"));
    let owner = this.owners.get(sessionId);
    if (owner === undefined) {
      owner = this.open(sessionId);
      this.owners.set(sessionId, owner);
      void owner.catch(() => { if (this.owners.get(sessionId) === owner) this.owners.delete(sessionId); });
      this.start();
    }
    return owner;
  }

  closeSession(sessionId: string): Promise<void> {
    const existing = this.closing.get(sessionId);
    if (existing !== undefined) return existing;
    const owner = this.get(sessionId);
    const closing = (async () => {
      const processes = await owner;
      await processes.closeSession();
      await processes.dispose();
      this.owners.delete(sessionId);
      await rm(join(this.options.stateDirectory, "managed-processes", sessionId), { recursive: true, force: true });
    })();
    this.closing.set(sessionId, closing);
    void closing.then(() => { this.closing.delete(sessionId); }, () => { this.closing.delete(sessionId); });
    return closing;
  }

  async childFinished(sessionId: string, child: { name: string; runId: string }): Promise<void> {
    if (this.closing.has(sessionId)) { await this.closing.get(sessionId); return; }
    const owner = this.owners.get(sessionId);
    if (owner !== undefined) await (await owner).stopChild(child);
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer); this.timer = undefined;
    await this.maintenance;
    await Promise.all(this.closing.values());
    await Promise.all([...this.owners.values()].map(async (owner) => (await owner).dispose()));
    this.owners.clear();
  }

  private async open(sessionId: string): Promise<ManagedProcesses> {
    const launcher = await (this.options.prepareLauncher?.() ?? prepareManagedProcessLauncher(this.options.environment));
    const owner = new ManagedProcesses({ stateDirectory: this.options.stateDirectory, sessionId, launcher,
      ...(this.options.environment === undefined ? {} : { environment: this.options.environment }),
      ...(this.options.logCapBytes === undefined ? {} : { logCapBytes: this.options.logCapBytes }) });
    // A killed daemon's lease stays fresh for ten seconds. Never bypass a live owner.
    const deadline = Date.now() + 15_000;
    for (;;) {
      try { await owner.initialize(); return owner; }
      catch (error) { if (!hasCode(error, "ELOCKED") || Date.now() >= deadline) throw error; await sleep(250); }
    }
  }

  private start(): void {
    if (this.timer !== undefined || this.stopped) return;
    const interval = this.options.intervalMs ?? 30_000;
    this.timer = setInterval(() => {
      if (this.maintenance !== undefined) return;
      this.maintenance = this.maintain().finally(() => { this.maintenance = undefined; });
    }, interval);
    this.timer.unref();
  }
  private async maintain(): Promise<void> {
    for (const [sessionId, owner] of this.owners) {
      if (this.closing.has(sessionId)) continue;
      try { await (await owner).maintain(); }
      catch (error) { this.options.onError(error, sessionId); }
    }
  }
}
