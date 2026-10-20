import type { ManagedProcessInfo, ManagedProcessLogLine, ManagedProcessKillResult, ManagedProcessOutputResult, ManagedProcessesSnapshot, ManagedProcessWriteResult, SessionUiEvent } from "../../shared/apiTypes.js";
import type { ManagedProcesses } from "../processes/managedProcesses.js";
import type { ManagedProcessTools } from "../processes/processTool.js";
import { publicProcess, type PublicProcess } from "../processes/processToolProjection.js";
import { newProcessWatch } from "../processes/processWatchState.js";
import type { ManagedProcessLogBatch, ManagedProcessLogCursor } from "../processes/managedProcessLog.js";
import { hasCode } from "../processes/managedProcessFiles.js";

/** Browser projection only: never publish launch records, environment, or log paths. */
function browserProcess(process: PublicProcess): ManagedProcessInfo {
  return {
    id: process.id, name: process.name, command: process.command, cwd: process.cwd,
    pid: 0, startTime: process.startTime, endTime: null, status: process.status,
    success: process.state === "running" ? null : process.success,
    exitCode: process.exitCode ?? null,
    endReason: process.reason === "supervisor lost" ? "lost" : process.state === "running" ? null : process.signal != null ? "signal" : "exit",
    signal: process.signal != null ? { name: process.signal, number: null, description: process.signal } : null,
    errorMessage: process.reason ?? null,
    supervision: process.supervision,
    ...(process.notice === undefined ? {} : { notice: process.notice }),
  };
}

interface ManagedProcessPanelOptions {
  activeIntervalMs?: number;
  idleIntervalMs?: number;
}

/** Independent browser read positions do not consume the durable watch reader. */
export class ManagedProcessPanel {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private watching = false;
  private unsubscribe: (() => void) | undefined;
  private cursors = new Map<string, ManagedProcessLogCursor>();
  private refreshing: Promise<void> | undefined;
  private current: ManagedProcessesSnapshot = { available: false, writeSupported: false, processes: [] };
  constructor(private readonly core: () => Promise<ManagedProcesses>, private readonly tools: ManagedProcessTools | undefined,
    private readonly publish: (event: SessionUiEvent) => void, private readonly onError: (error: unknown) => void,
    private readonly options: ManagedProcessPanelOptions = {}) {}
  get runningCount(): number { return this.current.processes.filter(process => process.status === "running" || process.status === "terminating").length; }
  async snapshot(): Promise<ManagedProcessesSnapshot> {
    const processes = this.tools === undefined
      ? (await (await this.core()).list()).map(snapshot => publicProcess(snapshot, newProcessWatch(snapshot.id)))
      : (await this.tools.execute({ action: "list" })).processes;
    if (processes === undefined) throw new Error("Could not read managed processes");
    const core = await this.core();
    const items = await Promise.all(processes.map(async process => {
      try { return { ...browserProcess(process), lastLogLine: await core.lastOutput(process.id) }; }
      catch (error) {
        if (hasCode(error, "ENOENT")) {
          // Clear/retention can remove a listed record. Missing output for an existing record is still an error.
          try { await core.status(process.id); }
          catch (inspection) { if (hasCode(inspection, "ENOENT")) return undefined; throw inspection; }
        }
        throw error;
      }
    }));
    return { available: true, writeSupported: true, processes: items.filter(item => item !== undefined) };
  }
  watch(): void {
    if (this.watching || this.closed) return;
    this.watching = true;
    this.unsubscribe = this.tools?.onChange(() => this.refreshAfterMutation());
    void this.refresh().catch((error: unknown) => { if (!this.closed) this.onError(error); });
  }
  private async refreshAfterMutation(): Promise<void> {
    try {
      // An in-flight snapshot may predate the mutation. Finish it before requesting a fresh one.
      await this.refreshing;
      if (!this.closed) await this.refresh();
    } catch (error) { if (!this.closed) this.onError(error); }
  }
  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.watching || this.closed) return;
    const interval = this.runningCount > 0 ? this.options.activeIntervalMs ?? 1000 : this.options.idleIntervalMs ?? 10_000;
    this.timer = setTimeout(() => {
      void this.refresh().catch((error: unknown) => { if (!this.closed) this.onError(error); });
    }, interval);
    this.timer.unref();
  }
  refresh(): Promise<void> {
    return this.refreshing ??= this.refreshNow().finally(() => {
      this.refreshing = undefined;
      this.schedule();
    });
  }
  private async refreshNow(): Promise<void> {
    const snapshot = await this.snapshot();
    if (this.isClosed()) return;
    if (JSON.stringify(snapshot) !== JSON.stringify(this.current)) {
      this.current = snapshot;
      this.publish({ type: "processes.update", snapshot });
    }
    const core = await this.core();
    for (const process of snapshot.processes) {
      const batch = await core.readOutput(process.id, { cursor: this.cursors.get(process.id) ?? { offset: 0, line: 1 }, maxLines: 200 });
      if (this.isClosed()) return;
      this.cursors.set(process.id, batch.cursor);
      if (batch.lines.length > 0 || batch.droppedLines > 0) {
        const lines = boundedOutput(batch.lines);
        this.publish({ type: "processes.output", id: process.id, lines, cursor: batch.cursor,
          droppedLines: batch.droppedLines + batch.lines.length - lines.length });
      }
    }
    for (const id of this.cursors.keys()) if (!snapshot.processes.some(process => process.id === id)) this.cursors.delete(id);
  }
  async output(id: string, tailLines = 50): Promise<ManagedProcessOutputResult> {
    try {
      const { lines, cursor, droppedLines } = await (await this.core()).readTail(id, Math.max(1, Math.min(200, tailLines)));
      const bounded = boundedOutput(lines);
      return { ok: true, lines: bounded, cursor, droppedLines: droppedLines + lines.length - bounded.length };
    } catch (error) { if (hasCode(error, "ENOENT")) return { ok: false, reason: "not_found" }; throw error; }
  }
  async kill(id: string): Promise<ManagedProcessKillResult> {
    const found = (await this.snapshot()).processes.find(process => process.id === id);
    if (found === undefined) return { ok: false, reason: "not_found" };
    if (this.tools !== undefined) {
      const result = await this.tools.execute({ action: "stop", id });
      if (result.error !== undefined) return { ok: false, reason: "error" };
    } else await (await this.core()).stop(id);
    await this.refresh();
    return { ok: true, process: (await this.snapshot()).processes.find(process => process.id === id) ?? found };
  }
  async write(id: string, input: string, end?: boolean): Promise<ManagedProcessWriteResult> {
    const core = await this.core();
    try {
      if ((await core.status(id)).state.kind !== "running") return { ok: false, reason: "process_exited" };
      const result = await core.writeStdin(id, input);
      const eof = end === true && result.kind === "written" ? await core.closeStdin(id) : undefined;
      await this.refreshAfterMutation();
      if (result.kind !== "written") return { ok: false, reason: result.kind === "stdin-full" ? "stdin_full" : "stdin_closed", bytesWritten: result.bytesWritten };
      if (eof !== undefined && eof.kind !== "written") return { ok: false, reason: "stdin_closed", bytesWritten: result.bytesWritten };
      return { ok: true, bytesWritten: result.bytesWritten };
    } catch (error) { if (hasCode(error, "ENOENT")) return { ok: false, reason: "not_found" }; throw error; }
  }
  private isClosed(): boolean { return this.closed; }
  dispose(): void { this.closed = true; clearTimeout(this.timer); this.unsubscribe?.(); }
}

/** Keep the newest output within the browser transport budget. */
function boundedOutput(input: ManagedProcessLogBatch["lines"]): ManagedProcessLogLine[] {
  let remaining = 32 * 1024;
  const lines: ManagedProcessLogLine[] = [];
  for (const line of [...input].reverse()) {
    if (remaining <= 0) break;
    const bytes = Buffer.from(line.text);
    let start = Math.max(0, bytes.length - remaining);
    // A suffix may start inside a UTF-8 code point. Do not publish a broken prefix.
    while (start < bytes.length) {
      const byte = bytes[start];
      if (byte === undefined || (byte & 0xc0) !== 0x80) break;
      start++;
    }
    if (start === bytes.length && bytes.length > 0) break;
    const text = bytes.subarray(start).toString("utf8");
    remaining -= Buffer.byteLength(text);
    lines.push({ type: "stdout", text, number: line.number, terminated: line.terminated,
      truncatedStart: line.truncatedStart || start > 0 });
  }
  return lines.reverse();
}
