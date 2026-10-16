import type { ManagedProcessInfo, ManagedProcessLogLine, ManagedProcessKillResult, ManagedProcessOutputResult, ManagedProcessesSnapshot, ManagedProcessWriteResult, SessionUiEvent } from "../../shared/apiTypes.js";
import type { ManagedProcesses } from "../processes/managedProcesses.js";
import type { ManagedProcessTools } from "../processes/processTool.js";
import { publicProcess, type PublicProcess } from "../processes/processToolProjection.js";
import { newProcessWatch } from "../processes/processWatchState.js";
import type { ManagedProcessLogCursor } from "../processes/managedProcessLog.js";
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

/** Independent browser read positions do not consume the durable watch reader. */
export class ManagedProcessPanel {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private cursors = new Map<string, ManagedProcessLogCursor>();
  private refreshing: Promise<void> | undefined;
  private current: ManagedProcessesSnapshot = { available: false, writeSupported: false, processes: [] };
  constructor(private readonly core: () => Promise<ManagedProcesses>, private readonly tools: ManagedProcessTools | undefined,
    private readonly publish: (event: SessionUiEvent) => void, private readonly onError: (error: unknown) => void) {}
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
    const tick = async () => {
      try { await this.refresh(); } catch (error) { if (!this.closed) this.onError(error); }
      if (!this.closed) { this.timer = setTimeout(() => { void tick(); }, 1000); this.timer.unref(); }
    };
    void tick();
  }
  refresh(): Promise<void> {
    return this.refreshing ??= this.refreshNow().finally(() => { this.refreshing = undefined; });
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
        this.publish({ type: "processes.output", id: process.id, lines,
          droppedLines: batch.droppedLines + batch.lines.length - lines.length });
      }
    }
    for (const id of this.cursors.keys()) if (!snapshot.processes.some(process => process.id === id)) this.cursors.delete(id);
  }
  async output(id: string, tailLines = 50): Promise<ManagedProcessOutputResult> {
    try {
      const core = await this.core();
      let cursor = { offset: 0, line: 1 };
      let lines: { type: "stdout"; text: string }[] = [];
      for (;;) {
        const batch = await core.readOutput(id, { cursor, maxLines: 1000 });
        lines = [...lines, ...batch.lines.map(line => ({ type: "stdout" as const, text: line.text }))].slice(-Math.max(1, Math.min(200, tailLines)));
        cursor = batch.cursor;
        if (batch.lines.length < 1000) return { ok: true, lines: boundedOutput(lines) };
      }
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
      if (result.kind !== "written") return { ok: false, reason: result.kind === "stdin-full" ? "stdin_full" : "stdin_closed", bytesWritten: result.bytesWritten };
      if (end === true && (await core.closeStdin(id)).kind !== "written") return { ok: false, reason: "stdin_closed", bytesWritten: result.bytesWritten };
      return { ok: true, bytesWritten: result.bytesWritten };
    } catch (error) { if (hasCode(error, "ENOENT")) return { ok: false, reason: "not_found" }; throw error; }
  }
  private isClosed(): boolean { return this.closed; }
  dispose(): void { this.closed = true; clearTimeout(this.timer); }
}

/** Keep the newest output within the browser transport budget. */
function boundedOutput(input: readonly { text: string }[]): ManagedProcessLogLine[] {
  let remaining = 32 * 1024;
  const lines: ManagedProcessLogLine[] = [];
  for (const line of [...input].reverse()) {
    if (remaining <= 0) break;
    const bytes = Buffer.from(line.text);
    const text = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, remaining)), { stream: true });
    remaining -= Buffer.byteLength(text);
    lines.push({ type: "stdout", text });
  }
  return lines.reverse();
}
