import { SpeechApiError, type SpeechApiRequestOptions } from "../api/speech";
import { SpeechCaptureError, type SpeechCaptureSession, type SpeechCaptureTerminal } from "../speechCapture";
import { SPEECH_POLICY, type SpeechRuntimePolicy } from "../../../shared/speechPolicy";
import type { SpeechTranscriptionResponse, SpeechTurnDecisionResponse } from "../../../shared/speechContracts";

export type PromptDictationGestureFact = "pressing" | "held" | "released";
export type PromptDictationCapability = "ready" | "manual-only" | "warming" | "unavailable";

export type PromptDictationState =
  | { readonly tag: "unavailable"; readonly reason: string }
  | { readonly tag: "idle" }
  | { readonly tag: "acquiring"; readonly gesture: PromptDictationGestureFact }
  | { readonly tag: "pressed" }
  | { readonly tag: "auto" }
  | { readonly tag: "held" }
  | { readonly tag: "manual-only"; readonly reason: PromptDictationManualReason }
  | { readonly tag: "checking" }
  | { readonly tag: "transcribing" }
  | { readonly tag: "empty" }
  | { readonly tag: "retained-retry"; readonly expiresAtMs: number; readonly reason: string }
  | { readonly tag: "error"; readonly reason: PromptDictationErrorReason; readonly message: string; readonly retryable: boolean };

export type PromptDictationManualReason = "detector-failed" | "endpoint-busy" | "endpoint-budget" | "endpoint-failed" | "smart-turn-unavailable";
export type PromptDictationErrorReason = "capture-failed" | "permission-denied" | "initial-speech-timeout" | "transcription-failed" | "cancelled";

export interface PromptDictationDraftOwner {
  readonly ownerKey: string;
  beginDictation(): boolean;
  commitTranscript(transcript: string): boolean;
  finishDictation(): void;
  abortDictation(): void;
}

export interface PromptDictationSpeechApi {
  checkTurn(samples: Float32Array, options?: SpeechApiRequestOptions): Promise<SpeechTurnDecisionResponse>;
  transcribe(samples: Float32Array, options?: SpeechApiRequestOptions): Promise<SpeechTranscriptionResponse>;
}

export interface PromptDictationScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PromptDictationControllerOptions {
  readonly policy?: SpeechRuntimePolicy;
  readonly scheduler: PromptDictationScheduler;
  readonly draft: PromptDictationDraftOwner;
  readonly speechApi: PromptDictationSpeechApi;
  readonly createCaptureSession: (options: PromptDictationCaptureOptions) => Promise<SpeechCaptureSession>;
  readonly onStateChange?: (state: PromptDictationState) => void;
}

export interface PromptDictationCaptureOptions {
  readonly signal: AbortSignal;
  readonly policy: SpeechRuntimePolicy;
  readonly onPauseCandidate: (candidate: { readonly samples: Float32Array; readonly endSample: number }) => void;
  readonly onSpeechActivity: (activity: { readonly startSample: number; readonly endSample: number; readonly sampleCount: number }) => void;
  readonly onTerminal: (terminal: SpeechCaptureTerminal) => void;
}

const idleState: PromptDictationState = { tag: "idle" };
const defaultUnavailableMessage = "Speech dictation is unavailable.";

type DictationCapabilityState =
  | { readonly tag: "ready" }
  | { readonly tag: "manual-only"; readonly reason: PromptDictationManualReason }
  | { readonly tag: "warming" | "unavailable"; readonly reason: string };

export class PromptDictationController {
  private readonly policy: SpeechRuntimePolicy;
  private stateValue: PromptDictationState = idleState;
  private capability: DictationCapabilityState = { tag: "ready" };
  private capabilityVersion = 0;
  private generation = 0;
  private captureGeneration = 0;
  private requestGeneration = 0;
  private initialOwnerKey = this.options.draft.ownerKey;
  private capture: SpeechCaptureSession | undefined;
  private captureAbort: AbortController | undefined;
  private endpointAbort: AbortController | undefined;
  private transcriptionAbort: AbortController | undefined;
  private holdTimer: unknown;
  private initialSpeechTimer: unknown;
  private retryExpiryTimer: unknown;
  private endpointCompletionTimer: unknown;
  private endpointRequests = 0;
  private endpointBytes = 0;
  private endpointCandidateEmitted = false;
  private endpointLastCandidateEndSample = Number.NEGATIVE_INFINITY;
  private endpointVoicedSamplesSinceCandidate = 0;
  private speechStarted = false;
  private completing = false;
  private finalSamplesSelected = false;
  private retained: { readonly samples: Float32Array; readonly ownerKey: string; readonly expiresAtMs: number } | undefined;
  private draftLocked = false;
  private disposed = false;

  public constructor(private readonly options: PromptDictationControllerOptions) {
    this.policy = options.policy ?? SPEECH_POLICY;
  }

  public get state(): PromptDictationState {
    return this.stateValue;
  }

  public press(): boolean {
    if (this.disposed) return false;
    if (this.stateValue.tag !== "idle" && this.stateValue.tag !== "error" && this.stateValue.tag !== "empty" && !this.isOwnerCurrent()) return false;
    if (this.stateValue.tag === "retained-retry") return this.retryRetained();
    if (this.stateValue.tag === "unavailable" || this.stateValue.tag === "transcribing") return false;
    if (this.stateValue.tag === "auto" || this.stateValue.tag === "manual-only" || this.stateValue.tag === "checking" || this.stateValue.tag === "held") {
      void this.completeFromCurrentCapture();
      return true;
    }
    if (this.stateValue.tag !== "idle" && this.stateValue.tag !== "error" && this.stateValue.tag !== "empty") return false;
    if (this.capability.tag === "warming" || this.capability.tag === "unavailable") {
      this.setState({ tag: "unavailable", reason: this.capability.reason });
      return false;
    }

    this.clearRetained();
    this.generation += 1;
    this.captureGeneration += 1;
    this.requestGeneration += 1;
    this.endpointRequests = 0;
    this.endpointBytes = 0;
    this.endpointCandidateEmitted = false;
    this.endpointLastCandidateEndSample = Number.NEGATIVE_INFINITY;
    this.endpointVoicedSamplesSinceCandidate = 0;
    this.speechStarted = false;
    this.completing = false;
    this.finalSamplesSelected = false;
    this.clearEndpointCompletionTimer();
    this.initialOwnerKey = this.options.draft.ownerKey;
    this.draftLocked = this.options.draft.beginDictation();
    if (!this.draftLocked) {
      this.setState({ tag: "error", reason: "cancelled", message: "Dictation could not lock the composer draft.", retryable: false });
      return false;
    }

    const generation = this.generation;
    const captureGeneration = this.captureGeneration;
    const ownerKey = this.initialOwnerKey;
    const abort = new AbortController();
    this.captureAbort = abort;
    this.setState({ tag: "acquiring", gesture: "pressing" });
    this.armHoldTimer(generation);

    void this.options.createCaptureSession({
      signal: abort.signal,
      policy: this.policy,
      onPauseCandidate: (candidate) => { this.handlePauseCandidate(candidate, generation, captureGeneration, ownerKey); },
      onSpeechActivity: (activity) => { this.handleSpeechActivity(activity, generation, ownerKey); },
      onTerminal: (terminal) => { this.handleCaptureTerminal(terminal, generation, captureGeneration, ownerKey); },
    }).then((capture) => {
      if (!this.accepts(generation, ownerKey) || this.captureAbort !== abort || abort.signal.aborted) {
        void capture.abort();
        return;
      }
      this.capture = capture;
      this.armInitialSpeechTimer(generation);
      this.resolveAcquisitionLatch();
    }).catch((error: unknown) => {
      if (!this.accepts(generation, ownerKey)) return;
      this.clearHoldTimer();
      this.clearInitialSpeechTimer();
      this.captureAbort = undefined;
      this.abortDraftLock();
      this.setState(captureSetupErrorState(error));
    });
    return true;
  }

  public release(): boolean {
    if (this.stateValue.tag === "acquiring") {
      this.clearHoldTimer();
      this.setState({ tag: "acquiring", gesture: "released" });
      return true;
    }
    if (this.stateValue.tag === "pressed") {
      this.clearHoldTimer();
      this.setState(this.autoStateForCapability());
      return true;
    }
    if (this.stateValue.tag === "held") {
      void this.completeFromCurrentCapture();
      return true;
    }
    return false;
  }

  public cancel(): void {
    void this.abortCurrent("cancelled", "Speech dictation was cancelled.");
  }

  public retryRetained(): boolean {
    if (this.stateValue.tag !== "retained-retry" || this.retained === undefined) return false;
    if (!this.isOwnerCurrent() || this.retained.ownerKey !== this.options.draft.ownerKey) {
      this.clearRetained();
      this.abortDraftLock();
      this.setState(idleState);
      return false;
    }
    this.clearRetryExpiryTimer();
    void this.transcribeFinalSamples(this.retained.samples, this.generation, this.retained.ownerKey, { retainedRetry: true });
    return true;
  }

  public discardRetained(): boolean {
    if (this.stateValue.tag !== "retained-retry") return false;
    this.clearRetained();
    this.abortDraftLock();
    this.setState(idleState);
    return true;
  }

  public setCapability(capability: PromptDictationCapability, reason = defaultUnavailableMessage): void {
    if (this.disposed) return;
    this.capabilityVersion += 1;
    const version = this.capabilityVersion;
    if (capability === "ready") {
      this.capability = { tag: "ready" };
      if (this.stateValue.tag === "unavailable") this.setState(idleState);
      return;
    }
    if (capability === "manual-only") {
      const manualReason = manualOnlyReason(reason);
      this.capability = { tag: "manual-only", reason: manualReason };
      this.requestGeneration += 1;
      this.endpointAbort?.abort();
      this.endpointAbort = undefined;
      this.clearEndpointCompletionTimer();
      if (this.stateValue.tag === "auto" || this.stateValue.tag === "checking") this.setState({ tag: "manual-only", reason: manualReason });
      if (this.stateValue.tag === "unavailable") this.setState(idleState);
      return;
    }

    this.capability = { tag: capability, reason };
    const unavailableState: PromptDictationState = { tag: "unavailable", reason };
    this.setState(unavailableState);
    void (async () => {
      await this.abortCurrent("cancelled", reason, { silent: true });
      if (this.capabilityVersion === version && !this.disposed) this.setState(unavailableState);
    })();
  }

  public ownerChanged(): void {
    if (this.options.draft.ownerKey === this.initialOwnerKey) return;
    void this.abortCurrent("cancelled", "Speech dictation owner changed.");
  }

  public surfaceDisabled(): void {
    void this.abortCurrent("cancelled", "Speech dictation surface is no longer active.");
  }

  public pageBackgrounded(): void {
    void this.abortCurrent("cancelled", "Speech dictation stopped because the page lost ownership.");
  }

  public resizeOrOrientationChanged(): void {
    // The controller has no viewport-owned state. Foreground resize and rotation are no-ops.
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.abortCurrent("cancelled", "Speech dictation controller was disposed.", { silent: true });
  }

  private resolveAcquisitionLatch(): void {
    if (this.stateValue.tag !== "acquiring") return;
    if (this.stateValue.gesture === "released") {
      this.clearHoldTimer();
      this.setState(this.autoStateForCapability());
      return;
    }
    if (this.stateValue.gesture === "held") {
      this.setState({ tag: "held" });
      return;
    }
    this.setState({ tag: "pressed" });
  }

  private armHoldTimer(generation: number): void {
    this.clearHoldTimer();
    this.holdTimer = this.options.scheduler.setTimeout(() => {
      if (!this.acceptsGeneration(generation)) return;
      if (this.stateValue.tag === "acquiring" && this.stateValue.gesture === "pressing") {
        this.setState({ tag: "acquiring", gesture: "held" });
      } else if (this.stateValue.tag === "pressed") {
        this.setState({ tag: "held" });
      }
    }, this.policy.timing.holdThresholdMs);
  }

  private armInitialSpeechTimer(generation: number): void {
    this.clearInitialSpeechTimer();
    this.initialSpeechTimer = this.options.scheduler.setTimeout(() => {
      if (!this.acceptsGeneration(generation) || this.speechStarted) return;
      void this.abortCurrent("initial-speech-timeout", "No speech was detected before the initial timeout.");
    }, this.policy.timing.initialSpeechTimeoutMs);
  }

  private handleSpeechActivity(activity: { readonly startSample: number; readonly endSample: number; readonly sampleCount: number }, generation: number, ownerKey: string): void {
    if (!this.accepts(generation, ownerKey)) return;
    this.speechStarted = true;
    this.endpointVoicedSamplesSinceCandidate += activity.sampleCount;
    this.clearInitialSpeechTimer();
    if (this.stateValue.tag === "checking") {
      this.requestGeneration += 1;
      this.endpointAbort?.abort();
      this.endpointAbort = undefined;
      this.clearEndpointCompletionTimer();
      this.setState(this.autoStateForCapability());
    }
  }

  private handlePauseCandidate(candidate: { readonly samples: Float32Array; readonly endSample: number }, generation: number, captureGeneration: number, ownerKey: string): void {
    if (!this.accepts(generation, ownerKey) || captureGeneration !== this.captureGeneration) return;
    if (this.stateValue.tag !== "auto") return;
    if (this.capability.tag === "manual-only") {
      this.setState({ tag: "manual-only", reason: this.capability.reason });
      return;
    }
    if (this.capability.tag !== "ready") return;

    const endpointAdmission = this.endpointAdmission(candidate);
    if (endpointAdmission === "suppressed") return;
    if (endpointAdmission === "budget-exhausted") {
      this.setState({ tag: "manual-only", reason: "endpoint-budget" });
      return;
    }

    this.endpointRequests += 1;
    this.endpointBytes += candidate.samples.byteLength;
    this.endpointCandidateEmitted = true;
    this.endpointLastCandidateEndSample = candidate.endSample;
    this.endpointVoicedSamplesSinceCandidate = 0;
    this.requestGeneration += 1;
    const requestGeneration = this.requestGeneration;
    const abort = new AbortController();
    this.endpointAbort = abort;
    this.setState({ tag: "checking" });
    void this.options.speechApi.checkTurn(candidate.samples, { signal: abort.signal, timeoutMs: this.policy.timing.endpointDeadlineMs }).then((decision) => {
      if (!this.acceptsRequest(generation, requestGeneration, ownerKey) || abort.signal.aborted) return;
      this.endpointAbort = undefined;
      if (decision.complete) {
        this.scheduleEndpointCompletion(generation, ownerKey);
      } else {
        this.setState(this.autoStateForCapability());
      }
    }).catch((error: unknown) => {
      if (!this.acceptsRequest(generation, requestGeneration, ownerKey)) return;
      this.endpointAbort = undefined;
      if (isCancelledError(error)) {
        this.setState(this.autoStateForCapability());
      } else {
        this.setState({ tag: "manual-only", reason: endpointManualReason(error) });
      }
    });
  }

  private scheduleEndpointCompletion(generation: number, ownerKey: string): void {
    this.clearEndpointCompletionTimer();
    this.endpointCompletionTimer = this.options.scheduler.setTimeout(() => {
      this.endpointCompletionTimer = undefined;
      if (!this.accepts(generation, ownerKey)) return;
      void this.completeFromCurrentCapture();
    }, this.policy.timing.endpointCompletionGraceMs);
  }

  private endpointAdmission(candidate: { readonly samples: Float32Array; readonly endSample: number }): "allowed" | "budget-exhausted" | "suppressed" {
    const nextRequests = this.endpointRequests + 1;
    const nextBytes = this.endpointBytes + candidate.samples.byteLength;
    if (nextRequests > this.policy.endpoint.maxRequestsPerTurn || nextBytes > this.policy.endpoint.maxBytesPerTurn) return "budget-exhausted";
    if (!this.endpointCandidateEmitted) return "allowed";
    const minIntervalSamples = msToSamples(this.policy.endpoint.minIntervalMs, this.policy.audio.sampleRateHz);
    const minNewVoicedSamples = msToSamples(this.policy.endpoint.minNewVoicedAudioMs, this.policy.audio.sampleRateHz);
    const intervalSamples = candidate.endSample - this.endpointLastCandidateEndSample;
    if (intervalSamples < minIntervalSamples || this.endpointVoicedSamplesSinceCandidate < minNewVoicedSamples) return "suppressed";
    return "allowed";
  }

  private handleCaptureTerminal(terminal: SpeechCaptureTerminal, generation: number, captureGeneration: number, ownerKey: string): void {
    if (!this.accepts(generation, ownerKey) || captureGeneration !== this.captureGeneration) return;
    if (terminal.kind === "finalized") return;
    if (terminal.error.kind === "limit_reached") {
      void this.completeWithFinalSamples(terminal.samples, generation, ownerKey);
      return;
    }
    if (this.completing) return;
    void this.abortCurrent("capture-failed", terminal.error.message);
  }

  private async completeFromCurrentCapture(): Promise<void> {
    if (this.completing || this.capture === undefined || !this.isOwnerCurrent()) return;
    const generation = this.generation;
    const ownerKey = this.initialOwnerKey;
    const capture = this.capture;
    if (!this.prepareCompletion(generation, ownerKey)) return;
    let samples: Float32Array;
    try {
      samples = await capture.stopAndFinalize();
    } catch (error) {
      if (!this.accepts(generation, ownerKey) || this.finalSamplesSelected) return;
      await this.abortCurrent("capture-failed", error instanceof Error ? error.message : "Speech capture could not finalize.");
      return;
    }
    await this.completeWithFinalSamples(samples, generation, ownerKey);
  }

  private async completeWithFinalSamples(samples: Float32Array, generation: number, ownerKey: string): Promise<void> {
    if (!this.prepareCompletion(generation, ownerKey) || this.finalSamplesSelected) return;
    this.finalSamplesSelected = true;
    this.capture = undefined;
    this.captureAbort = undefined;
    await this.transcribeFinalSamples(samples, generation, ownerKey, { retainedRetry: false });
  }

  private prepareCompletion(generation: number, ownerKey: string): boolean {
    if (!this.accepts(generation, ownerKey)) return false;
    this.completing = true;
    this.requestGeneration += 1;
    this.endpointAbort?.abort();
    this.endpointAbort = undefined;
    this.clearHoldTimer();
    this.clearInitialSpeechTimer();
    this.clearEndpointCompletionTimer();
    this.setState({ tag: "transcribing" });
    return true;
  }

  private async transcribeFinalSamples(samples: Float32Array, generation: number, ownerKey: string, options: { readonly retainedRetry: boolean }): Promise<void> {
    if (!this.accepts(generation, ownerKey)) return;
    this.setState({ tag: "transcribing" });
    this.transcriptionAbort?.abort();
    const abort = new AbortController();
    this.transcriptionAbort = abort;
    try {
      const response = await this.options.speechApi.transcribe(samples, { signal: abort.signal, timeoutMs: this.policy.timing.operationDeadlineMs });
      if (!this.accepts(generation, ownerKey) || this.transcriptionAbort !== abort || abort.signal.aborted) return;
      this.transcriptionAbort = undefined;
      this.clearRetained();
      if (response.text.trim() === "") {
        this.finishDraftLock();
        this.setState({ tag: "empty" });
        return;
      }
      if (!this.options.draft.commitTranscript(response.text)) {
        this.abortDraftLock();
        this.setState({ tag: "error", reason: "transcription-failed", message: "Dictation transcript could not be inserted.", retryable: false });
        return;
      }
      this.finishDraftLock();
      this.setState(idleState);
    } catch (error) {
      if (!this.accepts(generation, ownerKey) || this.transcriptionAbort !== abort) return;
      this.transcriptionAbort = undefined;
      if (isCancelledError(error)) return;
      if (isRetryableTranscriptionError(error)) {
        this.retainFinalSamples(samples, ownerKey, retryReason(error));
        return;
      }
      this.clearRetained();
      this.finishDraftLock();
      this.setState({ tag: "error", reason: "transcription-failed", message: errorMessage(error), retryable: false });
    } finally {
      if (!options.retainedRetry && this.capture === undefined) this.completing = false;
    }
  }

  private retainFinalSamples(samples: Float32Array, ownerKey: string, reason: string): void {
    this.clearRetryExpiryTimer();
    const copy = new Float32Array(samples);
    const expiresAtMs = this.options.scheduler.now() + this.policy.timing.finalRetryTtlMs;
    this.retained = { samples: copy, ownerKey, expiresAtMs };
    this.retryExpiryTimer = this.options.scheduler.setTimeout(() => {
      if (this.retained?.ownerKey !== ownerKey || this.retained.expiresAtMs !== expiresAtMs) return;
      this.clearRetained();
      this.abortDraftLock();
      this.setState(idleState);
    }, this.policy.timing.finalRetryTtlMs);
    this.setState({ tag: "retained-retry", expiresAtMs, reason });
  }

  private async abortCurrent(reason: PromptDictationErrorReason, message: string, options: { readonly silent?: boolean } = {}): Promise<void> {
    this.generation += 1;
    this.captureGeneration += 1;
    this.requestGeneration += 1;
    this.clearHoldTimer();
    this.clearInitialSpeechTimer();
    this.clearEndpointCompletionTimer();
    this.clearRetained();
    this.endpointAbort?.abort();
    this.endpointAbort = undefined;
    this.transcriptionAbort?.abort();
    this.transcriptionAbort = undefined;
    this.captureAbort?.abort();
    this.captureAbort = undefined;
    const capture = this.capture;
    this.capture = undefined;
    this.completing = false;
    this.finalSamplesSelected = false;
    this.abortDraftLock();
    if (options.silent !== true) {
      this.setState(reason === "cancelled" ? idleState : { tag: "error", reason, message, retryable: reason !== "permission-denied" });
    }
    if (capture !== undefined) await capture.abort().catch(() => undefined);
  }

  private autoStateForCapability(): PromptDictationState {
    return this.capability.tag === "manual-only" ? { tag: "manual-only", reason: this.capability.reason } : { tag: "auto" };
  }

  private clearRetained(): void {
    this.retained = undefined;
    this.clearRetryExpiryTimer();
  }

  private clearHoldTimer(): void {
    if (this.holdTimer === undefined) return;
    this.options.scheduler.clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
  }

  private clearInitialSpeechTimer(): void {
    if (this.initialSpeechTimer === undefined) return;
    this.options.scheduler.clearTimeout(this.initialSpeechTimer);
    this.initialSpeechTimer = undefined;
  }

  private clearRetryExpiryTimer(): void {
    if (this.retryExpiryTimer === undefined) return;
    this.options.scheduler.clearTimeout(this.retryExpiryTimer);
    this.retryExpiryTimer = undefined;
  }

  private clearEndpointCompletionTimer(): void {
    if (this.endpointCompletionTimer === undefined) return;
    this.options.scheduler.clearTimeout(this.endpointCompletionTimer);
    this.endpointCompletionTimer = undefined;
  }

  private accepts(generation: number, ownerKey: string): boolean {
    return this.acceptsGeneration(generation) && this.initialOwnerKey === ownerKey && this.isOwnerCurrent();
  }

  private acceptsGeneration(generation: number): boolean {
    return !this.disposed && this.generation === generation;
  }

  private acceptsRequest(generation: number, requestGeneration: number, ownerKey: string): boolean {
    return this.accepts(generation, ownerKey) && this.requestGeneration === requestGeneration;
  }

  private isOwnerCurrent(): boolean {
    return this.options.draft.ownerKey === this.initialOwnerKey;
  }

  private finishDraftLock(): void {
    if (!this.draftLocked) return;
    this.draftLocked = false;
    this.options.draft.finishDictation();
  }

  private abortDraftLock(): void {
    if (!this.draftLocked) return;
    this.draftLocked = false;
    this.options.draft.abortDictation();
  }

  private setState(state: PromptDictationState): void {
    this.stateValue = state;
    if (!this.disposed) this.options.onStateChange?.(state);
  }
}

function captureSetupErrorState(error: unknown): PromptDictationState {
  if (error instanceof SpeechCaptureError && error.kind === "permission_denied") {
    return { tag: "error", reason: "permission-denied", message: error.message, retryable: false };
  }
  return { tag: "error", reason: "capture-failed", message: errorMessage(error), retryable: true };
}

function endpointManualReason(error: unknown): PromptDictationManualReason {
  if (error instanceof SpeechApiError) {
    if (error.kind === "speech_unavailable") return "smart-turn-unavailable";
    if (error.kind === "speech_failed") return "detector-failed";
    if (error.kind === "overloaded") return "endpoint-busy";
  }
  return "endpoint-failed";
}

function manualOnlyReason(reason: string): PromptDictationManualReason {
  if (reason === "detector-failed" || reason === "endpoint-busy" || reason === "endpoint-budget" || reason === "endpoint-failed" || reason === "smart-turn-unavailable") return reason;
  return "smart-turn-unavailable";
}

function isRetryableTranscriptionError(error: unknown): boolean {
  if (error instanceof SpeechApiError) {
    return error.retryable && (error.kind === "overloaded" || error.kind === "network" || error.kind === "timeout" || error.kind === "speech_failed" || error.kind === "speech_unavailable");
  }
  return retryableError(error);
}

function isCancelledError(error: unknown): boolean {
  if (error instanceof SpeechApiError) return error.kind === "cancelled";
  if (error instanceof SpeechCaptureError) return error.kind === "cancelled";
  return false;
}

function retryableError(error: unknown): boolean {
  if (error instanceof SpeechApiError || error instanceof SpeechCaptureError) return error.retryable;
  return false;
}

function retryReason(error: unknown): string {
  if (error instanceof SpeechApiError) return error.kind;
  return errorMessage(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Speech dictation failed.";
}

function msToSamples(ms: number, sampleRateHz: number): number {
  return Math.round(ms * sampleRateHz / 1_000);
}
