import { describe, expect, it } from "vitest";
import { SPEECH_POLICY, speechPcmBytesForSeconds, speechPcmSamplesForSeconds } from "./speechPolicy";
import { SPEECH_POLICY_EVIDENCE } from "./speechPolicyEvidence";

describe("speech runtime policy", () => {
  it("uses one internally consistent 16 kHz float32 PCM contract", () => {
    expect(SPEECH_POLICY.audio.sampleRateHz).toBe(16_000);
    expect(SPEECH_POLICY.audio.channels).toBe(1);
    expect(SPEECH_POLICY.audio.bytesPerSample).toBe(4);
    expect(SPEECH_POLICY.audio.minRequestMs).toBe(100);
    expect(SPEECH_POLICY.audio.minRequestSamples).toBe(speechPcmSamplesForSeconds(SPEECH_POLICY.audio.minRequestMs / 1_000));
    expect(SPEECH_POLICY.audio.minRequestBytes).toBe(speechPcmBytesForSeconds(SPEECH_POLICY.audio.minRequestMs / 1_000));
    expect(speechPcmSamplesForSeconds(3)).toBe(48_000);
    expect(speechPcmBytesForSeconds(3)).toBe(192_000);
    expect(SPEECH_POLICY.audio.maxTurnSamples).toBe(speechPcmSamplesForSeconds(SPEECH_POLICY.audio.maxTurnSeconds));
    expect(SPEECH_POLICY.audio.maxTurnBytes).toBe(speechPcmBytesForSeconds(SPEECH_POLICY.audio.maxTurnSeconds));
    expect(SPEECH_POLICY.audio.endpointWindowBytes).toBe(speechPcmBytesForSeconds(SPEECH_POLICY.audio.endpointWindowSeconds));
    expect(SPEECH_POLICY.audio.endpointWindowBytes).toBeLessThanOrEqual(SPEECH_POLICY.audio.maxTurnBytes);
  });

  it("keeps every request and queued body below the existing app body ceiling", () => {
    const appBodyLimitBytes = 64 * 1024 * 1024;
    expect(SPEECH_POLICY.audio.maxTurnSeconds).toBe(60);
    expect(SPEECH_POLICY.audio.maxTurnBytes).toBe(3_840_000);
    expect(SPEECH_POLICY.audio.maxTurnBytes).toBeLessThan(appBodyLimitBytes);
    expect(SPEECH_POLICY.audio.endpointWindowBytes).toBeLessThan(appBodyLimitBytes);
    expect(SPEECH_POLICY.admission.maxQueuedPcmBytes).toBe(SPEECH_POLICY.audio.maxTurnBytes);
    expect(SPEECH_POLICY.admission.maxQueuedPcmBytes).toBeLessThan(appBodyLimitBytes);
  });

  it("bounds endpoint amplification and degrades before the browser can loop forever", () => {
    expect(SPEECH_POLICY.endpoint.maxRequestsPerTurn).toBe(16);
    expect(SPEECH_POLICY.endpoint.maxBytesPerTurn).toBe(
      SPEECH_POLICY.endpoint.maxRequestsPerTurn * SPEECH_POLICY.audio.endpointWindowBytes,
    );
    expect(SPEECH_POLICY.endpoint.minNewVoicedAudioMs).toBeGreaterThanOrEqual(SPEECH_POLICY.timing.pauseAfterSpeechMs);
    expect(SPEECH_POLICY.endpoint.minIntervalMs).toBeGreaterThanOrEqual(SPEECH_POLICY.timing.pauseAfterSpeechMs);
  });

  it("admits one queued operation per backend under one queue-inclusive operation deadline", () => {
    expect(SPEECH_POLICY.admission.queuedOperationsPerBackend).toBe(1);
    expect(SPEECH_POLICY.timing.bodyUploadDeadlineMs).toBe(10_000);
    expect(SPEECH_POLICY.timing.bodyUploadDeadlineMs).toBe(SPEECH_POLICY.timing.operationDeadlineMs);
    expect(SPEECH_POLICY.timing.operationDeadlineMs).toBe(10_000);
    expect(SPEECH_POLICY.timing.endpointDeadlineMs).toBeLessThan(SPEECH_POLICY.timing.operationDeadlineMs);
    expect(SPEECH_POLICY.timing.initialSpeechTimeoutMs).toBeLessThan(SPEECH_POLICY.audio.maxTurnSeconds * 1_000);
    expect(SPEECH_POLICY.timing.endpointCompletionGraceMs).toBe(60);
    expect(SPEECH_POLICY.timing.holdThresholdMs).toBe(450);
    expect(SPEECH_POLICY.timing.holdThresholdMs).toBeLessThan(SPEECH_POLICY.timing.pauseAfterSpeechMs);
    expect("queueDeadlineMs" in SPEECH_POLICY.timing).toBe(false);
    expect("transcriptionDeadlineMs" in SPEECH_POLICY.timing).toBe(false);
    expect("queueDeadlineMs" in SPEECH_POLICY.admission).toBe(false);
  });

  it("records generated-speech measurements and avoids transcript text", () => {
    expect(SPEECH_POLICY_EVIDENCE.measuredWith).toBe("scripts/speech-runtime-benchmark.mjs");
    expect(SPEECH_POLICY_EVIDENCE.fixtureKind).toBe("generated-non-sensitive-tts-speech");
    expect(SPEECH_POLICY_EVIDENCE.sampleDurationsSeconds).toEqual([3, 10, 30, 60]);
    expect(SPEECH_POLICY_EVIDENCE.repeatedTurns).toBe(20);
    expect(SPEECH_POLICY_EVIDENCE.contentionTurns).toBe(20);
    expect(SPEECH_POLICY_EVIDENCE.whisperSixtySecondFixtureMs).toBe(SPEECH_POLICY_EVIDENCE.whisperMaxTurnFixtureMs);
    expect(SPEECH_POLICY_EVIDENCE.whisperWarmTranscriptionP95Ms).toBeLessThan(2_000);
    expect(SPEECH_POLICY_EVIDENCE.whisperMaxTurnFixtureMs).toBeLessThan(5_000);
    expect(SPEECH_POLICY_EVIDENCE.activeQueuedContentionP95Ms).toBeLessThan(SPEECH_POLICY.timing.operationDeadlineMs);
    expect(SPEECH_POLICY_EVIDENCE.benchmarkNodePeakCopyRssBytes).toBeGreaterThan(0);
    const serializedEvidence = JSON.stringify(SPEECH_POLICY_EVIDENCE).toLowerCase();
    expect(serializedEvidence).not.toContain("transcripttext");
    expect(serializedEvidence).not.toContain("recognized text:");
    expect(serializedEvidence).not.toContain("synthetic tone");
    expect(serializedEvidence).not.toContain("textchars");
  });

  it("gates persistent warmth on speech peak plus measured active Forgerie workload", () => {
    const budget = SPEECH_POLICY_EVIDENCE.hostTotalMemoryBytes * SPEECH_POLICY.process.persistentWarmthMaxMemoryFraction;
    expect(SPEECH_POLICY_EVIDENCE.persistentWarmthMemoryFraction).toBe(SPEECH_POLICY.process.persistentWarmthMaxMemoryFraction);
    expect(SPEECH_POLICY_EVIDENCE.peakActiveAgentWorkloadRssBytes).toBeGreaterThan(0);
    expect(SPEECH_POLICY_EVIDENCE.activeAgentWorkloadLifetimeCgroupPeakBytes).toBeGreaterThanOrEqual(SPEECH_POLICY_EVIDENCE.peakActiveAgentWorkloadRssBytes);
    expect(SPEECH_POLICY_EVIDENCE.speechPeakRssBytes).toBeGreaterThan(0);
    expect(SPEECH_POLICY_EVIDENCE.persistentWarmthCombinedPeakBytes).toBe(
      SPEECH_POLICY_EVIDENCE.speechPeakRssBytes + SPEECH_POLICY_EVIDENCE.peakActiveAgentWorkloadRssBytes,
    );
    expect(SPEECH_POLICY_EVIDENCE.persistentWarmthThresholdBytes).toBe(Math.floor(budget));
    expect(SPEECH_POLICY_EVIDENCE.persistentWarmthCombinedPeakBytes).toBeLessThanOrEqual(SPEECH_POLICY_EVIDENCE.persistentWarmthThresholdBytes);
    expect(SPEECH_POLICY_EVIDENCE.persistentWarmthAccepted).toBe(true);
    expect(SPEECH_POLICY_EVIDENCE.persistentWarmthProvisional).toBe(false);
    expect(SPEECH_POLICY_EVIDENCE.activeAgentWorkloadSource).toContain("memory.current");
    expect(SPEECH_POLICY_EVIDENCE.activeAgentWorkloadSource).toContain("lifetime context");
  });

  it("records cancellation and restart probes with remaining adapter-only proof explicit", () => {
    expect(SPEECH_POLICY_EVIDENCE.queuedCancellationObservation).toContain("before a Whisper frame write");
    expect(SPEECH_POLICY_EVIDENCE.activeCancellationObservation).toContain("no per-request cancellation frame");
    expect(SPEECH_POLICY_EVIDENCE.forcedTerminationObservation).toContain("SIGKILL");
    expect(SPEECH_POLICY_EVIDENCE.forcedTerminationRestartMs).toBeLessThan(SPEECH_POLICY.timing.operationDeadlineMs);
    expect(SPEECH_POLICY_EVIDENCE.replacementOverlapObserved).toBe(false);
    expect(SPEECH_POLICY_EVIDENCE.evidenceGaps.some((gap) => gap.includes("U2 process-adapter tests"))).toBe(true);
    expect(SPEECH_POLICY_EVIDENCE.evidenceGaps.some((gap) => gap.includes("no per-request cancellation message"))).toBe(true);
  });
});
