import type { EventBus, ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import type {
  ManagedProcessEndReason,
  ManagedProcessInfo,
  ManagedProcessKillResult,
  ManagedProcessLogLine,
  ManagedProcessOutputResult,
  ManagedProcessesSnapshot,
  ManagedProcessSignal,
  ManagedProcessStatus,
  ManagedProcessWriteResult,
  SessionUiEvent,
} from "../../shared/apiTypes.js";

/** Pinned to @aliou/pi-processes v0.10.4 plus the local COMMAND_WRITE patch. */
const CHANNELS = {
  requestConfig: "processes:request:config",
  requestList: "processes:request:list",
  requestOutput: "processes:request:combined_output",
  commandKill: "processes:command:kill",
  commandWrite: "processes:command:write",
  changed: "processes:changed",
  outputChanged: "processes:output_changed",
} as const;

const WRITE_PROBE_ID = "__forgerie_capability_probe__";
const DEFAULT_TAIL_LINES = 50;
const MAX_TAIL_LINES = 200;
const OUTPUT_FLUSH_MS = 250;
const MAX_OUTPUT_LINES = 200;
const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_PENDING_KILLS = 10;

export type ProcessBridgePublisher = (event: SessionUiEvent) => void;

export interface ProcessBridgeSlot {
  attach(events: EventBus): () => void;
  setPublisher(publisher: ProcessBridgePublisher | undefined): void;
  snapshot(): ManagedProcessesSnapshot;
  output(id: string, tailLines?: number): ManagedProcessOutputResult;
  kill(id: string, options?: { signal?: NodeJS.Signals; timeoutMs?: number }): Promise<ManagedProcessKillResult>;
  write(id: string, input: string, options?: { end?: boolean }): ManagedProcessWriteResult;
  dispose(): void;
}

export function createProcessBridgeSlot(): ProcessBridgeSlot {
  let current: ProcessBridgeConnection | undefined;
  let publisher: ProcessBridgePublisher | undefined;

  const attach = (events: EventBus): (() => void) => {
    current?.dispose();
    const attached = new ProcessBridgeConnection(events, (event) => {
      try {
        publisher?.(event);
      } catch {
        // Browser publication must never break the shared extension EventBus.
      }
    });
    current = attached;
    attached.publishSnapshot();
    return () => {
      if (current !== attached) return;
      attached.dispose();
      current = undefined;
    };
  };

  return {
    attach,
    setPublisher(nextPublisher) {
      publisher = nextPublisher;
      current?.publishSnapshot();
    },
    snapshot: () => current?.snapshot() ?? unavailableSnapshot(),
    output: (id, tailLines) => current?.output(id, tailLines) ?? { ok: false, reason: "unavailable" },
    kill: (id, options) => current?.kill(id, options) ?? Promise.resolve({ ok: false, reason: "unavailable" }),
    write: (id, input, options) => current?.write(id, input, options) ?? { ok: false, reason: "unavailable" },
    dispose() {
      current?.dispose();
      current = undefined;
      publisher = undefined;
    },
  };
}

export function createProcessBridgeExtension(slot: ProcessBridgeSlot): InlineExtension {
  return {
    name: "forgerie-processes-bridge",
    hidden: true,
    factory(pi: ExtensionAPI) {
      const detach = slot.attach(pi.events);
      pi.on("session_shutdown", () => {
        detach();
      });
    },
  };
}

class ProcessBridgeConnection {
  private readonly disposers: (() => void)[];
  private readonly pendingOutput = new Map<string, PendingOutput>();
  private readonly pendingKills = new Set<PendingKill>();
  private readonly writeSupported: boolean;
  private disposed = false;

  constructor(
    private readonly events: EventBus,
    private readonly publish: ProcessBridgePublisher,
  ) {
    this.writeSupported = this.probeWriteSupport();
    this.disposers = [
      events.on(CHANNELS.changed, (payload) => {
        if (!isChangedPayload(payload)) return;
        this.publishSnapshot();
      }),
      events.on(CHANNELS.outputChanged, (payload) => {
        const delta = parseOutputDelta(payload);
        if (delta !== undefined) this.queueOutput(delta);
      }),
    ];
  }

  snapshot(): ManagedProcessesSnapshot {
    if (this.disposed || !requestReplied(this.events, CHANNELS.requestConfig)) return unavailableSnapshot();
    const response = requestValue(this.events, CHANNELS.requestList, {});
    const processes = parseProcessList(response.value);
    if (!response.replied || processes === undefined) return unavailableSnapshot();
    return { available: true, writeSupported: this.writeSupported, processes };
  }

  publishSnapshot(): void {
    if (this.disposed) return;
    try {
      this.publish({ type: "processes.update", snapshot: this.snapshot() });
    } catch {
      // A protocol mismatch should skip this update, not tear down the session.
    }
  }

  output(id: string, tailLines?: number): ManagedProcessOutputResult {
    if (this.disposed || !this.snapshot().available) return { ok: false, reason: "unavailable" };
    const response = requestValue(this.events, CHANNELS.requestOutput, {
      id,
      tailLines: clampTailLines(tailLines),
    });
    if (!response.replied) return { ok: false, reason: "unavailable" };
    if (response.value === null) return { ok: false, reason: "not_found" };
    const lines = parseLogLines(response.value);
    return lines === undefined ? { ok: false, reason: "invalid_response" } : { ok: true, lines };
  }

  kill(id: string, options?: { signal?: NodeJS.Signals; timeoutMs?: number }): Promise<ManagedProcessKillResult> {
    if (this.disposed || !this.snapshot().available) return Promise.resolve({ ok: false, reason: "unavailable" });
    if (this.pendingKills.size >= MAX_PENDING_KILLS) return Promise.resolve({ ok: false, reason: "error" });
    const timeoutMs = clampKillTimeout(options?.timeoutMs);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ManagedProcessKillResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(pending.timer);
        this.pendingKills.delete(pending);
        resolve(result);
      };
      const pending: PendingKill = {
        timer: setTimeout(() => {
          finish({ ok: false, reason: "timeout" });
        }, timeoutMs + 2000),
        cancel: () => {
          finish({ ok: false, reason: "unavailable" });
        },
      };
      pending.timer.unref();
      this.pendingKills.add(pending);
      this.events.emit(CHANNELS.commandKill, {
        id,
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        timeoutMs,
        reply: (value: unknown) => {
          finish(parseKillResult(value) ?? { ok: false, reason: "error" });
        },
      });
    });
  }

  write(id: string, input: string, options?: { end?: boolean }): ManagedProcessWriteResult {
    if (this.disposed || !this.snapshot().available) return { ok: false, reason: "unavailable" };
    if (!this.writeSupported) return { ok: false, reason: "unsupported" };
    const response = requestValue(this.events, CHANNELS.commandWrite, {
      id,
      input,
      ...(options?.end === undefined ? {} : { end: options.end }),
    });
    if (!response.replied) return { ok: false, reason: "unsupported" };
    return parseWriteResult(response.value) ?? { ok: false, reason: "write_error" };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers) dispose();
    for (const pending of this.pendingOutput.values()) clearTimeout(pending.timer);
    this.pendingOutput.clear();
    for (const pending of [...this.pendingKills]) pending.cancel();
  }

  private probeWriteSupport(): boolean {
    return requestValue(this.events, CHANNELS.commandWrite, {
      id: WRITE_PROBE_ID,
      input: "",
      end: true,
    }).replied;
  }

  private queueOutput(delta: ParsedOutputDelta): void {
    if (this.disposed) return;
    let pending = this.pendingOutput.get(delta.id);
    if (pending === undefined) {
      pending = {
        lines: [],
        bytes: 0,
        droppedLines: 0,
        timer: setTimeout(() => {
          this.flushOutput(delta.id);
        }, OUTPUT_FLUSH_MS),
      };
      pending.timer.unref();
      this.pendingOutput.set(delta.id, pending);
    }

    pending.droppedLines += delta.droppedLines;
    for (const line of delta.lines) {
      const bytes = Buffer.byteLength(line.text, "utf8");
      if (pending.lines.length >= MAX_OUTPUT_LINES || pending.bytes + bytes > MAX_OUTPUT_BYTES) {
        pending.droppedLines += 1;
        continue;
      }
      pending.lines.push(line);
      pending.bytes += bytes;
    }
  }

  private flushOutput(id: string): void {
    const pending = this.pendingOutput.get(id);
    this.pendingOutput.delete(id);
    if (this.disposed || pending === undefined) return;
    if (pending.lines.length === 0 && pending.droppedLines === 0) return;
    this.publish({
      type: "processes.output",
      id,
      lines: pending.lines,
      droppedLines: pending.droppedLines,
    });
  }
}

interface PendingOutput {
  lines: ManagedProcessLogLine[];
  bytes: number;
  droppedLines: number;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingKill {
  timer: ReturnType<typeof setTimeout>;
  cancel: () => void;
}

interface ParsedOutputDelta {
  id: string;
  lines: ManagedProcessLogLine[];
  droppedLines: number;
}

function requestReplied(events: EventBus, channel: string): boolean {
  return requestValue(events, channel, {}).replied;
}

function requestValue(events: EventBus, channel: string, fields: Record<string, unknown>): { replied: boolean; value: unknown } {
  let replied = false;
  let value: unknown;
  events.emit(channel, {
    ...fields,
    reply: (result: unknown) => {
      replied = true;
      value = result;
    },
  });
  return { replied, value };
}

function unavailableSnapshot(): ManagedProcessesSnapshot {
  return { available: false, writeSupported: false, processes: [] };
}

const PROCESS_STATUSES: ReadonlySet<string> = new Set(["running", "terminating", "terminate_timeout", "exited", "killed"]);
const END_REASONS: ReadonlySet<string> = new Set(["exit", "signal", "spawn_error", "missing_pid", "kill_timeout", "lost"]);

function parseProcessList(value: unknown): ManagedProcessInfo[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const processes: ManagedProcessInfo[] = [];
  for (const item of value) {
    const process = parseProcess(item);
    if (process === undefined) return undefined;
    processes.push(process);
  }
  return processes;
}

function parseProcess(value: unknown): ManagedProcessInfo | undefined {
  const id = stringField(value, "id");
  const name = stringField(value, "name");
  const pid = numberField(value, "pid");
  const command = stringField(value, "command");
  const cwd = stringField(value, "cwd");
  const startTime = numberField(value, "startTime");
  const endTime = nullableNumberField(value, "endTime");
  const status = stringField(value, "status");
  const exitCode = nullableNumberField(value, "exitCode");
  const success = nullableBooleanField(value, "success");
  const endReason = nullableStringField(value, "endReason");
  const signal = parseSignal(property(value, "signal"));
  const errorMessage = nullableStringField(value, "errorMessage");
  if (id === undefined || name === undefined || pid === undefined || command === undefined || cwd === undefined || startTime === undefined) return undefined;
  if (endTime === undefined || exitCode === undefined || success === undefined || signal === undefined || errorMessage === undefined) return undefined;
  if (!isManagedProcessStatus(status)) return undefined;
  if (endReason === undefined || (endReason !== null && !isManagedProcessEndReason(endReason))) return undefined;
  return {
    id,
    name,
    pid,
    command,
    cwd,
    startTime,
    endTime,
    status,
    exitCode,
    success,
    endReason,
    signal,
    errorMessage,
  };
}

function parseSignal(value: unknown): ManagedProcessSignal | null | undefined {
  if (value === null) return null;
  const name = stringField(value, "name");
  const number = nullableNumberField(value, "number");
  const description = stringField(value, "description");
  if (name === undefined || number === undefined || description === undefined) return undefined;
  return { name, number, description };
}

function parseKillResult(value: unknown): ManagedProcessKillResult | undefined {
  const ok = property(value, "ok");
  const process = parseProcess(property(value, "info"));
  if (ok === true && process !== undefined) return { ok: true, process };
  const reason = stringField(value, "reason");
  if (ok !== false || !isKillFailureReason(reason)) return undefined;
  return { ok: false, reason, ...(process === undefined ? {} : { process }) };
}

function parseWriteResult(value: unknown): ManagedProcessWriteResult | undefined {
  const ok = property(value, "ok");
  if (ok === true) return { ok: true };
  const reason = stringField(value, "reason");
  if (ok !== false || !isWriteFailureReason(reason)) return undefined;
  return { ok: false, reason };
}

function isChangedPayload(value: unknown): boolean {
  const reason = stringField(value, "reason");
  return reason === "started" || reason === "ended" || reason === "cleared";
}

function parseOutputDelta(value: unknown): ParsedOutputDelta | undefined {
  const id = stringField(value, "id");
  const appended = property(value, "appendedText");
  const lines = appended === undefined ? [] : parseLogLines(appended);
  const dropped = property(value, "droppedLines");
  if (id === undefined || lines === undefined) return undefined;
  if (dropped !== undefined && (typeof dropped !== "number" || !Number.isSafeInteger(dropped) || dropped < 0)) return undefined;
  return { id, lines, droppedLines: typeof dropped === "number" ? dropped : 0 };
}

function parseLogLines(value: unknown): ManagedProcessLogLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines: ManagedProcessLogLine[] = [];
  for (const item of value) {
    const type = stringField(item, "type");
    const text = stringField(item, "text");
    if ((type !== "stdout" && type !== "stderr") || text === undefined) return undefined;
    lines.push({ type, text });
  }
  return lines;
}

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const field = property(value, key);
  return typeof field === "string" ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const field = property(value, key);
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function nullableStringField(value: unknown, key: string): string | null | undefined {
  const field = property(value, key);
  return field === null || typeof field === "string" ? field : undefined;
}

function nullableNumberField(value: unknown, key: string): number | null | undefined {
  const field = property(value, key);
  return field === null || (typeof field === "number" && Number.isFinite(field)) ? field : undefined;
}

function nullableBooleanField(value: unknown, key: string): boolean | null | undefined {
  const field = property(value, key);
  return field === null || typeof field === "boolean" ? field : undefined;
}

function isManagedProcessStatus(value: string | undefined): value is ManagedProcessStatus {
  return value !== undefined && PROCESS_STATUSES.has(value);
}

function isManagedProcessEndReason(value: string): value is ManagedProcessEndReason {
  return END_REASONS.has(value);
}

function isKillFailureReason(value: string | undefined): value is "not_found" | "timeout" | "error" {
  return value === "not_found" || value === "timeout" || value === "error";
}

function isWriteFailureReason(value: string | undefined): value is "not_found" | "process_exited" | "stdin_closed" | "write_error" {
  return value === "not_found" || value === "process_exited" || value === "stdin_closed" || value === "write_error";
}

function clampTailLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TAIL_LINES;
  return Math.max(1, Math.min(MAX_TAIL_LINES, Math.trunc(value)));
}

function clampKillTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 3000;
  return Math.max(100, Math.min(10_000, Math.trunc(value)));
}
