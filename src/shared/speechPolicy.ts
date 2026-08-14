export const SPEECH_SAMPLE_RATE_HZ = 16_000;
export const SPEECH_PCM_BYTES_PER_SAMPLE = 4;
export const SPEECH_CHANNELS = 1;

export interface SpeechAudioPolicy {
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly bytesPerSample: number;
  readonly minRequestMs: number;
  readonly minRequestSamples: number;
  readonly minRequestBytes: number;
  readonly endpointWindowSeconds: number;
  readonly endpointWindowSamples: number;
  readonly endpointWindowBytes: number;
  readonly maxTurnSeconds: number;
  readonly maxTurnSamples: number;
  readonly maxTurnBytes: number;
}

export interface SpeechTimingPolicy {
  readonly warmupDeadlineMs: number;
  readonly endpointDeadlineMs: number;
  readonly bodyUploadDeadlineMs: number;
  /** Queue-inclusive deadline for one admitted endpoint or transcription operation. */
  readonly operationDeadlineMs: number;
  readonly initialSpeechTimeoutMs: number;
  readonly pauseAfterSpeechMs: number;
  readonly finalRetryTtlMs: number;
}

export interface SpeechEndpointPolicy {
  readonly minIntervalMs: number;
  readonly minNewVoicedAudioMs: number;
  readonly maxRequestsPerTurn: number;
  readonly maxBytesPerTurn: number;
}

export interface SpeechAdmissionPolicy {
  readonly activeOperationsPerBackend: number;
  readonly queuedOperationsPerBackend: number;
  readonly maxQueuedPcmBytes: number;
  readonly maxConcurrentParsingBytes: number;
  readonly globalWindowMs: number;
  readonly globalEndpointChecksPerWindow: number;
  readonly globalTranscriptionsPerWindow: number;
}

export interface SpeechRestartPolicy {
  readonly maxRestartsPerWindow: number;
  readonly restartWindowMs: number;
  readonly restartBackoffMs: number;
}

export interface SpeechProcessPolicy {
  readonly smartTurnThreads: number;
  readonly whisperThreads: number;
  readonly persistentWarmthMaxMemoryFraction: number;
}

export interface SpeechRuntimePolicy {
  readonly audio: SpeechAudioPolicy;
  readonly timing: SpeechTimingPolicy;
  readonly endpoint: SpeechEndpointPolicy;
  readonly admission: SpeechAdmissionPolicy;
  readonly restart: SpeechRestartPolicy;
  readonly process: SpeechProcessPolicy;
}

export interface SpeechPolicyEvidence {
  readonly measuredAt: string;
  readonly measuredWith: "scripts/speech-runtime-benchmark.mjs";
  readonly host: string;
  readonly hostTotalMemoryBytes: number;
  readonly sampleDurationsSeconds: readonly number[];
  readonly fixtureKind: "generated-non-sensitive-tts-speech";
  readonly repeatedTurns: number;
  readonly contentionTurns: number;
  readonly maxTurnSeconds: number;
  readonly maxTurnBytes: number;
  readonly endpointWindowBytes: number;
  readonly benchmarkNodePeakCopyRssBytes: number;
  readonly persistentWarmthMemoryFraction: number;
  readonly persistentWarmthThresholdBytes: number;
  readonly peakActiveAgentWorkloadRssBytes: number;
  readonly activeAgentWorkloadLifetimeCgroupPeakBytes: number;
  readonly activeAgentWorkloadSource: string;
  readonly speechPeakRssBytes: number;
  readonly persistentWarmthCombinedPeakBytes: number;
  readonly persistentWarmthAccepted: boolean;
  readonly persistentWarmthProvisional: boolean;
  readonly smartTurnColdReadyMs: number;
  readonly smartTurnWarmEndpointP95Ms: number;
  readonly smartTurnMaxFixtureMs: number;
  readonly smartTurnPeakRssBytes: number;
  readonly whisperWorkerReadyMs: number;
  readonly whisperReadyAfterRepresentativeInferenceMs: number;
  readonly whisperWarmTranscriptionP95Ms: number;
  readonly whisperMaxTurnFixtureMs: number;
  readonly whisperPeakRssBytes: number;
  readonly whisperSixtySecondFixtureMs: number;
  readonly whisperSixtySecondPeakRssBytes: number;
  readonly activeQueuedContentionP95Ms: number;
  readonly activeQueuedContentionPeakRssBytes: number;
  readonly queuedCancellationObservation: string;
  readonly activeCancellationObservation: string;
  readonly forcedTerminationObservation: string;
  readonly forcedTerminationRestartMs: number;
  readonly replacementOverlapObserved: boolean;
  readonly notes: readonly string[];
  readonly evidenceGaps: readonly string[];
}

export function speechPcmSamplesForSeconds(seconds: number): number {
  return Math.round(seconds * SPEECH_SAMPLE_RATE_HZ);
}

export function speechPcmBytesForSeconds(seconds: number): number {
  return speechPcmSamplesForSeconds(seconds) * SPEECH_PCM_BYTES_PER_SAMPLE * SPEECH_CHANNELS;
}

const minRequestMs = 100;
const minRequestSeconds = minRequestMs / 1_000;
const endpointWindowSeconds = 8;
const maxTurnSeconds = 60;
const minRequestBytes = speechPcmBytesForSeconds(minRequestSeconds);
const endpointWindowBytes = speechPcmBytesForSeconds(endpointWindowSeconds);
const maxTurnBytes = speechPcmBytesForSeconds(maxTurnSeconds);
const endpointMaxRequestsPerTurn = 16;
const pauseAfterSpeechMs = 650;
const bodyUploadDeadlineMs = 10_000;
const operationDeadlineMs = 10_000;
const persistentWarmthMaxMemoryFraction = 0.75;

export const SPEECH_POLICY: SpeechRuntimePolicy = {
  audio: {
    sampleRateHz: SPEECH_SAMPLE_RATE_HZ,
    channels: SPEECH_CHANNELS,
    bytesPerSample: SPEECH_PCM_BYTES_PER_SAMPLE,
    minRequestMs,
    minRequestSamples: speechPcmSamplesForSeconds(minRequestSeconds),
    minRequestBytes,
    endpointWindowSeconds,
    endpointWindowSamples: speechPcmSamplesForSeconds(endpointWindowSeconds),
    endpointWindowBytes,
    maxTurnSeconds,
    maxTurnSamples: speechPcmSamplesForSeconds(maxTurnSeconds),
    maxTurnBytes,
  },
  timing: {
    warmupDeadlineMs: 60_000,
    endpointDeadlineMs: 2_500,
    bodyUploadDeadlineMs,
    operationDeadlineMs,
    initialSpeechTimeoutMs: 10_000,
    pauseAfterSpeechMs,
    finalRetryTtlMs: 30_000,
  },
  endpoint: {
    minIntervalMs: 900,
    minNewVoicedAudioMs: pauseAfterSpeechMs,
    maxRequestsPerTurn: endpointMaxRequestsPerTurn,
    maxBytesPerTurn: endpointMaxRequestsPerTurn * endpointWindowBytes,
  },
  admission: {
    activeOperationsPerBackend: 1,
    queuedOperationsPerBackend: 1,
    maxQueuedPcmBytes: maxTurnBytes,
    maxConcurrentParsingBytes: maxTurnBytes,
    globalWindowMs: 60_000,
    globalEndpointChecksPerWindow: 96,
    globalTranscriptionsPerWindow: 12,
  },
  restart: {
    maxRestartsPerWindow: 2,
    restartWindowMs: 120_000,
    restartBackoffMs: 1_500,
  },
  process: {
    smartTurnThreads: 1,
    whisperThreads: 4,
    persistentWarmthMaxMemoryFraction,
  },
};

export const SPEECH_POLICY_EVIDENCE: SpeechPolicyEvidence = {
  measuredAt: "2026-08-14T05:21:55.108Z",
  measuredWith: "scripts/speech-runtime-benchmark.mjs",
  host: "zao x86_64-linux NixOS 6.18.17, pinned Forgerie Smart Turn v3.2 and isolated whisper.cpp base.en framed worker",
  hostTotalMemoryBytes: 33_370_378_240,
  sampleDurationsSeconds: [3, 10, 30, 60],
  fixtureKind: "generated-non-sensitive-tts-speech",
  repeatedTurns: 20,
  contentionTurns: 20,
  maxTurnSeconds,
  maxTurnBytes,
  endpointWindowBytes,
  benchmarkNodePeakCopyRssBytes: 150_986_752,
  persistentWarmthMemoryFraction: persistentWarmthMaxMemoryFraction,
  persistentWarmthThresholdBytes: 25_027_783_680,
  peakActiveAgentWorkloadRssBytes: 16_129_605_632,
  activeAgentWorkloadLifetimeCgroupPeakBytes: 17_988_227_072,
  activeAgentWorkloadSource: "systemd user cgroup memory.current for forgerie-sessiond.service plus forgerie-web.service sampled during characterization; memory.peak is lifetime context only",
  speechPeakRssBytes: 1_127_337_984,
  persistentWarmthCombinedPeakBytes: 17_256_943_616,
  persistentWarmthAccepted: true,
  persistentWarmthProvisional: false,
  smartTurnColdReadyMs: 885.8,
  smartTurnWarmEndpointP95Ms: 121.03,
  smartTurnMaxFixtureMs: 151.64,
  smartTurnPeakRssBytes: 296_599_552,
  whisperWorkerReadyMs: 404.55,
  whisperReadyAfterRepresentativeInferenceMs: 1_613.42,
  whisperWarmTranscriptionP95Ms: 1_217.68,
  whisperMaxTurnFixtureMs: 3_157.4,
  whisperPeakRssBytes: 701_222_912,
  whisperSixtySecondFixtureMs: 3_157.4,
  whisperSixtySecondPeakRssBytes: 671_531_008,
  activeQueuedContentionP95Ms: 7_377.56,
  activeQueuedContentionPeakRssBytes: 816_013_312,
  queuedCancellationObservation: "Queued caller cancellation before a Whisper frame write returned in 0.02 ms while the active request settled 4185.63 ms later; U2 service queue tests cover adapter-owned queued cancellation.",
  activeCancellationObservation: "The framed Whisper protocol has no per-request cancellation frame; active cancellation is representable only by terminating the whole worker or by caller-side observation stop while the backend slot remains busy.",
  forcedTerminationObservation: "Forced framed Whisper SIGKILL produced runtime stdout closure, terminated in 2753.49 ms, then restarted without intentional old/new worker overlap.",
  forcedTerminationRestartMs: 2_576.11,
  replacementOverlapObserved: false,
  notes: [
    "Whisper latency evidence uses generated non-sensitive TTS speech fixtures at 3, 10, 30, and 60 seconds; the benchmark deletes transient WAV files and never prints recognized transcript text.",
    "The measured generated-speech 60-second Whisper fixture completed in 3157.4 ms and the 20 repeated three-second turns had 1217.68 ms p95 latency, so a 10-second queue-inclusive operation deadline keeps headroom without preserving hidden compute indefinitely.",
    "Operation RSS samples include the benchmark Node process and child process trees during work; the highest Node-side PCM/WAV/frame-copy RSS observed was 150986752 bytes.",
    "Smart Turn stayed below 151.64 ms across 3-, 10-, 30-, and 60-second submitted buffers because the worker evaluates only the latest eight seconds; endpoint p95 over 20 repeated checks was 121.03 ms.",
    "The active-plus-queued contention probe ran 20 iterations with one active Whisper frame, one queued Whisper frame, and one Smart Turn endpoint check; contention p95 was 7377.56 ms with 816013312 bytes sampled peak RSS.",
    "The active Forgerie workload measurement used sampled memory.current from the systemd user cgroups for forgerie-sessiond.service and forgerie-web.service; speech peak plus active workload peak was 17256943616 bytes, below the 25027783680-byte 75% host-memory budget. The higher memory.peak value is recorded only as lifetime cgroup context.",
    "One active and one queued operation per backend are the only admitted model slots; queue wait and inference share the same operationDeadlineMs contract.",
  ],
  evidenceGaps: [
    "Physical Fold microphone, thermal, and foreground posture evidence belongs to U10/U8 and is not replaced by generated-speech host benchmarking.",
    "The framed worker has no per-request cancellation message. U2 process-adapter tests still own queued cancellation before frame write and hard-deadline wedged-inference termination; this benchmark proves real framed-worker termination, restart time, and no intentional replacement overlap.",
  ],
};
