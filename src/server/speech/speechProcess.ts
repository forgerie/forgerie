import { type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { isAbsolute } from "node:path";
import { type SpeechRestartPolicy } from "../../shared/speechPolicy.js";

export const DEFAULT_MAX_CHILD_RESPONSE_BYTES = 64 * 1024;
export const DEFAULT_MAX_TRANSCRIPT_CHARS = 4_096;
const DEFAULT_MAX_QUEUED_JSON_LINES = 16;

export type SpeechComponentStatus = "warming" | "ready" | "unavailable";
export type SpeechProcessErrorKind = "unavailable" | "startup_timeout" | "protocol" | "child_exit" | "timeout" | "aborted" | "overloaded" | "closed" | "inference_failed" | "empty" | "too_short";

export class SpeechProcessError extends Error {
  public constructor(public readonly kind: SpeechProcessErrorKind, message: string) {
    super(message);
    this.name = "SpeechProcessError";
  }
}

export type SpeechProcessSandbox =
  | { readonly enabled: false }
  | { readonly enabled: true; readonly sandboxPath: string; readonly network: "none" | "loopback" };

export interface SandboxedSpeechCommandOptions {
  readonly commandPath: string;
  readonly args: readonly string[];
  readonly sandbox: SpeechProcessSandbox;
}

export interface SandboxedSpeechCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export function buildSandboxedSpeechCommand(options: SandboxedSpeechCommandOptions): SandboxedSpeechCommand {
  assertAbsoluteExecutable(options.commandPath, "commandPath");
  if (!options.sandbox.enabled) return { command: options.commandPath, args: [...options.args] };
  assertAbsoluteExecutable(options.sandbox.sandboxPath, "sandboxPath");
  const args = [
    "--die-with-parent",
    "--unshare-pid",
    "--unshare-ipc",
    "--new-session",
    "--clearenv",
    "--ro-bind", "/nix/store", "/nix/store",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--tmpfs", "/home",
    "--tmpfs", "/root",
    "--setenv", "HOME", "/tmp",
    "--chdir", "/tmp",
  ];
  if (options.sandbox.network === "none") args.push("--unshare-net");
  args.push(options.commandPath, ...options.args);
  return { command: options.sandbox.sandboxPath, args };
}

function assertAbsoluteExecutable(value: string, name: string): void {
  if (!isAbsolute(value)) throw new SpeechProcessError("unavailable", `${name} must be an absolute executable path.`);
}

export interface SpeechProcessDiagnostics {
  readonly spawn?: { readonly command: string; readonly args: readonly string[]; readonly shell: false; readonly envKeys: readonly string[] };
  readonly stderr: readonly string[];
}

export interface SpeechOperationOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export function spawnOptions(env: Readonly<Record<string, string>>): SpawnOptionsWithoutStdio {
  return { shell: false, env: { ...env }, cwd: "/" };
}

export class SpeechRestartGate {
  private hasStarted = false;
  private restartTimestamps: number[] = [];
  private nextStartAt = 0;

  public async waitBeforeStart(policy: SpeechRestartPolicy, label: string): Promise<void> {
    if (!this.hasStarted) {
      this.hasStarted = true;
      return;
    }
    let now = Date.now();
    this.prune(now, policy.restartWindowMs);
    if (this.restartTimestamps.length >= policy.maxRestartsPerWindow) {
      throw new SpeechProcessError("unavailable", `${label} restart budget is exhausted.`);
    }
    const waitMs = Math.max(0, this.nextStartAt - now);
    if (waitMs > 0) await delay(waitMs);
    now = Date.now();
    this.prune(now, policy.restartWindowMs);
    if (this.restartTimestamps.length >= policy.maxRestartsPerWindow) {
      throw new SpeechProcessError("unavailable", `${label} restart budget is exhausted.`);
    }
    this.restartTimestamps.push(now);
    this.nextStartAt = now + policy.restartBackoffMs;
  }

  private prune(now: number, windowMs: number): void {
    this.restartTimestamps = this.restartTimestamps.filter((timestamp) => now - timestamp <= windowMs);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ChildTerminationOptions {
  readonly termGraceMs?: number;
  readonly killGraceMs?: number;
  readonly beforeSignal?: () => void;
}

const DEFAULT_TERM_GRACE_MS = 500;
const DEFAULT_KILL_GRACE_MS = 500;

export async function terminateChild(child: ChildProcessWithoutNullStreams, options: ChildTerminationOptions = {}): Promise<void> {
  options.beforeSignal?.();
  if (hasChildExited(child)) return;
  child.kill("SIGTERM");
  const exitedAfterTerm = await waitForChildCloseOrTimeout(child, options.termGraceMs ?? DEFAULT_TERM_GRACE_MS);
  if (exitedAfterTerm || hasChildExited(child)) return;
  child.kill("SIGKILL");
  await waitForChildCloseOrTimeout(child, options.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
}

function hasChildExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildCloseOrTimeout(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (hasChildExited(child)) return true;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (value: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(value);
    };
    const onClose = (): void => { settle(true); };
    const timer = setTimeout(() => { settle(false); }, Math.max(0, timeoutMs));
    child.once("close", onClose);
  });
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string, kind: SpeechProcessErrorKind = "timeout"): Promise<T> {
  if (timeoutMs <= 0) return Promise.reject(new SpeechProcessError(kind, message));
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new SpeechProcessError(kind, message));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export async function raceChildExit<T>(child: ChildProcessWithoutNullStreams, promise: Promise<T>, timeoutKind: SpeechProcessErrorKind): Promise<T> {
  let removeExitListener: (() => void) | undefined;
  const exit = new Promise<never>((_resolve, reject) => {
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      reject(new SpeechProcessError("child_exit", `Runtime exited before completing work (${String(code ?? signal ?? "unknown")}).`));
    };
    removeExitListener = () => { child.off("exit", onExit); };
    child.once("exit", onExit);
  });
  try {
    return await Promise.race([promise, exit]);
  } catch (error) {
    if (error instanceof SpeechProcessError && error.kind === "timeout") throw new SpeechProcessError(timeoutKind, error.message);
    throw error;
  } finally {
    removeExitListener?.();
  }
}

export function isChildAlive(child: ChildProcessWithoutNullStreams | undefined): child is ChildProcessWithoutNullStreams {
  return child?.exitCode === null && child.signalCode === null;
}

export class JsonLineReader {
  private readonly queue: string[] = [];
  private readonly waiters: { resolve(line: string): void; reject(error: Error): void }[] = [];
  private closed = false;
  private closeError: Error | undefined;
  private buffered = Buffer.alloc(0);

  public constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly maxLineBytes: number,
    private readonly maxQueuedLines = DEFAULT_MAX_QUEUED_JSON_LINES,
  ) {
    child.stdout.on("data", this.onData);
    child.stdout.on("close", this.onClose);
    child.stdout.on("error", this.onError);
  }

  public async nextJson(timeoutMs: number): Promise<unknown> {
    const line = await withTimeout(this.nextLine(), timeoutMs, "runtime line timeout", "timeout");
    try {
      return JSON.parse(line);
    } catch {
      throw new SpeechProcessError("protocol", "Runtime emitted invalid JSON.");
    }
  }

  public close(): void {
    this.fail(new SpeechProcessError("child_exit", "Runtime stdout closed."));
  }

  private readonly onData = (chunk: Buffer): void => {
    if (this.closed) return;
    let pending = Buffer.concat([this.buffered, chunk]);
    for (;;) {
      const newlineIndex = pending.indexOf(0x0a);
      if (newlineIndex === -1) break;
      let lineBytes = pending.subarray(0, newlineIndex);
      if (lineBytes.byteLength > 0 && lineBytes[lineBytes.byteLength - 1] === 0x0d) lineBytes = lineBytes.subarray(0, -1);
      if (lineBytes.byteLength > this.maxLineBytes) {
        this.fail(new SpeechProcessError("protocol", "Runtime emitted an oversized JSON line."));
        return;
      }
      this.push(lineBytes.toString("utf8"));
      pending = pending.subarray(newlineIndex + 1);
    }
    if (pending.byteLength > this.maxLineBytes) {
      this.fail(new SpeechProcessError("protocol", "Runtime emitted an oversized JSON line."));
      return;
    }
    this.buffered = pending;
  };

  private readonly onClose = (): void => {
    this.close();
  };

  private readonly onError = (): void => {
    this.fail(new SpeechProcessError("child_exit", "Runtime stdout failed."));
  };

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.closeError = error;
    this.child.stdout.off("data", this.onData);
    this.child.stdout.off("close", this.onClose);
    this.child.stdout.off("error", this.onError);
    this.queue.splice(0);
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  private push(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(line);
      return;
    }
    if (this.queue.length >= this.maxQueuedLines) {
      this.fail(new SpeechProcessError("protocol", "Runtime emitted too many unsolicited JSON lines."));
      return;
    }
    this.queue.push(line);
  }

  private nextLine(): Promise<string> {
    const line = this.queue.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (this.closed) return Promise.reject(this.closeError ?? new SpeechProcessError("child_exit", "Runtime stdout closed."));
    return new Promise((resolve, reject) => { this.waiters.push({ resolve, reject }); });
  }
}

export async function writeLine(child: ChildProcessWithoutNullStreams, line: string): Promise<void> {
  if (!child.stdin.writable) throw new SpeechProcessError("child_exit", "Runtime stdin is closed.");
  await writeBuffer(child, Buffer.from(`${line}\n`, "utf8"));
}

export async function writeFramedBinaryRequest(child: ChildProcessWithoutNullStreams, header: Readonly<Record<string, unknown>>, body: Buffer): Promise<void> {
  if (!child.stdin.writable) throw new SpeechProcessError("child_exit", "Runtime stdin is closed.");
  await writeBuffer(child, Buffer.concat([Buffer.from(`${JSON.stringify(header)}\n`, "utf8"), body]));
}

function writeBuffer(child: ChildProcessWithoutNullStreams, buffer: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    child.stdin.write(buffer, (error) => {
      if (error === null || error === undefined) resolve();
      else reject(new SpeechProcessError("child_exit", "Runtime stdin write failed."));
    });
  });
}
