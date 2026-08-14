import { SPEECH_POLICY, type SpeechRuntimePolicy } from "../../shared/speechPolicy.js";
import { validateSpeechPcm, type ValidatedSpeechPcm } from "./speechAudio.js";
import { SpeechProcessError, type SpeechComponentStatus, type SpeechOperationOptions } from "./speechProcess.js";
import type { SmartTurnDecision } from "./smartTurnProcess.js";
import type { WhisperTranscription } from "./whisperProcess.js";

export type SpeechCapability = "ready" | "manual-only" | "unavailable" | "warming";

export interface SpeechServiceStatus {
  readonly smartTurn: SpeechComponentStatus;
  readonly whisper: SpeechComponentStatus;
  readonly capability: SpeechCapability;
}

export interface SpeechBackend {
  status(): SpeechComponentStatus;
  start(): Promise<void>;
  close(): Promise<void>;
  checkTurn?(pcm: ValidatedSpeechPcm, options?: SpeechOperationOptions): Promise<SmartTurnDecision>;
  transcribe?(pcm: ValidatedSpeechPcm, options?: SpeechOperationOptions): Promise<WhisperTranscription>;
}

export interface SpeechService {
  status(): SpeechServiceStatus;
  warm(): Promise<void>;
  checkTurn(pcmBytes: Uint8Array, options?: SpeechOperationOptions): Promise<SmartTurnDecision>;
  transcribe(pcmBytes: Uint8Array, options?: SpeechOperationOptions): Promise<WhisperTranscription>;
  close(): Promise<void>;
}

export interface SpeechServiceOptions {
  readonly smartTurn: SpeechBackend;
  readonly whisper: SpeechBackend;
  readonly policy?: SpeechRuntimePolicy;
}

export function createSpeechService(options: SpeechServiceOptions): SpeechService {
  const policy = options.policy ?? SPEECH_POLICY;
  const smartQueue = new ServiceAdmissionQueue<SmartTurnDecision>("Smart Turn", policy);
  const whisperQueue = new ServiceAdmissionQueue<WhisperTranscription>("Whisper", policy);
  let closed = false;
  return {
    status: () => serviceStatus(options.smartTurn.status(), options.whisper.status()),
    warm: async () => {
      await Promise.allSettled([options.smartTurn.start(), options.whisper.start()]);
    },
    checkTurn: (pcmBytes, operationOptions = {}) => {
      if (closed) return Promise.reject(new SpeechProcessError("closed", "Speech service is closed."));
      if (options.smartTurn.checkTurn === undefined || options.smartTurn.status() === "unavailable") return Promise.reject(new SpeechProcessError("unavailable", "Smart Turn is unavailable."));
      let pcm: ValidatedSpeechPcm;
      try {
        pcm = validateSpeechPcm(pcmBytes, { operation: "endpoint", policy });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return smartQueue.enqueue(pcm.bytes.byteLength, operationOptions.signal, (timeoutMs) => options.smartTurn.checkTurn?.(pcm, { timeoutMs }) ?? Promise.reject(new SpeechProcessError("unavailable", "Smart Turn is unavailable.")));
    },
    transcribe: (pcmBytes, operationOptions = {}) => {
      if (closed) return Promise.reject(new SpeechProcessError("closed", "Speech service is closed."));
      if (options.whisper.transcribe === undefined || options.whisper.status() === "unavailable") return Promise.reject(new SpeechProcessError("unavailable", "Whisper is unavailable."));
      let pcm: ValidatedSpeechPcm;
      try {
        pcm = validateSpeechPcm(pcmBytes, { operation: "transcription", policy });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return whisperQueue.enqueue(pcm.bytes.byteLength, operationOptions.signal, (timeoutMs) => options.whisper.transcribe?.(pcm, { timeoutMs }) ?? Promise.reject(new SpeechProcessError("unavailable", "Whisper is unavailable.")));
    },
    close: async () => {
      closed = true;
      smartQueue.close();
      whisperQueue.close();
      await Promise.allSettled([options.smartTurn.close(), options.whisper.close()]);
    },
  };
}

export function speechServiceUnavailable(reason: string): SpeechBackend {
  return {
    status: () => "unavailable",
    start: () => Promise.resolve(),
    close: () => Promise.resolve(),
    checkTurn: () => Promise.reject(new SpeechProcessError("unavailable", `Smart Turn unavailable: ${reason}`)),
    transcribe: () => Promise.reject(new SpeechProcessError("unavailable", `Whisper unavailable: ${reason}`)),
  };
}

function serviceStatus(smartTurn: SpeechComponentStatus, whisper: SpeechComponentStatus): SpeechServiceStatus {
  let capability: SpeechCapability;
  if (whisper === "ready" && smartTurn === "ready") capability = "ready";
  else if (whisper === "ready") capability = "manual-only";
  else if (whisper === "warming") capability = "warming";
  else capability = "unavailable";
  return { smartTurn, whisper, capability };
}

class ServiceAdmissionQueue<T> {
  // One active backend operation is the queue invariant. Callers may queue one more operation by policy.
  private active: Promise<void> | undefined;
  private readonly queued: QueuedServiceJob<T>[] = [];
  private queuedBytes = 0;
  private closed = false;

  public constructor(private readonly label: string, private readonly policy: SpeechRuntimePolicy) {}

  public enqueue(bytes: number, signal: AbortSignal | undefined, operation: (timeoutMs: number) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new SpeechProcessError("closed", `${this.label} queue is closed.`));
    if (signal?.aborted === true) return Promise.reject(new SpeechProcessError("aborted", `${this.label} request was cancelled.`));
    const deadlineAt = Date.now() + this.policy.timing.operationDeadlineMs;
    const job: QueuedServiceJob<T> = { bytes, operation, signal, deadlineAt, resolve: undefined, reject: undefined, abort: undefined, expire: undefined };
    if (this.active === undefined) return this.runActive(job);
    if (this.queued.length >= this.policy.admission.queuedOperationsPerBackend || this.queuedBytes + bytes > this.policy.admission.maxQueuedPcmBytes) {
      return Promise.reject(new SpeechProcessError("overloaded", `${this.label} queue is full.`));
    }
    return new Promise<T>((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
      job.abort = () => {
        this.remove(job);
        reject(new SpeechProcessError("aborted", `${this.label} request was cancelled.`));
      };
      job.expire = () => {
        this.remove(job);
        reject(new SpeechProcessError("timeout", `${this.label} request timed out.`));
      };
      signal?.addEventListener("abort", job.abort, { once: true });
      job.expireTimer = setTimeout(job.expire, Math.max(0, deadlineAt - Date.now()));
      this.queued.push(job);
      this.queuedBytes += bytes;
    });
  }

  public close(): void {
    this.closed = true;
    for (const job of this.queued.splice(0)) {
      this.cleanup(job);
      job.reject?.(new SpeechProcessError("closed", `${this.label} queue is closed.`));
    }
    this.queuedBytes = 0;
  }

  private runActive(job: QueuedServiceJob<T>): Promise<T> {
    const remainingMs = job.deadlineAt - Date.now();
    if (remainingMs <= 0) return Promise.reject(new SpeechProcessError("timeout", `${this.label} request timed out.`));
    let settledForCaller = false;
    const caller = new Promise<T>((resolve, reject) => {
      const abort = () => {
        if (settledForCaller) return;
        settledForCaller = true;
        reject(new SpeechProcessError("aborted", `${this.label} request was cancelled.`));
      };
      job.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => {
        if (!settledForCaller) {
          settledForCaller = true;
          reject(new SpeechProcessError("timeout", `${this.label} request timed out.`));
        }
      }, remainingMs);
      this.active = job.operation(remainingMs)
        .then((value) => {
          if (!settledForCaller) {
            settledForCaller = true;
            resolve(value);
          }
        }, (error: unknown) => {
          if (!settledForCaller) {
            settledForCaller = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        })
        .finally(() => {
          clearTimeout(timeout);
          job.signal?.removeEventListener("abort", abort);
          this.active = undefined;
          this.drain();
        });
    });
    return caller;
  }

  private drain(): void {
    if (this.active !== undefined || this.closed) return;
    while (this.queued.length > 0) {
      const next = this.queued.shift();
      if (next === undefined) return;
      this.queuedBytes -= next.bytes;
      this.cleanup(next);
      if (next.deadlineAt <= Date.now()) {
        next.reject?.(new SpeechProcessError("timeout", `${this.label} request timed out.`));
        continue;
      }
      void this.runActive(next).then(
        (value) => { next.resolve?.(value); },
        (error: unknown) => { next.reject?.(error); },
      );
      return;
    }
  }

  private remove(job: QueuedServiceJob<T>): void {
    const index = this.queued.indexOf(job);
    if (index === -1) return;
    this.queued.splice(index, 1);
    this.queuedBytes -= job.bytes;
    this.cleanup(job);
  }

  private cleanup(job: QueuedServiceJob<T>): void {
    if (job.abort !== undefined) job.signal?.removeEventListener("abort", job.abort);
    if (job.expireTimer !== undefined) clearTimeout(job.expireTimer);
  }
}

interface QueuedServiceJob<T> {
  readonly bytes: number;
  readonly operation: (timeoutMs: number) => Promise<T>;
  readonly signal: AbortSignal | undefined;
  readonly deadlineAt: number;
  resolve: ((value: T) => void) | undefined;
  reject: ((error: unknown) => void) | undefined;
  abort: (() => void) | undefined;
  expire: (() => void) | undefined;
  expireTimer?: NodeJS.Timeout;
}
