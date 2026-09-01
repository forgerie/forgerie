import { describe, expect, it, vi } from "vitest";
import { SpeechApiError } from "../api/speech";
import { SpeechCaptureError, type SpeechCaptureSession, type SpeechCaptureTerminal } from "../speechCapture";
import { SPEECH_POLICY, type SpeechRuntimePolicy } from "../../../shared/speechPolicy";
import type { SpeechTranscriptionResponse, SpeechTurnDecisionResponse } from "../../../shared/speechContracts";
import { PromptDictationController, type PromptDictationCaptureOptions, type PromptDictationDraftOwner, type PromptDictationScheduler, type PromptDictationSpeechApi, type PromptDictationState } from "./promptDictationController";

describe("PromptDictationController", () => {
  it("covers AE1: press locks synchronously, short release enters auto, complete endpoint transcribes and commits once", async () => {
    const harness = createHarness();
    const captureReady = deferred<SpeechCaptureSession>();
    let captureOptions: PromptDictationCaptureOptions | undefined;
    harness.createCaptureSession.mockImplementation((options) => {
      captureOptions = options;
      return captureReady.promise;
    });

    expect(harness.controller.press()).toBe(true);
    expect(harness.draft.events).toEqual(["begin:owner-a"]);
    expect(harness.state()).toEqual({ tag: "acquiring", gesture: "pressing" });

    expect(harness.controller.release()).toBe(true);
    expect(harness.state()).toEqual({ tag: "acquiring", gesture: "released" });

    const capture = fakeCapture(turn(1, 2, 3));
    captureReady.resolve(capture);
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "auto" });

    harness.checkTurn.mockResolvedValue({ complete: true, probability: 0.93, samples: 3 });
    harness.transcribe.mockResolvedValue({ text: "hello Forgerie" });
    captureOptions?.onPauseCandidate({ samples: new Float32Array([0.1, 0.2, 0.3]), endSample: 3 });
    await flushPromises();
    harness.scheduler.advance(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await flushPromises();
    await flushPromises();

    expect(capture.stopCalls).toBe(1);
    expect(harness.checkTurn).toHaveBeenCalledOnce();
    expect(harness.transcribe).toHaveBeenCalledOnce();
    expect(harness.draft.events).toEqual(["begin:owner-a", "commit:hello Forgerie", "finish"]);
    expect(harness.state()).toEqual({ tag: "idle" });
  });

  it("latches acquisition release and hold threshold without creating a zero-audio completion", async () => {
    const harness = createHarness();
    const captureReady = deferred<SpeechCaptureSession>();
    harness.createCaptureSession.mockReturnValue(captureReady.promise);

    harness.controller.press();
    harness.scheduler.advance(SPEECH_POLICY.timing.holdThresholdMs);
    expect(harness.state()).toEqual({ tag: "acquiring", gesture: "held" });
    harness.controller.release();
    expect(harness.state()).toEqual({ tag: "acquiring", gesture: "released" });

    const capture = fakeCapture(turn(9));
    captureReady.resolve(capture);
    await flushPromises();

    expect(harness.state()).toEqual({ tag: "auto" });
    expect(capture.stopCalls).toBe(0);
    expect(harness.transcribe).not.toHaveBeenCalled();
  });

  it("aborts pending acquisition on pointercancel, permission prompt focus loss, denial, and owner loss without stuck locks", async () => {
    const harness = createHarness();
    const captureReady = deferred<SpeechCaptureSession>();
    harness.createCaptureSession.mockReturnValue(captureReady.promise);

    harness.controller.press();
    harness.controller.cancel();
    const lateCapture = fakeCapture(turn(1));
    captureReady.resolve(lateCapture);
    await flushPromises();

    expect(lateCapture.abortCalls).toBe(1);
    expect(harness.draft.events).toEqual(["begin:owner-a", "abort"]);
    expect(harness.state()).toEqual({ tag: "idle" });

    const denied = createHarness();
    denied.createCaptureSession.mockRejectedValue(new SpeechCaptureError("permission_denied", "denied"));
    denied.controller.press();
    await flushPromises();
    expect(denied.draft.events).toEqual(["begin:owner-a", "abort"]);
    expect(denied.state()).toMatchObject({ tag: "error", reason: "permission-denied" });

    const ownerLost = createHarness();
    const ownerCapture = deferred<SpeechCaptureSession>();
    ownerLost.createCaptureSession.mockReturnValue(ownerCapture.promise);
    ownerLost.controller.press();
    ownerLost.draft.ownerKeyValue = "owner-b";
    ownerLost.controller.ownerChanged();
    ownerCapture.resolve(fakeCapture(turn(1)));
    await flushPromises();
    expect(ownerLost.draft.events).toEqual(["begin:owner-a", "abort"]);
    expect(ownerLost.state()).toEqual({ tag: "idle" });
  });

  it("covers AE2: incomplete endpoint returns to auto and a later pause can complete", async () => {
    const harness = await startedAutoHarness();
    const first = deferred<SpeechTurnDecisionResponse>();
    const second = deferred<SpeechTurnDecisionResponse>();
    harness.checkTurn.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    harness.transcribe.mockResolvedValue({ text: "done" });

    harness.pause([1]);
    first.resolve({ complete: false, probability: 0.2, samples: 1 });
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "auto" });

    harness.activity(1, SPEECH_POLICY.audio.sampleRateHz);
    harness.pause([2], 1 + SPEECH_POLICY.audio.sampleRateHz);
    second.resolve({ complete: true, probability: 0.9, samples: 1 });
    await flushPromises();
    harness.scheduler.advance(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await flushPromises();
    await flushPromises();

    expect(harness.checkTurn).toHaveBeenCalledTimes(2);
    expect(harness.transcribe).toHaveBeenCalledOnce();
    expect(harness.draft.events).toContain("commit:done");
  });

  it("covers AE3: hold suppresses endpointing until release and transcribes the full turn once", async () => {
    const harness = createHarness();
    const capture = fakeCapture(turn(1, 2, 3, 4));
    harness.createCaptureSession.mockResolvedValue(capture);
    harness.controller.press();
    await flushPromises();
    harness.scheduler.advance(SPEECH_POLICY.timing.holdThresholdMs);
    expect(harness.state()).toEqual({ tag: "held" });

    harness.pause([1, 2]);
    expect(harness.checkTurn).not.toHaveBeenCalled();

    harness.transcribe.mockResolvedValue({ text: "held turn" });
    harness.controller.release();
    await flushPromises();
    await flushPromises();

    expect(capture.stopCalls).toBe(1);
    expect(harness.transcribe.mock.calls[0]?.[0]).toEqual(new Float32Array(turn(1, 2, 3, 4)));
    expect(harness.draft.events).toEqual(["begin:owner-a", "commit:held turn", "finish"]);
  });

  it("manual completion by second press in auto/manual/checking completes immediately without a new capture or hold timer", async () => {
    const harness = await startedAutoHarness();
    harness.transcribe.mockResolvedValue({ text: "manual" });

    expect(harness.controller.press()).toBe(true);
    await flushPromises();
    await flushPromises();

    expect(harness.createCaptureSession).toHaveBeenCalledOnce();
    expect(harness.scheduler.delayCount(SPEECH_POLICY.timing.holdThresholdMs)).toBe(1);
    expect(harness.draft.events).toContain("commit:manual");

    const manualOnly = await startedAutoHarness();
    manualOnly.setStateByEndpointFailure();
    manualOnly.transcribe.mockResolvedValue({ text: "manual only" });
    manualOnly.controller.press();
    await flushPromises();
    await flushPromises();
    expect(manualOnly.createCaptureSession).toHaveBeenCalledOnce();
    expect(manualOnly.transcribe).toHaveBeenCalledOnce();
  });

  it("covers AE5: detector/backend failure enters manual-only without audio loss; manual completion still transcribes", async () => {
    const harness = await startedAutoHarness(turn(7, 8));
    harness.checkTurn.mockRejectedValue(new SpeechApiError("overloaded", "busy", { retryable: true }));

    harness.pause([7, 8]);
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "manual-only", reason: "endpoint-busy" });

    harness.transcribe.mockResolvedValue({ text: "kept audio" });
    harness.controller.press();
    await flushPromises();
    await flushPromises();

    expect(harness.transcribe.mock.calls[0]?.[0]).toEqual(new Float32Array(turn(7, 8)));
    expect(harness.draft.events).toContain("commit:kept audio");
  });

  it("covers AE6: late endpoint and transcription callbacks are rejected after owner change", async () => {
    const harness = await startedAutoHarness(turn(1, 2));
    const decision = deferred<SpeechTurnDecisionResponse>();
    harness.checkTurn.mockReturnValue(decision.promise);

    harness.pause([1]);
    expect(harness.state()).toEqual({ tag: "checking" });
    harness.draft.ownerKeyValue = "owner-b";
    harness.controller.ownerChanged();
    decision.resolve({ complete: true, probability: 1, samples: 1 });
    await flushPromises();
    await flushPromises();

    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(harness.draft.events).toEqual(["begin:owner-a", "abort"]);

    const transcribing = await startedAutoHarness(turn(3));
    const transcript = deferred<SpeechTranscriptionResponse>();
    transcribing.checkTurn.mockResolvedValue({ complete: true, probability: 1, samples: 1 });
    transcribing.transcribe.mockReturnValue(transcript.promise);
    transcribing.pause([3]);
    await flushPromises();
    transcribing.scheduler.advance(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await flushPromises();
    expect(transcribing.state()).toEqual({ tag: "transcribing" });
    transcribing.draft.ownerKeyValue = "owner-b";
    transcribing.controller.ownerChanged();
    transcript.resolve({ text: "late" });
    await flushPromises();
    expect(transcribing.draft.events).toEqual(["begin:owner-a", "abort"]);
  });

  it("aborts a pending endpoint check when voiced speech resumes and ignores stale completion", async () => {
    const harness = await startedAutoHarness(turn(1, 2, 3));
    const decision = deferred<SpeechTurnDecisionResponse>();
    harness.checkTurn.mockReturnValue(decision.promise);

    harness.pause([1]);
    expect(harness.state()).toEqual({ tag: "checking" });
    const signal = harness.checkTurn.mock.calls[0]?.[1]?.signal;
    harness.activity();

    expect(signal?.aborted).toBe(true);
    expect(harness.state()).toEqual({ tag: "auto" });
    decision.resolve({ complete: true, probability: 1, samples: 1 });
    await flushPromises();
    harness.scheduler.advance(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await flushPromises();
    expect(harness.transcribe).not.toHaveBeenCalled();
  });

  it("cancels provisional endpoint completion when queued voiced speech arrives during the grace window", async () => {
    const harness = await startedAutoHarness(turn(1, 2, 3));
    harness.checkTurn.mockResolvedValue({ complete: true, probability: 1, samples: 1 });

    harness.pause([1]);
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "checking" });

    harness.activity(1, 1);
    expect(harness.state()).toEqual({ tag: "auto" });
    harness.scheduler.advance(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await flushPromises();

    expect(harness.capture?.stopCalls).toBe(0);
    expect(harness.transcribe).not.toHaveBeenCalled();
  });

  it("lets a second press in checking abort the endpoint signal, finalize once, and ignore late completion", async () => {
    const harness = await startedAutoHarness(turn(1, 2));
    const decision = deferred<SpeechTurnDecisionResponse>();
    harness.checkTurn.mockReturnValue(decision.promise);
    harness.transcribe.mockResolvedValue({ text: "manual checking" });

    harness.pause([1], 1);
    expect(harness.state()).toEqual({ tag: "checking" });
    const signal = harness.checkTurn.mock.calls[0]?.[1]?.signal;

    expect(harness.controller.press()).toBe(true);
    expect(signal?.aborted).toBe(true);
    await flushPromises();
    expect(harness.transcribe).toHaveBeenCalledOnce();

    decision.resolve({ complete: true, probability: 1, samples: 1 });
    harness.scheduler.advance(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await flushPromises();

    expect(harness.capture?.stopCalls).toBe(1);
    expect(harness.transcribe).toHaveBeenCalledOnce();
    expect(harness.draft.events).toEqual(["begin:owner-a", "commit:manual checking", "finish"]);
  });

  it("enforces endpoint request and byte budgets by degrading to manual-only", async () => {
    const policy = smallEndpointPolicy();
    const harness = await startedAutoHarness(turn(1, 2), policy);
    harness.checkTurn.mockResolvedValue({ complete: false, probability: 0.1, samples: 1 });

    harness.pause([1]);
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "auto" });
    harness.pause([2]);

    expect(harness.state()).toEqual({ tag: "manual-only", reason: "endpoint-budget" });
    expect(harness.checkTurn).toHaveBeenCalledOnce();
  });

  it("covers AE7: limit terminal forces one transcription; other capture failures abort", async () => {
    const limitHarness = await startedAutoHarness(turn(1, 2));
    limitHarness.transcribe.mockResolvedValue({ text: "limit" });
    limitHarness.terminal({ kind: "failed", error: new SpeechCaptureError("limit_reached", "limit"), samples: new Float32Array(turn(1, 2)) });
    await flushPromises();
    expect(limitHarness.transcribe).toHaveBeenCalledOnce();
    expect(limitHarness.draft.events).toContain("commit:limit");

    const failedHarness = await startedAutoHarness(turn(1, 2));
    failedHarness.terminal({ kind: "failed", error: new SpeechCaptureError("worklet_failed", "worklet failed"), samples: new Float32Array() });
    await flushPromises();
    expect(failedHarness.transcribe).not.toHaveBeenCalled();
    expect(failedHarness.state()).toMatchObject({ tag: "error", reason: "capture-failed" });
    expect(failedHarness.draft.events).toEqual(["begin:owner-a", "abort"]);
  });

  it("refuses a turn the transcription route would reject as too short, without spending a request", async () => {
    // 99 ms of audio: one sample under the route's own minimum, which answers
    // HTTP 400 too_short. Twelve of forty-two real requests in one day were this.
    const harness = await startedAutoHarness(new Array<number>(SPEECH_POLICY.audio.minRequestSamples - 1).fill(0.2));

    harness.controller.press();
    await flushPromises();
    await flushPromises();

    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(harness.state()).toMatchObject({ tag: "error", reason: "too-short", retryable: true });
    // The draft lock is released rather than aborted: there was no transcript
    // to insert, and whatever the reader had typed is still theirs.
    expect(harness.draft.events).toEqual(["begin:owner-a", "finish"]);

    // The microphone works again straight away.
    harness.installCapture(turn(1, 2));
    harness.transcribe.mockResolvedValue({ text: "second try" });
    expect(harness.controller.press()).toBe(true);
    await flushPromises();
    harness.controller.release();
    harness.controller.press();
    await flushPromises();
    await flushPromises();
    expect(harness.draft.events).toContain("commit:second try");
  });

  it("initial-speech timeout aborts an empty turn and unlocks the draft", async () => {
    const harness = createHarness();
    const capture = fakeCapture([]);
    harness.createCaptureSession.mockResolvedValue(capture);
    harness.controller.press();
    await flushPromises();

    harness.scheduler.advance(SPEECH_POLICY.timing.initialSpeechTimeoutMs);
    await flushPromises();

    expect(capture.abortCalls).toBe(1);
    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(harness.state()).toMatchObject({ tag: "error", reason: "initial-speech-timeout" });
    expect(harness.draft.events).toEqual(["begin:owner-a", "abort"]);
  });

  it("retains one owner-bound final PCM after retryable transcription failures and supports retry, discard, and expiry", async () => {
    const harness = await startedAutoHarness(turn(5, 6));
    harness.transcribe.mockRejectedValueOnce(new SpeechApiError("network", "offline", { retryable: true })).mockResolvedValueOnce({ text: "retry text" });

    harness.controller.press();
    await flushPromises();
    await flushPromises();

    expect(harness.state()).toMatchObject({ tag: "retained-retry", reason: "network" });
    expect(harness.controller.press()).toBe(true);
    expect(harness.createCaptureSession).toHaveBeenCalledOnce();

    expect(harness.controller.retryRetained()).toBe(false);
    await flushPromises();
    expect(harness.transcribe).toHaveBeenCalledTimes(2);
    expect(harness.transcribe.mock.calls[1]?.[0]).toEqual(new Float32Array(turn(5, 6)));
    expect(harness.draft.events).toEqual(["begin:owner-a", "commit:retry text", "finish"]);

    const expiring = await startedAutoHarness(turn(8));
    expiring.transcribe.mockRejectedValue(new SpeechApiError("timeout", "slow", { retryable: true }));
    expiring.controller.press();
    await flushPromises();
    await flushPromises();
    expect(expiring.state()).toMatchObject({ tag: "retained-retry" });
    expiring.scheduler.advance(SPEECH_POLICY.timing.finalRetryTtlMs);
    expect(expiring.state()).toEqual({ tag: "idle" });
    expect(expiring.draft.events).toEqual(["begin:owner-a", "abort"]);

    const discarded = await startedAutoHarness(turn(9));
    discarded.transcribe.mockRejectedValue(new SpeechApiError("overloaded", "busy", { retryable: true }));
    discarded.controller.press();
    await flushPromises();
    await flushPromises();
    expect(discarded.controller.discardRetained()).toBe(true);
    expect(discarded.state()).toEqual({ tag: "idle" });
    expect(discarded.draft.events).toEqual(["begin:owner-a", "abort"]);
  });

  it("empty and nonretryable transcription results preserve the old draft and unlock", async () => {
    const empty = await startedAutoHarness(turn(1));
    empty.transcribe.mockResolvedValue({ text: "   " });
    empty.controller.press();
    await flushPromises();
    await flushPromises();
    expect(empty.draft.events).toEqual(["begin:owner-a", "finish"]);
    expect(empty.state()).toEqual({ tag: "empty" });

    const failed = await startedAutoHarness(turn(1));
    failed.transcribe.mockRejectedValue(new SpeechApiError("transcription_empty", "empty", { retryable: false }));
    failed.controller.press();
    await flushPromises();
    await flushPromises();
    expect(failed.draft.events).toEqual(["begin:owner-a", "finish"]);
    expect(failed.state()).toMatchObject({ tag: "error", reason: "transcription-failed", retryable: false });
  });

  it("disconnect, archived/disabled, page background, and dispose abort; resize/orientation preserves active capture", async () => {
    const harness = await startedAutoHarness(turn(1));
    harness.controller.resizeOrOrientationChanged();
    expect(harness.state()).toEqual({ tag: "auto" });
    harness.controller.pageBackgrounded();
    await flushPromises();
    expect(harness.capture?.abortCalls).toBe(1);
    expect(harness.state()).toEqual({ tag: "idle" });

    const disabled = await startedAutoHarness(turn(1));
    disabled.controller.surfaceDisabled();
    await flushPromises();
    expect(disabled.capture?.abortCalls).toBe(1);

    const disposed = await startedAutoHarness(turn(1));
    disposed.controller.dispose();
    await flushPromises();
    expect(disposed.capture?.abortCalls).toBe(1);
    expect(disposed.controller.press()).toBe(false);
  });

  it("starts initial-speech timeout only after capture acquisition resolves", async () => {
    const harness = createHarness();
    const captureReady = deferred<SpeechCaptureSession>();
    harness.createCaptureSession.mockReturnValue(captureReady.promise);

    harness.controller.press();
    harness.scheduler.advance(SPEECH_POLICY.timing.initialSpeechTimeoutMs + 1);
    expect(harness.state()).toEqual({ tag: "acquiring", gesture: "held" });
    expect(harness.draft.events).toEqual(["begin:owner-a"]);

    const capture = fakeCapture([]);
    captureReady.resolve(capture);
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "held" });

    harness.scheduler.advance(SPEECH_POLICY.timing.initialSpeechTimeoutMs);
    await flushPromises();
    expect(capture.abortCalls).toBe(1);
    expect(harness.state()).toMatchObject({ tag: "error", reason: "initial-speech-timeout" });
    expect(harness.draft.events).toEqual(["begin:owner-a", "abort"]);
  });

  it("drains delayed worklet batches before applying the initial-speech timeout", async () => {
    const harness = createHarness();
    const capture = harness.installCapture([]);
    const synchronized = deferred<undefined>();
    capture.synchronizeImpl = () => synchronized.promise;

    harness.controller.press();
    await flushPromises();
    harness.scheduler.advance(SPEECH_POLICY.timing.initialSpeechTimeoutMs);
    expect(capture.synchronizeCalls).toBe(1);
    expect(capture.abortCalls).toBe(0);

    harness.activity(0, 16_000);
    synchronized.resolve(undefined);
    await flushPromises();

    expect(capture.abortCalls).toBe(0);
    expect(harness.state()).toEqual({ tag: "held" });
  });

  it("lets limit terminal samples win once when manual finalization is pending", async () => {
    const harness = await startedAutoHarness(turn(9));
    const stopped = deferred<Float32Array>();
    if (harness.capture !== undefined) harness.capture.stopImpl = () => stopped.promise;
    harness.transcribe.mockResolvedValue({ text: "limit samples" });

    harness.controller.press();
    expect(harness.state()).toEqual({ tag: "transcribing" });

    harness.terminal({ kind: "failed", error: new SpeechCaptureError("limit_reached", "limit"), samples: new Float32Array(turn(1, 2)) });
    await flushPromises();
    expect(harness.transcribe).toHaveBeenCalledOnce();
    expect(harness.transcribe.mock.calls[0]?.[0]).toEqual(new Float32Array(turn(1, 2)));

    stopped.resolve(new Float32Array([]));
    await flushPromises();
    expect(harness.transcribe).toHaveBeenCalledOnce();
    expect(harness.draft.events).toEqual(["begin:owner-a", "commit:limit samples", "finish"]);
  });

  it("invalidates pending endpoint checks before limit transcription", async () => {
    const harness = await startedAutoHarness(turn(1, 2));
    const decision = deferred<SpeechTurnDecisionResponse>();
    harness.checkTurn.mockReturnValue(decision.promise);
    harness.transcribe.mockResolvedValue({ text: "limit won" });

    harness.pause([1], 1);
    const signal = harness.checkTurn.mock.calls[0]?.[1]?.signal;
    expect(harness.state()).toEqual({ tag: "checking" });

    harness.terminal({ kind: "failed", error: new SpeechCaptureError("limit_reached", "limit"), samples: new Float32Array(turn(1, 2)) });
    expect(signal?.aborted).toBe(true);
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "idle" });

    decision.resolve({ complete: false, probability: 0, samples: 1 });
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "idle" });
    expect(harness.draft.events).toEqual(["begin:owner-a", "commit:limit won", "finish"]);
  });

  it("keeps latest capability readiness when unavailable cleanup resolves late", async () => {
    const harness = await startedAutoHarness(turn(1));
    const abortDone = deferred<undefined>();
    if (harness.capture !== undefined) harness.capture.abortImpl = () => abortDone.promise;

    harness.controller.setCapability("unavailable", "warming down");
    expect(harness.state()).toEqual({ tag: "unavailable", reason: "warming down" });
    expect(harness.draft.events).toEqual(["begin:owner-a", "abort"]);

    harness.controller.setCapability("ready");
    expect(harness.state()).toEqual({ tag: "idle" });
    expect(harness.controller.press()).toBe(true);
    expect(harness.draft.events).toEqual(["begin:owner-a", "abort", "begin:owner-a"]);
    await flushPromises();

    abortDone.resolve(undefined);
    await flushPromises();
    expect(harness.state()).toEqual({ tag: "pressed" });
    expect(harness.createCaptureSession).toHaveBeenCalledTimes(2);
  });

  it("uses manual-only capability without aborting active capture or running endpoint checks", async () => {
    const harness = await startedAutoHarness(turn(4, 5));

    harness.controller.setCapability("manual-only", "smart-turn-unavailable");
    expect(harness.capture?.abortCalls).toBe(0);
    expect(harness.state()).toEqual({ tag: "manual-only", reason: "smart-turn-unavailable" });

    harness.pause([4, 5], 20_000);
    expect(harness.checkTurn).not.toHaveBeenCalled();

    harness.transcribe.mockResolvedValue({ text: "manual capability" });
    harness.controller.press();
    await flushPromises();
    await flushPromises();
    expect(harness.transcribe).toHaveBeenCalledOnce();
    expect(harness.draft.events).toEqual(["begin:owner-a", "commit:manual capability", "finish"]);
  });

  it("surfaces explicit smart-turn-unavailable and detector-failed manual-only reasons", async () => {
    const unavailable = await startedAutoHarness(turn(1));
    unavailable.checkTurn.mockRejectedValue(new SpeechApiError("speech_unavailable", "smart turn unavailable", { retryable: true }));
    unavailable.pause([1], 1);
    await flushPromises();
    expect(unavailable.state()).toEqual({ tag: "manual-only", reason: "smart-turn-unavailable" });

    const detector = await startedAutoHarness(turn(1));
    detector.checkTurn.mockRejectedValue(new SpeechApiError("speech_failed", "detector failed", { retryable: true }));
    detector.pause([1], 1);
    await flushPromises();
    expect(detector.state()).toEqual({ tag: "manual-only", reason: "detector-failed" });
  });

  it("treats rejected nonempty transcript insertion as a nonretryable transcription error", async () => {
    const harness = await startedAutoHarness(turn(1));
    harness.transcribe.mockResolvedValue({ text: "cannot insert" });
    harness.draft.commitResult = false;

    harness.controller.press();
    await flushPromises();
    await flushPromises();

    expect(harness.draft.events).toEqual(["begin:owner-a", "commit:cannot insert", "abort"]);
    expect(harness.state()).toMatchObject({ tag: "error", reason: "transcription-failed", retryable: false });
    expect(harness.controller.retryRetained()).toBe(false);
  });

  it("suppresses duplicate and too-soon endpoint checks until enough new voiced audio arrives", async () => {
    const policy: SpeechRuntimePolicy = {
      ...SPEECH_POLICY,
      audio: { ...SPEECH_POLICY.audio, sampleRateHz: 1_000 },
      endpoint: { ...SPEECH_POLICY.endpoint, minIntervalMs: 10, minNewVoicedAudioMs: 5, maxRequestsPerTurn: 10, maxBytesPerTurn: 1_000_000 },
    };
    const harness = await startedAutoHarness(turn(1), policy);
    harness.checkTurn.mockResolvedValue({ complete: false, probability: 0.1, samples: 1 });

    harness.pause([1], 100);
    await flushPromises();
    expect(harness.checkTurn).toHaveBeenCalledTimes(1);
    expect(harness.state()).toEqual({ tag: "auto" });

    harness.pause([1], 100);
    harness.activity(100, 4);
    harness.pause([1], 120);
    harness.activity(104, 1);
    harness.pause([1], 105);
    expect(harness.checkTurn).toHaveBeenCalledTimes(1);

    harness.pause([1], 111);
    expect(harness.checkTurn).toHaveBeenCalledTimes(2);
  });

  it("aborts capture, endpoint, transcription, and retained buffers on owner loss", async () => {
    const checking = await startedAutoHarness(turn(1, 2));
    const decision = deferred<SpeechTurnDecisionResponse>();
    checking.checkTurn.mockReturnValue(decision.promise);
    checking.pause([1], 1);
    const endpointSignal = checking.checkTurn.mock.calls[0]?.[1]?.signal;
    checking.draft.ownerKeyValue = "owner-b";
    checking.controller.ownerChanged();
    await flushPromises();
    expect(endpointSignal?.aborted).toBe(true);
    expect(checking.capture?.abortCalls).toBe(1);
    decision.resolve({ complete: true, probability: 1, samples: 1 });
    await flushPromises();
    expect(checking.transcribe).not.toHaveBeenCalled();
    expect(checking.state()).toEqual({ tag: "idle" });

    const transcribing = await startedAutoHarness(turn(3));
    const transcript = deferred<SpeechTranscriptionResponse>();
    transcribing.transcribe.mockReturnValue(transcript.promise);
    transcribing.controller.press();
    await flushPromises();
    const transcriptionSignal = transcribing.transcribe.mock.calls[0]?.[1]?.signal;
    transcribing.draft.ownerKeyValue = "owner-b";
    transcribing.controller.ownerChanged();
    expect(transcriptionSignal?.aborted).toBe(true);
    transcript.resolve({ text: "late" });
    await flushPromises();
    expect(transcribing.draft.events).toEqual(["begin:owner-a", "abort"]);

    const retained = await startedAutoHarness(turn(4));
    retained.transcribe.mockRejectedValue(new SpeechApiError("network", "offline", { retryable: true }));
    retained.controller.press();
    await flushPromises();
    await flushPromises();
    expect(retained.state()).toMatchObject({ tag: "retained-retry" });
    retained.draft.ownerKeyValue = "owner-b";
    retained.controller.ownerChanged();
    expect(retained.controller.retryRetained()).toBe(false);
    expect(retained.state()).toEqual({ tag: "idle" });
  });

  it("unlocks and allows retry after non-permission acquisition failures", async () => {
    const noDevice = createHarness();
    noDevice.createCaptureSession.mockRejectedValue(new SpeechCaptureError("device_unavailable", "no microphone"));
    noDevice.controller.press();
    await flushPromises();
    expect(noDevice.draft.events).toEqual(["begin:owner-a", "abort"]);
    expect(noDevice.state()).toMatchObject({ tag: "error", reason: "capture-failed", retryable: true });
    noDevice.createCaptureSession.mockResolvedValue(fakeCapture(turn(1)));
    expect(noDevice.controller.press()).toBe(true);

    const generic = createHarness();
    generic.createCaptureSession.mockRejectedValue(new Error("setup failed"));
    generic.controller.press();
    await flushPromises();
    expect(generic.draft.events).toEqual(["begin:owner-a", "abort"]);
    expect(generic.state()).toMatchObject({ tag: "error", reason: "capture-failed", retryable: true });
  });

  it("does not notify state changes after dispose waits for delayed cleanup", async () => {
    const harness = await startedAutoHarness(turn(1));
    const abortDone = deferred<undefined>();
    if (harness.capture !== undefined) harness.capture.abortImpl = () => abortDone.promise;
    const before = harness.states.length;

    harness.controller.dispose();
    abortDone.resolve(undefined);
    await flushPromises();

    expect(harness.capture?.abortCalls).toBe(1);
    expect(harness.states).toHaveLength(before);
    expect(harness.controller.press()).toBe(false);
  });

});

/**
 * A captured turn long enough for the transcription route to accept it.
 *
 * The route rejects anything under 100 ms of audio with HTTP 400 too_short, so
 * a fixture of one or two samples would agree with a production path that only
 * ever fails. The marks stay at the front, where assertions can still see them.
 */
function turn(...marks: number[]): number[] {
  const samples = new Array<number>(SPEECH_POLICY.audio.minRequestSamples).fill(0);
  marks.forEach((value, index) => { samples[index] = value; });
  return samples;
}

async function startedAutoHarness(finalSamples = turn(1), policy: SpeechRuntimePolicy = SPEECH_POLICY): Promise<ReturnType<typeof createHarness>> {
  const harness = createHarness(policy);
  harness.installCapture(finalSamples);
  harness.controller.press();
  await flushPromises();
  harness.controller.release();
  expect(harness.state()).toEqual({ tag: "auto" });
  return harness;
}

function createHarness(policy: SpeechRuntimePolicy = SPEECH_POLICY) {
  const scheduler = fakeScheduler();
  const draft = fakeDraft();
  const checkTurn = vi.fn<PromptDictationSpeechApi["checkTurn"]>();
  const transcribe = vi.fn<PromptDictationSpeechApi["transcribe"]>();
  checkTurn.mockResolvedValue({ complete: false, probability: 0.1, samples: 1 });
  transcribe.mockResolvedValue({ text: "transcript" });
  const createCaptureSession = vi.fn<(options: PromptDictationCaptureOptions) => Promise<SpeechCaptureSession>>();
  let captureOptions: PromptDictationCaptureOptions | undefined;
  let capture: ReturnType<typeof fakeCapture> | undefined;
  createCaptureSession.mockImplementation((options) => {
    captureOptions = options;
    capture = fakeCapture(turn(1));
    return Promise.resolve(capture);
  });
  const states: PromptDictationState[] = [];
  const controller = new PromptDictationController({
    policy,
    scheduler,
    draft,
    speechApi: { checkTurn, transcribe },
    createCaptureSession,
    onStateChange: (state) => { states.push(state); },
  });
  return {
    controller,
    scheduler,
    draft,
    checkTurn,
    transcribe,
    createCaptureSession,
    states,
    get capture() {
      return capture;
    },
    state: () => controller.state,
    pause: (samples: number[], endSample = samples.length) => { captureOptions?.onPauseCandidate({ samples: new Float32Array(samples), endSample }); },
    activity: (startSample = 0, sampleCount = 1) => { captureOptions?.onSpeechActivity({ startSample, endSample: startSample + sampleCount, sampleCount }); },
    terminal: (terminal: SpeechCaptureTerminal) => { captureOptions?.onTerminal(terminal); },
    installCapture: (finalSamples: number[]) => {
      const nextCapture = fakeCapture(finalSamples);
      capture = nextCapture;
      createCaptureSession.mockImplementation((options) => {
        captureOptions = options;
        return Promise.resolve(nextCapture);
      });
      return nextCapture;
    },
    setStateByEndpointFailure: () => {
      checkTurn.mockRejectedValueOnce(new SpeechApiError("speech_unavailable", "smart turn unavailable", { retryable: true }));
      captureOptions?.onPauseCandidate({ samples: new Float32Array([1]), endSample: 1 });
    },
  };
}

function fakeDraft(): PromptDictationDraftOwner & { ownerKeyValue: string; readonly events: string[]; commitResult: boolean } {
  const events: string[] = [];
  let locked = false;
  return {
    ownerKeyValue: "owner-a",
    events,
    commitResult: true,
    get ownerKey() {
      return this.ownerKeyValue;
    },
    beginDictation: () => {
      if (locked) {
        events.push("begin-rejected");
        return false;
      }
      locked = true;
      events.push("begin:owner-a");
      return true;
    },
    commitTranscript(transcript) {
      events.push(`commit:${transcript}`);
      return this.commitResult;
    },
    finishDictation: () => {
      locked = false;
      events.push("finish");
    },
    abortDictation: () => {
      locked = false;
      events.push("abort");
    },
  };
}

function fakeCapture(finalSamples: number[]): SpeechCaptureSession & { synchronizeCalls: number; stopCalls: number; abortCalls: number; synchronizeImpl: () => Promise<void>; stopImpl: () => Promise<Float32Array>; abortImpl: () => Promise<void> } {
  return {
    actualSampleRateHz: 16_000,
    failure: undefined,
    synchronizeCalls: 0,
    stopCalls: 0,
    abortCalls: 0,
    synchronizeImpl: () => Promise.resolve(),
    stopImpl: () => Promise.resolve(new Float32Array(finalSamples)),
    abortImpl: () => Promise.resolve(),
    endpointWindow: () => new Float32Array(finalSamples),
    finalize: () => new Float32Array(finalSamples),
    synchronize() {
      this.synchronizeCalls += 1;
      return this.synchronizeImpl();
    },
    stopAndFinalize() {
      this.stopCalls += 1;
      return this.stopImpl();
    },
    abort() {
      this.abortCalls += 1;
      return this.abortImpl();
    },
  };
}

function fakeScheduler(): PromptDictationScheduler & { advance(ms: number): void; delayCount(delay: number): number } {
  let nowMs = 0;
  const tasks: { dueAt: number; cancelled: boolean; callback: () => void; delay: number }[] = [];
  return {
    now: () => nowMs,
    setTimeout: (callback, delayMs) => {
      const task = { dueAt: nowMs + delayMs, cancelled: false, callback, delay: delayMs };
      tasks.push(task);
      return task;
    },
    clearTimeout: (handle) => {
      const task = tasks.find((candidate) => candidate === handle);
      if (task !== undefined) task.cancelled = true;
    },
    advance: (ms) => {
      nowMs += ms;
      let ran = true;
      while (ran) {
        ran = false;
        const due = tasks.filter((task) => !task.cancelled && task.dueAt <= nowMs).sort((a, b) => a.dueAt - b.dueAt)[0];
        if (due !== undefined) {
          due.cancelled = true;
          due.callback();
          ran = true;
        }
      }
    },
    delayCount: (delay) => tasks.filter((task) => task.delay === delay).length,
  };
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function smallEndpointPolicy(): SpeechRuntimePolicy {
  return {
    ...SPEECH_POLICY,
    endpoint: {
      ...SPEECH_POLICY.endpoint,
      maxRequestsPerTurn: 1,
      maxBytesPerTurn: 4,
    },
  };
}
