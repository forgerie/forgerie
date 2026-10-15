import type { BrowserFileAccess } from "../browserFileAccess.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { managedProcessEnvironment } from "./managedProcessEnvironment.js";
import { atomicWrite, hasCode, readResult } from "./managedProcessFiles.js";
import { prepareProcessFiles, writeProcessInput } from "./managedProcessIo.js";
import { ManagedProcessLog, type ManagedProcessLogBatch, type ManagedProcessLogCursor, type ManagedProcessLogReadOptions } from "./managedProcessLog.js";
import {
  managedProcessRecordSchema, managedProcessStartSchema, ManagedProcessLaunchError,
  type ManagedProcessInputResult, type ManagedProcessLauncher, type ManagedProcessRecord,
  type ManagedProcessSnapshot, type ManagedProcessStart,
} from "./managedProcessTypes.js";

export interface ManagedProcessesOptions {
  browserFiles?: BrowserFileAccess;
  stateDirectory: string;
  sessionId: string;
  launcher: ManagedProcessLauncher;
  environment?: NodeJS.ProcessEnv;
  logCapBytes?: number;
}

/** One owner per session; dispose releases ownership, not durable managed processes. */
export class ManagedProcesses {
  private readonly directory: string;
  private releaseLock: (() => Promise<void>) | undefined;
  private compromised = false;
  private closed = false;
  private operations = Promise.resolve();
  constructor(private readonly options: ManagedProcessesOptions) {
    managedProcessRecordSchema.shape.sessionId.parse(options.sessionId);
    if (!isAbsolute(options.stateDirectory)) throw new Error("Managed process state directory must be absolute");
    this.directory = join(resolve(options.stateDirectory), "managed-processes", options.sessionId);
  }
  async initialize(): Promise<ManagedProcessSnapshot[]> {
    if (this.releaseLock !== undefined) throw new Error("Managed processes already initialized");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.releaseLock = await lockfile.lock(this.directory, { retries: 0, onCompromised: () => { this.compromised = true; } });
    this.closed = false;
    try { return await this.list(); } catch (error) { await this.dispose(); throw error; }
  }
  start(input: ManagedProcessStart): Promise<ManagedProcessSnapshot> {
    return this.exclusive(async () => {
      if (this.closed) throw new Error("Managed process session is closed");
      const spec = managedProcessStartSchema.parse(input);
      const id = spec.id ?? randomUUID();
      const record = managedProcessRecordSchema.parse({
        version: 1, id, sessionId: this.options.sessionId, directory: join(this.directory, id),
        command: spec.command, cwd: spec.cwd, stopTimeoutSeconds: spec.stopTimeoutSeconds ?? 5,
        createdAt: new Date().toISOString(), supervision: this.options.launcher.supervision,
        child: spec.child, keepAfterChild: spec.keepAfterChild,
        environment: managedProcessEnvironment(this.options.environment ?? process.env),
      });
      // An existing directory is never reused, even after a failed launch.
      await mkdir(record.directory, { mode: 0o700 });
      await prepareProcessFiles(record);
      await atomicWrite(join(record.directory, "command.json"), JSON.stringify(record));
      // Saved intent comes first. A crash or ambiguous launch failure is recovered
      // by inspection, never by retrying the arbitrary command.
      try { await this.options.launcher.launch(record); }
      catch { throw new ManagedProcessLaunchError(id); }
      return this.classify(record);
    });
  }
  list(): Promise<ManagedProcessSnapshot[]> {
    return this.exclusive(() => this.snapshots());
  }
  setKeepAfterChild(id: string, keep: boolean): Promise<void> {
    return this.exclusive(async () => {
      const record = managedProcessRecordSchema.parse({ ...await this.record(id), keepAfterChild: keep });
      await atomicWrite(join(record.directory, "command.json"), JSON.stringify(record));
    });
  }
  stopChild(child: { name: string; runId: string }): Promise<void> {
    return this.exclusive(async () => {
      for (const record of await this.snapshots()) {
        if (record.state.kind === "running" && record.child?.name === child.name && record.child.runId === child.runId && record.keepAfterChild !== true) await this.options.launcher.stop(record);
      }
    });
  }
  clearFinished(): Promise<string[]> { return this.exclusive(() => this.removeFinished(0)); }
  /** No writes can race the stop, confirmation, and record deletion. A failed stop retains the evidence. */
  closeSession(): Promise<void> {
    return this.exclusive(async () => {
      this.closed = true;
      await this.options.launcher.stopSession(this.options.sessionId);
      const records = await this.snapshots();
      const deadline = Date.now() + Math.max(5, ...records.map((record) => record.stopTimeoutSeconds)) * 1000 + 10_000;
      while ((await this.snapshots()).some((record) => record.state.kind === "running")) {
        if (Date.now() >= deadline) throw new Error("Managed processes did not stop; session records were retained");
        await sleep(50);
      }
      // Keep the leased directory until disposal. Remove incomplete preparation folders too.
      for (const entry of await readdir(this.directory)) await rm(join(this.directory, entry), { recursive: true, force: true });
    });
  }
  status(id: string): Promise<ManagedProcessSnapshot> { return this.exclusive(async () => this.classify(await this.record(id))); }
  stop(id: string): Promise<void> { return this.exclusive(async () => { await this.options.launcher.stop(await this.record(id)); }); }
  /** Initiates session close; caller polls list() until no record is running before deletion. */
  stopSession(): Promise<void> { return this.exclusive(() => this.options.launcher.stopSession(this.options.sessionId)); }
  writeStdin(id: string, data: string | Buffer): Promise<ManagedProcessInputResult> {
    return this.exclusive(async () => writeProcessInput((await this.record(id)).directory, Buffer.isBuffer(data) ? data : Buffer.from(data)));
  }
  closeStdin(id: string): Promise<ManagedProcessInputResult> {
    return this.exclusive(async () => writeProcessInput((await this.record(id)).directory, "eof"));
  }
  readOutput(id: string, options?: ManagedProcessLogReadOptions): Promise<ManagedProcessLogBatch> {
    return this.exclusive(async () => {
      const snapshot = await this.classify(await this.record(id));
      return this.log(snapshot).read(snapshot.state.kind !== "running", options);
    });
  }
  /** Acknowledge only after consumers durably accepted the returned batch. */
  acknowledgeOutput(id: string, cursor: ManagedProcessLogCursor): Promise<void> {
    return this.exclusive(async () => { await this.log(await this.record(id)).acknowledge(cursor); });
  }
  /** Only IDs whose terminal events are durably spooled may be reclaimed. Exits after that scan wait for the next pass. */
  maintain(spooledFinished: readonly string[] = []): Promise<void> {
    return this.exclusive(async () => {
      await this.removeFinished(50, new Set(spooledFinished));
      for (const record of await this.snapshots()) await this.log(record).maintain();
    });
  }
  async dispose(): Promise<void> {
    await this.operations;
    try {
      if (this.options.launcher.supervision.kind === "attached") await this.options.launcher.stopSession(this.options.sessionId);
    } finally { const release = this.releaseLock; this.releaseLock = undefined; await release?.(); }
  }
  private async snapshots(): Promise<ManagedProcessSnapshot[]> {
    const snapshots: ManagedProcessSnapshot[] = [];
    for (const entry of (await readdir(this.directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      let record: ManagedProcessRecord;
      try { record = await this.record(entry.name); }
      catch (error) { if (hasCode(error, "ENOENT")) continue; throw error; }
      snapshots.push(await this.classify(record));
    }
    return snapshots;
  }
  private async removeFinished(keep: number, spooled?: ReadonlySet<string>): Promise<string[]> {
    const finished = [];
    for (const record of await this.snapshots()) {
      if (record.state.kind === "running") continue;
      const endedAt = (await stat(join(record.directory, record.state.kind === "ended" ? "result" : "lost.json"))).mtimeMs;
      finished.push({ record, endedAt });
    }
    finished.sort((a, b) => a.endedAt - b.endedAt || a.record.createdAt.localeCompare(b.record.createdAt) || a.record.id.localeCompare(b.record.id));
    const removed = finished.filter(({ record }) => spooled === undefined || spooled.has(record.id)).slice(0, Math.max(0, finished.length - keep));
    for (const { record } of removed) await rm(record.directory, { recursive: true, force: true });
    return removed.map(({ record }) => record.id);
  }
  private log(record: ManagedProcessRecord): ManagedProcessLog { return new ManagedProcessLog(record.directory, this.options.logCapBytes, this.options.browserFiles); }
  private async record(id: string): Promise<ManagedProcessRecord> {
    managedProcessRecordSchema.shape.id.parse(id);
    const directory = join(this.directory, id);
    const record = managedProcessRecordSchema.parse(JSON.parse(await readFile(join(directory, "command.json"), "utf8")));
    if (record.id !== id || record.sessionId !== this.options.sessionId || record.directory !== directory) throw new Error("Managed process record identity mismatch");
    return record;
  }
  private async classify(record: ManagedProcessRecord): Promise<ManagedProcessSnapshot> {
    const result = await readResult(record.directory);
    if (result !== undefined) { await this.options.launcher.release(record); return { ...record, state: { kind: "ended", result } }; }
    try {
      const lost: unknown = JSON.parse(await readFile(join(record.directory, "lost.json"), "utf8"));
      if (lost !== true) throw new Error("Invalid lost process record");
      return { ...record, state: { kind: "lost" } };
    } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
    if (await this.options.launcher.inspect(record) === "running") return { ...record, state: { kind: "running" } };
    // ExecStopPost can publish between the first read and unit inspection.
    const finalResult = await readResult(record.directory);
    if (finalResult !== undefined) { await this.options.launcher.release(record); return { ...record, state: { kind: "ended", result: finalResult } }; }
    await atomicWrite(join(record.directory, "lost.json"), "true");
    await this.options.launcher.release(record);
    return { ...record, state: { kind: "lost" } };
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(() => {
      if (this.releaseLock === undefined || this.compromised) throw new Error("Managed process session lock is unavailable");
      return operation();
    });
    this.operations = result.then(() => undefined, () => undefined);
    return result;
  }
}
