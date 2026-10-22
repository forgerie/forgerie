import { SPEECH_POLICY, type SpeechRuntimePolicy } from "../../shared/speechPolicy.js";
import { validateSpeechPcm, type ValidatedSpeechPcm } from "./speechAudio.js";
import { SpeechError, type SpeechComponentStatus, type SpeechOperationOptions } from "./speechErrors.js";

export interface SpeechTranscription {
  readonly text: string;
}

export type SpeechCapability = "ready" | "manual-only" | "unavailable" | "warming";

export interface SpeechServiceStatus {
  readonly smartTurn: SpeechComponentStatus;
  /** The transcription backend's state. The wire name predates the Speech to text plugin; browsers read it. */
  readonly whisper: SpeechComponentStatus;
  readonly capability: SpeechCapability;
}

export interface SpeechBackend {
  /** Checks the backend now; a remote backend answers within its own short timeout. */
  status(): Promise<SpeechComponentStatus>;
  close(): Promise<void>;
  transcribe(pcm: ValidatedSpeechPcm, options?: SpeechOperationOptions): Promise<SpeechTranscription>;
}

export interface SpeechService {
  status(): Promise<SpeechServiceStatus>;
  transcribe(pcmBytes: Uint8Array, options?: SpeechOperationOptions): Promise<SpeechTranscription>;
  close(): Promise<void>;
}

export interface SpeechServiceOptions {
  readonly backend: SpeechBackend;
  readonly policy?: SpeechRuntimePolicy;
}

export function createSpeechService(options: SpeechServiceOptions): SpeechService {
  const policy = options.policy ?? SPEECH_POLICY;
  const transcriptionQueue = new ServiceAdmissionQueue<SpeechTranscription>("Speech to text", policy);
  let closed = false;
  return {
    status: async () => serviceStatus(await options.backend.status()),
    transcribe: (pcmBytes, operationOptions = {}) => {
      if (closed) return Promise.reject(new SpeechError("closed", "Speech service is closed."));
      let pcm: ValidatedSpeechPcm;
      try {
        pcm = validateSpeechPcm(pcmBytes, { policy });
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
      return transcriptionQueue.enqueue(pcm.bytes.byteLength, operationOptions.signal, (timeoutMs, signal) => options.backend.transcribe(pcm, { timeoutMs, ...(signal === undefined ? {} : { signal }) }));
    },
    close: async () => {
      closed = true;
      transcriptionQueue.close();
      await Promise.allSettled([options.backend.close()]);
    },
  };
}

export function speechServiceUnavailable(reason: string): SpeechBackend {
  return {
    status: () => Promise.resolve("unavailable"),
    close: () => Promise.resolve(),
    transcribe: () => Promise.reject(new SpeechError("unavailable", `Speech to text unavailable: ${reason}`)),
  };
}

function serviceStatus(whisper: SpeechComponentStatus): SpeechServiceStatus {
  let capability: SpeechCapability;
  if (whisper === "ready") capability = "manual-only";
  else if (whisper === "warming") capability = "warming";
  else capability = "unavailable";
  // Keep the inert status field while existing browsers still expect this wire shape.
  return { smartTurn: "unavailable", whisper, capability };
}

class ServiceAdmissionQueue<T> {
  // One active backend operation is the queue invariant. Callers may queue one more operation by policy.
  private active: Promise<void> | undefined;
  private readonly queued: QueuedServiceJob<T>[] = [];
  private queuedBytes = 0;
  private closed = false;

  public constructor(private readonly label: string, private readonly policy: SpeechRuntimePolicy) {}

  public enqueue(bytes: number, signal: AbortSignal | undefined, operation: (timeoutMs: number, signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new SpeechError("closed", `${this.label} queue is closed.`));
    if (signal?.aborted === true) return Promise.reject(new SpeechError("aborted", `${this.label} request was cancelled.`));
    const deadlineAt = Date.now() + this.policy.timing.operationDeadlineMs;
    const job: QueuedServiceJob<T> = { bytes, operation, signal, deadlineAt, resolve: undefined, reject: undefined, abort: undefined, expire: undefined };
    if (this.active === undefined) return this.runActive(job);
    if (this.queued.length >= this.policy.admission.queuedOperationsPerBackend || this.queuedBytes + bytes > this.policy.admission.maxQueuedPcmBytes) {
      return Promise.reject(new SpeechError("overloaded", `${this.label} queue is full.`));
    }
    return new Promise<T>((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
      job.abort = () => {
        this.remove(job);
        reject(new SpeechError("aborted", `${this.label} request was cancelled.`));
      };
      job.expire = () => {
        this.remove(job);
        reject(new SpeechError("timeout", `${this.label} request timed out.`));
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
      job.reject?.(new SpeechError("closed", `${this.label} queue is closed.`));
    }
    this.queuedBytes = 0;
  }

  private runActive(job: QueuedServiceJob<T>): Promise<T> {
    const remainingMs = job.deadlineAt - Date.now();
    if (remainingMs <= 0) return Promise.reject(new SpeechError("timeout", `${this.label} request timed out.`));
    let settledForCaller = false;
    const caller = new Promise<T>((resolve, reject) => {
      const abort = () => {
        if (settledForCaller) return;
        settledForCaller = true;
        reject(new SpeechError("aborted", `${this.label} request was cancelled.`));
      };
      job.signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => {
        if (!settledForCaller) {
          settledForCaller = true;
          reject(new SpeechError("timeout", `${this.label} request timed out.`));
        }
      }, remainingMs);
      this.active = job.operation(remainingMs, job.signal)
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
        next.reject?.(new SpeechError("timeout", `${this.label} request timed out.`));
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
  readonly operation: (timeoutMs: number, signal: AbortSignal | undefined) => Promise<T>;
  readonly signal: AbortSignal | undefined;
  readonly deadlineAt: number;
  resolve: ((value: T) => void) | undefined;
  reject: ((error: unknown) => void) | undefined;
  abort: (() => void) | undefined;
  expire: (() => void) | undefined;
  expireTimer?: NodeJS.Timeout;
}
