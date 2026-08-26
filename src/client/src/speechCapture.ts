import speechCaptureWorkletUrl from "./speechCaptureWorklet.ts?worker&url";
import { SPEECH_POLICY, type SpeechRuntimePolicy } from "../../shared/speechPolicy";

export type SpeechCaptureFailureKind = "unsupported" | "permission_denied" | "device_unavailable" | "worklet_load_failed" | "context_failed" | "track_ended" | "limit_reached" | "worklet_failed" | "cancelled";

export class SpeechCaptureError extends Error {
  public constructor(public readonly kind: SpeechCaptureFailureKind, message: string, public readonly options: { readonly retryable: boolean } = { retryable: false }) {
    super(message);
    this.name = "SpeechCaptureError";
  }

  public get retryable(): boolean {
    return this.options.retryable;
  }
}

export interface SpeechCaptureBatch {
  readonly startSample: number;
  readonly endSample: number;
  readonly sampleCount: number;
  readonly rms: number;
  readonly voiced: boolean;
}

export interface SpeechPauseCandidate {
  readonly endSample: number;
  readonly voicedAtSample: number;
}

export type SpeechCaptureMessage =
  | { readonly kind: "batch"; readonly startSample: number; readonly endSample: number; readonly samples: Float32Array; readonly rms: number; readonly voiced: boolean }
  | { readonly kind: "limit"; readonly totalSamples: number }
  | { readonly kind: "flushed"; readonly requestId: string; readonly totalSamples: number };

export interface SpeechCaptureControlMessage {
  readonly kind: "flush";
  readonly requestId: string;
}

export type SpeechCaptureTerminal =
  | { readonly kind: "finalized"; readonly samples: Float32Array }
  | { readonly kind: "failed"; readonly error: SpeechCaptureError; readonly samples: Float32Array };

export interface SpeechCaptureSession {
  readonly actualSampleRateHz: number;
  readonly failure: SpeechCaptureError | undefined;
  endpointWindow(): Float32Array;
  finalize(): Float32Array;
  synchronize(): Promise<void>;
  stopAndFinalize(): Promise<Float32Array>;
  abort(): Promise<void>;
}

export interface SpeechCaptureBrowserHost {
  readonly mediaDevices?: { getUserMedia(constraints: MediaStreamConstraints): Promise<SpeechMediaStreamLike> };
  readonly workletUrl?: string;
  createAudioContext(options: AudioContextOptions): SpeechAudioContextLike;
  createAudioWorkletNode(context: SpeechAudioContextLike, name: string, options: AudioWorkletNodeOptions): SpeechAudioWorkletNodeLike;
}

export interface SpeechMediaStreamLike {
  getAudioTracks(): SpeechMediaTrackLike[];
}

export interface SpeechMediaTrackLike {
  stop(): void;
  addEventListener(type: "ended", listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: "ended", listener: () => void): void;
}

export interface SpeechCaptureOptions {
  readonly host?: SpeechCaptureBrowserHost;
  readonly policy?: SpeechRuntimePolicy;
  readonly signal?: AbortSignal;
  readonly rmsThreshold?: number;
  readonly onPauseCandidate?: (candidate: { readonly samples: Float32Array; readonly endSample: number }) => void;
  readonly onSpeechActivity?: (activity: { readonly startSample: number; readonly endSample: number; readonly sampleCount: number }) => void;
  readonly onTerminal?: (terminal: SpeechCaptureTerminal) => void;
}

export interface SpeechAudioContextLike {
  readonly sampleRate: number;
  readonly audioWorklet: { addModule(moduleUrl: string): Promise<void> };
  readonly destination: unknown;
  readonly state?: AudioContextState;
  resume?: () => Promise<void>;
  createMediaStreamSource(stream: SpeechMediaStreamLike): SpeechAudioNodeLike;
  createBiquadFilter?: () => SpeechBiquadFilterLike;
  createGain(): SpeechGainNodeLike;
  close(): Promise<void>;
}

export interface SpeechAudioNodeLike {
  connect(target: unknown): unknown;
  disconnect?: () => void;
}

export interface SpeechBiquadFilterLike extends SpeechAudioNodeLike {
  type: BiquadFilterType;
  readonly frequency: { value: number };
}

export interface SpeechGainNodeLike extends SpeechAudioNodeLike {
  readonly gain: { value: number };
}

export interface SpeechAudioWorkletNodeLike extends SpeechAudioNodeLike {
  readonly port: SpeechMessagePortLike;
}

export interface SpeechMessagePortLike {
  postMessage(message: SpeechCaptureControlMessage, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<SpeechCaptureMessage>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<SpeechCaptureMessage>) => void): void;
  start?: () => void;
  close?: () => void;
}

interface SpeechChunk {
  readonly startSample: number;
  readonly samples: Float32Array;
}

export class SpeechChunkDeque {
  private readonly chunks: SpeechChunk[] = [];
  private head = 0;
  private sampleCount = 0;

  public constructor(private readonly maxSamples: number) {}

  public get totalSamples(): number {
    return this.sampleCount;
  }

  public push(samples: Float32Array, startSample: number): void {
    if (samples.length === 0 || this.maxSamples <= 0) return;
    const retained = samples.length > this.maxSamples ? samples.subarray(samples.length - this.maxSamples) : samples;
    const retainedStart = startSample + samples.length - retained.length;
    this.chunks.push({ startSample: retainedStart, samples: retained });
    this.sampleCount += retained.length;
    this.trimToLimit();
  }

  public flattenAll(): Float32Array {
    return this.flattenLatest(this.sampleCount);
  }

  public flattenLatest(sampleLimit: number): Float32Array {
    const target = Math.max(0, Math.min(sampleLimit, this.sampleCount));
    const output = new Float32Array(target);
    let writeAt = target;
    let remaining = target;
    for (let index = this.chunks.length - 1; index >= this.head && remaining > 0; index -= 1) {
      const chunk = this.chunks[index];
      if (chunk === undefined) continue;
      const take = Math.min(remaining, chunk.samples.length);
      writeAt -= take;
      output.set(chunk.samples.subarray(chunk.samples.length - take), writeAt);
      remaining -= take;
    }
    return output;
  }

  public clear(): void {
    this.chunks.splice(0);
    this.head = 0;
    this.sampleCount = 0;
  }

  private trimToLimit(): void {
    while (this.sampleCount > this.maxSamples && this.head < this.chunks.length) {
      const overflow = this.sampleCount - this.maxSamples;
      const first = this.chunks[this.head];
      if (first === undefined) return;
      if (overflow >= first.samples.length) {
        this.dropHead();
        this.sampleCount -= first.samples.length;
      } else {
        this.chunks[this.head] = { startSample: first.startSample + overflow, samples: first.samples.subarray(overflow) };
        this.sampleCount -= overflow;
      }
    }
  }

  private dropHead(): void {
    this.head += 1;
    if (this.head > 256 && this.head * 2 > this.chunks.length) {
      this.chunks.splice(0, this.head);
      this.head = 0;
    }
  }
}

export interface SpeechPauseCandidateDetectorOptions {
  readonly sampleRateHz: number;
  readonly pauseAfterSpeechMs: number;
  readonly minNewVoicedAudioMs: number;
  readonly minIntervalMs: number;
}

export class SpeechPauseCandidateDetector {
  private readonly pauseSamples: number;
  private readonly minNewVoicedSamples: number;
  private readonly minIntervalSamples: number;
  private speechStarted = false;
  private lastVoicedEndSample = 0;
  private lastCandidateEndSample = Number.NEGATIVE_INFINITY;
  private voicedSamplesSinceCandidate = 0;
  private emittedFirstCandidate = false;

  public constructor(options: SpeechPauseCandidateDetectorOptions) {
    this.pauseSamples = msToSamples(options.pauseAfterSpeechMs, options.sampleRateHz);
    this.minNewVoicedSamples = msToSamples(options.minNewVoicedAudioMs, options.sampleRateHz);
    this.minIntervalSamples = msToSamples(options.minIntervalMs, options.sampleRateHz);
  }

  public accept(batch: SpeechCaptureBatch): SpeechPauseCandidate | undefined {
    if (batch.voiced) {
      this.speechStarted = true;
      this.lastVoicedEndSample = batch.endSample;
      this.voicedSamplesSinceCandidate += batch.sampleCount;
      return undefined;
    }
    if (!this.speechStarted) return undefined;
    const silenceSamples = batch.endSample - this.lastVoicedEndSample;
    const enoughNewSpeech = !this.emittedFirstCandidate || this.voicedSamplesSinceCandidate >= this.minNewVoicedSamples;
    const enoughInterval = batch.endSample - this.lastCandidateEndSample >= this.minIntervalSamples;
    if (silenceSamples < this.pauseSamples || !enoughNewSpeech || !enoughInterval) return undefined;
    this.lastCandidateEndSample = batch.endSample;
    this.voicedSamplesSinceCandidate = 0;
    this.emittedFirstCandidate = true;
    return { endSample: batch.endSample, voicedAtSample: this.lastVoicedEndSample };
  }
}

export async function createSpeechCaptureSession(options: SpeechCaptureOptions = {}): Promise<SpeechCaptureSession> {
  const policy = options.policy ?? SPEECH_POLICY;
  const host = options.host ?? defaultSpeechCaptureBrowserHost();
  const signal = options.signal;
  throwIfCaptureAborted(signal);
  if (host.mediaDevices === undefined) throw new SpeechCaptureError("unsupported", "This browser does not expose microphone capture.");

  let stream: SpeechMediaStreamLike | undefined;
  let context: SpeechAudioContextLike | undefined;
  let source: SpeechAudioNodeLike | undefined;
  let filter: SpeechBiquadFilterLike | undefined;
  let worklet: SpeechAudioWorkletNodeLike | undefined;
  let gain: SpeechGainNodeLike | undefined;
  try {
    stream = await host.mediaDevices.getUserMedia(microphoneConstraints()).catch((error: unknown) => {
      throw mapSpeechCaptureFailure(error);
    });
    throwIfCaptureAborted(signal);
    context = host.createAudioContext({ sampleRate: policy.audio.sampleRateHz });
    if (context.sampleRate < policy.audio.sampleRateHz) throw new SpeechCaptureError("context_failed", "Speech capture requires an audio input rate of at least 16 kHz.");
    await ensureAudioContextRunning(context);
    throwIfCaptureAborted(signal);
    const workletUrl = host.workletUrl ?? speechCaptureWorkletUrl;
    await context.audioWorklet.addModule(workletUrl).catch((error: unknown) => {
      throw new SpeechCaptureError("worklet_load_failed", error instanceof Error ? error.message : "Speech capture worklet failed to load.");
    });
    throwIfCaptureAborted(signal);
    worklet = host.createAudioWorkletNode(context, "forgerie-speech-capture", {
      processorOptions: {
        sourceSampleRateHz: context.sampleRate,
        targetSampleRateHz: policy.audio.sampleRateHz,
        maxSamples: policy.audio.maxTurnSamples,
        batchSamples: Math.round(policy.audio.sampleRateHz * 0.05),
        rmsThreshold: options.rmsThreshold ?? 0.012,
      },
    });
    source = context.createMediaStreamSource(stream);
    filter = context.sampleRate > policy.audio.sampleRateHz && context.createBiquadFilter !== undefined ? context.createBiquadFilter() : undefined;
    gain = context.createGain();
    gain.gain.value = 0;
    if (filter !== undefined) {
      filter.type = "lowpass";
      filter.frequency.value = Math.floor(policy.audio.sampleRateHz * 0.45);
      source.connect(filter);
      filter.connect(worklet);
    } else {
      source.connect(worklet);
    }
    worklet.connect(gain);
    gain.connect(context.destination);
    throwIfCaptureAborted(signal);
    const session = new SpeechCaptureSessionImpl({ policy, stream, context, source, filter, worklet, gain, signal, onPauseCandidate: options.onPauseCandidate, onSpeechActivity: options.onSpeechActivity, onTerminal: options.onTerminal });
    session.start();
    return session;
  } catch (error) {
    cleanupSetup({ stream, context, source, filter, worklet, gain });
    if (context !== undefined) await context.close().catch(() => undefined);
    if (error instanceof SpeechCaptureError) throw error;
    throw new SpeechCaptureError("context_failed", error instanceof Error ? error.message : "Speech capture setup failed.");
  }
}

export function mapSpeechCaptureFailure(error: unknown): SpeechCaptureError {
  if (error instanceof SpeechCaptureError) return error;
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return new SpeechCaptureError("permission_denied", "Microphone permission was denied.");
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") return new SpeechCaptureError("device_unavailable", "No usable microphone was found.");
    if (error.name === "NotReadableError" || error.name === "AbortError") return new SpeechCaptureError("device_unavailable", "The microphone could not be started.");
  }
  return new SpeechCaptureError("device_unavailable", error instanceof Error ? error.message : "The microphone could not be started.");
}

class SpeechCaptureSessionImpl implements SpeechCaptureSession {
  private readonly chunks: SpeechChunkDeque;
  private readonly detector: SpeechPauseCandidateDetector;
  private acceptingMessages = true;
  private cleanupPromise: Promise<void> | undefined;
  private stopPromise: Promise<Float32Array> | undefined;
  private terminalPromise: Promise<void> | undefined;
  private terminalNotified = false;
  private captureFailure: SpeechCaptureError | undefined;
  private flushCounter = 0;
  private flushTail: Promise<void> = Promise.resolve();
  private pendingFlush: { readonly requestId: string; resolve(): void } | undefined;
  private readonly abortFromSignal = (): void => {
    void this.failTerminal(new SpeechCaptureError("cancelled", "Speech capture was cancelled."), { clearSamples: true, notifySamples: new Float32Array() });
  };
  private readonly onWorkletMessage = (event: MessageEvent<SpeechCaptureMessage>): void => {
    if (!this.acceptingMessages) return;
    const message = event.data;
    if (message.kind === "flushed") {
      if (this.pendingFlush?.requestId === message.requestId) {
        const pending = this.pendingFlush;
        this.pendingFlush = undefined;
        pending.resolve();
      }
      return;
    }
    if (message.kind === "limit") {
      void this.failTerminal(new SpeechCaptureError("limit_reached", "Speech capture reached the maximum turn duration."), { clearSamples: true, notifySamples: this.snapshotAndClear() });
      return;
    }
    this.chunks.push(message.samples, message.startSample);
    const candidate = this.detector.accept({
      startSample: message.startSample,
      endSample: message.endSample,
      sampleCount: message.samples.length,
      rms: message.rms,
      voiced: message.voiced,
    });
    if (message.voiced) this.options.onSpeechActivity?.({ startSample: message.startSample, endSample: message.endSample, sampleCount: message.samples.length });
    if (candidate !== undefined) this.options.onPauseCandidate?.({ endSample: candidate.endSample, samples: this.endpointWindow() });
  };
  private readonly onTrackEnded = (): void => {
    void this.failTerminal(new SpeechCaptureError("track_ended", "The microphone track ended."), { clearSamples: true, notifySamples: new Float32Array() });
  };

  public constructor(private readonly options: {
    readonly policy: SpeechRuntimePolicy;
    readonly stream: SpeechMediaStreamLike;
    readonly context: SpeechAudioContextLike;
    readonly source: SpeechAudioNodeLike;
    readonly filter: SpeechBiquadFilterLike | undefined;
    readonly worklet: SpeechAudioWorkletNodeLike;
    readonly gain: SpeechGainNodeLike;
    readonly signal: AbortSignal | undefined;
    readonly onPauseCandidate: SpeechCaptureOptions["onPauseCandidate"];
    readonly onSpeechActivity: SpeechCaptureOptions["onSpeechActivity"];
    readonly onTerminal: SpeechCaptureOptions["onTerminal"];
  }) {
    this.chunks = new SpeechChunkDeque(options.policy.audio.maxTurnSamples);
    this.detector = new SpeechPauseCandidateDetector({
      sampleRateHz: options.policy.audio.sampleRateHz,
      pauseAfterSpeechMs: options.policy.timing.pauseAfterSpeechMs,
      minNewVoicedAudioMs: options.policy.endpoint.minNewVoicedAudioMs,
      minIntervalMs: options.policy.endpoint.minIntervalMs,
    });
  }

  public get actualSampleRateHz(): number {
    return this.options.context.sampleRate;
  }

  public get failure(): SpeechCaptureError | undefined {
    return this.captureFailure;
  }

  public start(): void {
    this.options.worklet.port.addEventListener("message", this.onWorkletMessage);
    this.options.worklet.port.start?.();
    for (const track of this.options.stream.getAudioTracks()) track.addEventListener("ended", this.onTrackEnded, { once: true });
    if (this.options.signal?.aborted === true) this.abortFromSignal();
    else this.options.signal?.addEventListener("abort", this.abortFromSignal, { once: true });
  }

  public endpointWindow(): Float32Array {
    if (!this.acceptingMessages && this.cleanupPromise !== undefined) return new Float32Array();
    return this.chunks.flattenLatest(this.options.policy.audio.endpointWindowSamples);
  }

  public finalize(): Float32Array {
    if (!this.acceptingMessages && this.cleanupPromise !== undefined) return new Float32Array();
    return this.chunks.flattenAll();
  }

  public synchronize(): Promise<void> {
    return this.enqueueFlush(250);
  }

  public stopAndFinalize(): Promise<Float32Array> {
    this.stopPromise ??= this.stopAndFinalizeOnce();
    return this.stopPromise;
  }

  public async abort(): Promise<void> {
    this.captureFailure ??= new SpeechCaptureError("cancelled", "Speech capture was cancelled.");
    await this.failTerminal(this.captureFailure, { clearSamples: true, notifySamples: new Float32Array() });
  }

  private async stopAndFinalizeOnce(): Promise<Float32Array> {
    if (this.captureFailure !== undefined) {
      await this.cleanup({ clearSamples: true });
      return new Float32Array();
    }
    this.stopInputTracks();
    try {
      await this.enqueueFlush(250);
    } catch (error) {
      const captureError = error instanceof SpeechCaptureError ? error : new SpeechCaptureError("worklet_failed", "Speech capture worklet failed to flush before finalization.");
      await this.failTerminal(captureError, { clearSamples: true, notifySamples: new Float32Array() });
      throw captureError;
    }
    const samples = this.snapshotAndClear();
    await this.cleanup({ clearSamples: true });
    this.notifyTerminal({ kind: "finalized", samples });
    return samples;
  }

  private async failTerminal(error: SpeechCaptureError, options: { readonly clearSamples: boolean; readonly notifySamples: Float32Array }): Promise<void> {
    this.captureFailure ??= error;
    this.terminalPromise ??= (async () => {
      await this.cleanup({ clearSamples: options.clearSamples });
      this.notifyTerminal({ kind: "failed", error: this.captureFailure ?? error, samples: options.notifySamples });
    })();
    await this.terminalPromise;
  }

  private enqueueFlush(timeoutMs: number): Promise<void> {
    const requested = this.flushTail.then(() => this.requestFlush(timeoutMs));
    this.flushTail = requested.catch(() => undefined);
    return requested;
  }

  private requestFlush(timeoutMs: number): Promise<void> {
    if (!this.acceptingMessages) return Promise.resolve();
    const requestId = `flush-${String(++this.flushCounter)}`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (this.pendingFlush?.requestId === requestId) this.pendingFlush = undefined;
        reject(new SpeechCaptureError("worklet_failed", "Speech capture worklet failed to flush before finalization."));
      }, timeoutMs);
      this.pendingFlush = {
        requestId,
        resolve: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        },
      };
      try {
        this.options.worklet.port.postMessage({ kind: "flush", requestId });
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        if (this.pendingFlush.requestId === requestId) this.pendingFlush = undefined;
        reject(new SpeechCaptureError("worklet_failed", error instanceof Error ? error.message : "Speech capture worklet failed to flush before finalization."));
      }
    });
  }

  private snapshotAndClear(): Float32Array {
    const samples = this.chunks.flattenAll();
    this.chunks.clear();
    return samples;
  }

  private notifyTerminal(terminal: SpeechCaptureTerminal): void {
    if (this.terminalNotified) return;
    this.terminalNotified = true;
    this.options.onTerminal?.(terminal);
  }

  private cleanup(options: { readonly clearSamples: boolean }): Promise<void> {
    this.cleanupPromise ??= (async () => {
      this.acceptingMessages = false;
      this.pendingFlush = undefined;
      this.options.signal?.removeEventListener("abort", this.abortFromSignal);
      this.options.worklet.port.removeEventListener("message", this.onWorkletMessage);
      this.options.worklet.port.close?.();
      this.options.worklet.disconnect?.();
      this.options.gain.disconnect?.();
      this.options.filter?.disconnect?.();
      this.options.source.disconnect?.();
      this.stopInputTracks();
      await this.options.context.close().catch(() => undefined);
      if (options.clearSamples) this.chunks.clear();
    })();
    if (options.clearSamples) this.chunks.clear();
    return this.cleanupPromise;
  }

  private stopInputTracks(): void {
    for (const track of this.options.stream.getAudioTracks()) {
      track.removeEventListener("ended", this.onTrackEnded);
      track.stop();
    }
  }
}

function microphoneConstraints(): MediaStreamConstraints {
  return {
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
}

function defaultSpeechCaptureBrowserHost(): SpeechCaptureBrowserHost {
  return {
    mediaDevices: navigator.mediaDevices,
    createAudioContext: (options) => new AudioContext(options),
    createAudioWorkletNode: (context, name, options) => {
      if (!(context instanceof BaseAudioContext)) throw new SpeechCaptureError("context_failed", "AudioContext is not available.");
      return new AudioWorkletNode(context, name, options);
    },
  };
}

function throwIfCaptureAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new SpeechCaptureError("cancelled", "Speech capture was cancelled.");
}

async function ensureAudioContextRunning(context: SpeechAudioContextLike): Promise<void> {
  if (context.state === "suspended") {
    if (context.resume === undefined) throw new SpeechCaptureError("context_failed", "Speech capture audio context could not be resumed.");
    await context.resume().catch((error: unknown) => {
      throw new SpeechCaptureError("context_failed", error instanceof Error ? error.message : "Speech capture audio context could not be resumed.");
    });
  }
  if (context.state === "suspended" || context.state === "closed") throw new SpeechCaptureError("context_failed", "Speech capture audio context could not be started.");
}

function cleanupSetup(options: {
  readonly stream: SpeechMediaStreamLike | undefined;
  readonly context: SpeechAudioContextLike | undefined;
  readonly source: SpeechAudioNodeLike | undefined;
  readonly filter: SpeechBiquadFilterLike | undefined;
  readonly worklet: SpeechAudioWorkletNodeLike | undefined;
  readonly gain: SpeechGainNodeLike | undefined;
}): void {
  options.worklet?.port.close?.();
  options.worklet?.disconnect?.();
  options.gain?.disconnect?.();
  options.filter?.disconnect?.();
  options.source?.disconnect?.();
  stopStream(options.stream);
}

function stopStream(stream: SpeechMediaStreamLike | undefined): void {
  if (stream === undefined) return;
  for (const track of stream.getAudioTracks()) track.stop();
}

function msToSamples(ms: number, sampleRateHz: number): number {
  return Math.round(ms * sampleRateHz / 1_000);
}
