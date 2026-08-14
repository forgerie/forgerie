import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { SPEECH_POLICY, type SpeechRuntimePolicy } from "../../shared/speechPolicy.js";
import { type ValidatedSpeechPcm } from "./speechAudio.js";
import {
  DEFAULT_MAX_CHILD_RESPONSE_BYTES,
  JsonLineReader,
  SpeechProcessError,
  SpeechRestartGate,
  buildSandboxedSpeechCommand,
  isChildAlive,
  raceChildExit,
  spawnOptions,
  terminateChild,
  withTimeout,
  writeFramedBinaryRequest,
  type SandboxedSpeechCommand,
  type SpeechComponentStatus,
  type SpeechOperationOptions,
  type SpeechProcessDiagnostics,
  type SpeechProcessSandbox,
} from "./speechProcess.js";

const SMART_TURN_PROTOCOL = "forgerie-smart-turn-worker-v2";
const defaultMaxDiagnosticBytes = 4096;

export type { SpeechComponentStatus, SpeechOperationOptions, SpeechProcessDiagnostics, SpeechProcessSandbox } from "./speechProcess.js";
export { SpeechProcessError, buildSandboxedSpeechCommand } from "./speechProcess.js";

export interface SmartTurnDecision {
  readonly complete: boolean;
  readonly probability: number;
  readonly samples: number;
}

export interface SmartTurnProcessOptions {
  readonly commandPath: string;
  readonly args?: readonly string[];
  readonly sandbox?: SpeechProcessSandbox;
  readonly policy?: SpeechRuntimePolicy;
  readonly env?: Readonly<Record<string, string>>;
  readonly startupTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly maxDiagnosticBytes?: number;
  readonly maxLineBytes?: number;
}

export class SmartTurnProcess {
  private readonly policy: SpeechRuntimePolicy;
  private readonly env: Readonly<Record<string, string>>;
  private readonly maxDiagnosticBytes: number;
  private readonly maxLineBytes: number;
  private readonly launch: SandboxedSpeechCommand;
  private readonly restartGate = new SpeechRestartGate();
  private child: ChildProcessWithoutNullStreams | undefined;
  private lineReader: JsonLineReader | undefined;
  private componentStatus: SpeechComponentStatus = "unavailable";
  private stderr: string[] = [];
  private capturedDiagnosticBytes = 0;
  private closed = false;
  private lastSpawn: SpeechProcessDiagnostics["spawn"];
  private startPromise: Promise<void> | undefined;
  private generation = 0;

  public constructor(private readonly options: SmartTurnProcessOptions) {
    this.policy = options.policy ?? SPEECH_POLICY;
    this.env = options.env ?? {};
    this.maxDiagnosticBytes = options.maxDiagnosticBytes ?? defaultMaxDiagnosticBytes;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_CHILD_RESPONSE_BYTES;
    this.launch = buildSandboxedSpeechCommand({ commandPath: options.commandPath, args: options.args ?? [], sandbox: options.sandbox ?? { enabled: false } });
  }

  public status(): SpeechComponentStatus {
    if (this.componentStatus === "ready" && !isChildAlive(this.child)) return "unavailable";
    return this.componentStatus;
  }

  public diagnostics(): SpeechProcessDiagnostics {
    return this.lastSpawn === undefined
      ? { stderr: [...this.stderr] }
      : { spawn: this.lastSpawn, stderr: [...this.stderr] };
  }

  public async start(): Promise<void> {
    if (this.closed) throw new SpeechProcessError("closed", "Smart Turn process is closed.");
    if (this.componentStatus === "ready" && isChildAlive(this.child) && this.lineReader !== undefined) return;
    if (this.startPromise !== undefined) return this.startPromise;
    this.startPromise = this.startChild().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  public async checkTurn(pcm: ValidatedSpeechPcm, options: SpeechOperationOptions = {}): Promise<SmartTurnDecision> {
    assertValidatedPcm(pcm, this.policy, "endpoint");
    return this.performCheck(pcm, options.timeoutMs ?? this.options.operationTimeoutMs ?? this.policy.timing.endpointDeadlineMs);
  }

  public async close(): Promise<void> {
    this.closed = true;
    await this.stopChild();
  }

  private async startChild(): Promise<void> {
    this.componentStatus = "warming";
    await this.restartGate.waitBeforeStart(this.policy.restart, "Smart Turn");
    if (this.closed) {
      this.componentStatus = "unavailable";
      throw new SpeechProcessError("closed", "Smart Turn process is closed.");
    }
    this.stderr = [];
    this.capturedDiagnosticBytes = 0;
    const child = spawn(this.launch.command, this.launch.args, spawnOptions(this.env));
    this.child = child;
    this.generation += 1;
    const launchGeneration = this.generation;
    this.lastSpawn = { command: this.launch.command, args: this.launch.args, shell: false, envKeys: Object.keys(this.env).sort() };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { this.captureDiagnostic(String(chunk)); });
    child.on("error", (error) => { this.captureDiagnostic(error.message); });
    child.once("exit", () => {
      this.markExited(child, launchGeneration);
    });
    this.lineReader = new JsonLineReader(child, this.maxLineBytes);
    try {
      const ready = await raceChildExit(child, this.lineReader.nextJson(this.options.startupTimeoutMs ?? this.policy.timing.warmupDeadlineMs), "startup_timeout");
      if (this.child !== child || this.generation !== launchGeneration) throw new SpeechProcessError("child_exit", "Smart Turn startup was superseded.");
      if (!isObject(ready) || ready["status"] !== "ready" || ready["protocol"] !== SMART_TURN_PROTOCOL) {
        throw new SpeechProcessError("protocol", "Smart Turn worker emitted an invalid ready record.");
      }
      this.componentStatus = "ready";
    } catch (error) {
      if (this.child === child && this.generation === launchGeneration) this.componentStatus = "unavailable";
      await this.stopChild(child);
      throw error;
    }
  }

  private async performCheck(pcm: ValidatedSpeechPcm, timeoutMs: number): Promise<SmartTurnDecision> {
    await this.start();
    const child = this.child;
    const lineReader = this.lineReader;
    if (child === undefined || lineReader === undefined || !isChildAlive(child)) throw new SpeechProcessError("unavailable", "Smart Turn worker is unavailable.");
    const requestId = randomUUID();
    const audio = Buffer.from(pcm.bytes.buffer, pcm.bytes.byteOffset, pcm.bytes.byteLength);
    const deadline = Date.now() + timeoutMs;
    try {
      const response = await raceChildExit(child, withTimeout((async () => {
        await writeFramedBinaryRequest(child, { protocol: SMART_TURN_PROTOCOL, requestId, kind: "check_turn", pcmBytes: audio.byteLength }, audio);
        return await lineReader.nextJson(Math.max(1, deadline - Date.now()));
      })(), timeoutMs, "Smart Turn inference timed out.", "timeout"), "timeout");
      if (!isObject(response) || response["requestId"] !== requestId) throw new SpeechProcessError("protocol", "Smart Turn response request ID did not match.");
      if (response["status"] !== "ready") throw new SpeechProcessError("inference_failed", "Smart Turn request failed.");
      if (typeof response["complete"] !== "boolean" || typeof response["probability"] !== "number" || !Number.isFinite(response["probability"]) || response["probability"] < 0 || response["probability"] > 1) {
        throw new SpeechProcessError("protocol", "Smart Turn response shape is invalid.");
      }
      const samples = response["samples"];
      if (samples !== undefined && (typeof samples !== "number" || !Number.isInteger(samples) || samples < 0 || samples > this.policy.audio.maxTurnSamples)) {
        throw new SpeechProcessError("protocol", "Smart Turn response sample count is invalid.");
      }
      return { complete: response["complete"], probability: response["probability"], samples: samples ?? pcm.samples.length };
    } catch (error) {
      if (error instanceof SpeechProcessError && (error.kind === "timeout" || error.kind === "child_exit" || error.kind === "protocol")) await this.stopChild(child);
      throw error;
    }
  }

  private captureDiagnostic(chunk: string): void {
    const remaining = Math.max(0, this.maxDiagnosticBytes - this.capturedDiagnosticBytes);
    if (remaining === 0) return;
    const captured = chunk.slice(0, remaining);
    this.capturedDiagnosticBytes += Buffer.byteLength(captured);
    this.stderr.push(captured);
  }

  private markExited(child: ChildProcessWithoutNullStreams, generation: number): void {
    if (this.child !== child || this.generation !== generation) return;
    this.child = undefined;
    this.lineReader?.close();
    this.lineReader = undefined;
    this.componentStatus = "unavailable";
    this.generation += 1;
  }

  private async stopChild(childToStop: ChildProcessWithoutNullStreams | undefined = this.child): Promise<void> {
    if (childToStop === undefined) return;
    const isCurrent = childToStop === this.child;
    if (isCurrent) {
      this.child = undefined;
      this.lineReader?.close();
      this.lineReader = undefined;
      this.componentStatus = "unavailable";
      this.generation += 1;
    }
    await terminateChild(childToStop, { beforeSignal: () => { childToStop.stdin.destroy(); } });
  }
}

function assertValidatedPcm(pcm: ValidatedSpeechPcm, policy: SpeechRuntimePolicy, operation: "endpoint" | "transcription"): void {
  const maxBytes = operation === "endpoint" ? policy.audio.endpointWindowBytes : policy.audio.maxTurnBytes;
  if (pcm.bytes.byteLength === 0 || pcm.samples.length === 0) throw new SpeechProcessError("empty", "Speech PCM is empty.");
  if (pcm.bytes.byteLength % policy.audio.bytesPerSample !== 0 || pcm.samples.length * policy.audio.bytesPerSample !== pcm.bytes.byteLength) throw new SpeechProcessError("protocol", "Speech PCM byte length is invalid.");
  if (pcm.bytes.byteLength < policy.audio.minRequestBytes) throw new SpeechProcessError("too_short", "Speech PCM is shorter than the minimum request duration.");
  if (pcm.bytes.byteLength > maxBytes) throw new SpeechProcessError("overloaded", "Speech PCM exceeds the operation byte limit.");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
