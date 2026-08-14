export const SPEECH_SAMPLE_RATE_HZ = 16_000;
export const SPEECH_PCM_BYTES_PER_SAMPLE = 4;
export const SPEECH_CHANNELS = 1;

export interface SpeechAudioPolicy {
  readonly sampleRateHz: number;
  readonly channels: number;
  readonly bytesPerSample: number;
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
  readonly whisperTcpReadyMs: number;
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

const endpointWindowSeconds = 8;
const maxTurnSeconds = 60;
const endpointWindowBytes = speechPcmBytesForSeconds(endpointWindowSeconds);
const maxTurnBytes = speechPcmBytesForSeconds(maxTurnSeconds);
const endpointMaxRequestsPerTurn = 16;
const pauseAfterSpeechMs = 650;
const operationDeadlineMs = 10_000;
const persistentWarmthMaxMemoryFraction = 0.75;

export const SPEECH_POLICY: SpeechRuntimePolicy = {
  audio: {
    sampleRateHz: SPEECH_SAMPLE_RATE_HZ,
    channels: SPEECH_CHANNELS,
    bytesPerSample: SPEECH_PCM_BYTES_PER_SAMPLE,
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
  measuredAt: "2026-08-14T03:58:52.455Z",
  measuredWith: "scripts/speech-runtime-benchmark.mjs",
  host: "zao x86_64-linux NixOS, pinned Forgerie Smart Turn v3.2 and whisper.cpp base.en runtimes",
  hostTotalMemoryBytes: 33_370_378_240,
  sampleDurationsSeconds: [3, 10, 30, 60],
  fixtureKind: "generated-non-sensitive-tts-speech",
  repeatedTurns: 20,
  contentionTurns: 20,
  maxTurnSeconds,
  maxTurnBytes,
  endpointWindowBytes,
  benchmarkNodePeakCopyRssBytes: 175_009_792,
  persistentWarmthMemoryFraction: persistentWarmthMaxMemoryFraction,
  persistentWarmthThresholdBytes: 25_027_783_680,
  peakActiveAgentWorkloadRssBytes: 11_768_492_032,
  activeAgentWorkloadLifetimeCgroupPeakBytes: 17_947_086_848,
  activeAgentWorkloadSource: "systemd user cgroup memory.current for forgerie-sessiond.service plus forgerie-web.service sampled during characterization; memory.peak is lifetime context only",
  speechPeakRssBytes: 939_560_960,
  persistentWarmthCombinedPeakBytes: 12_708_052_992,
  persistentWarmthAccepted: true,
  persistentWarmthProvisional: false,
  smartTurnColdReadyMs: 733.32,
  smartTurnWarmEndpointP95Ms: 61.76,
  smartTurnMaxFixtureMs: 76.89,
  smartTurnPeakRssBytes: 286_269_440,
  whisperTcpReadyMs: 215.46,
  whisperReadyAfterRepresentativeInferenceMs: 1_215.17,
  whisperWarmTranscriptionP95Ms: 983.34,
  whisperMaxTurnFixtureMs: 2_339.79,
  whisperPeakRssBytes: 633_253_888,
  whisperSixtySecondFixtureMs: 2_339.79,
  whisperSixtySecondPeakRssBytes: 629_043_200,
  activeQueuedContentionP95Ms: 2_213.8,
  activeQueuedContentionPeakRssBytes: 671_051_776,
  queuedCancellationObservation: "Queued direct Whisper HTTP client abort returned in 3.28 ms while the active request settled 1093.96 ms later; adapter-owned queued cancellation remains U2 proof.",
  activeCancellationObservation: "Active Whisper client abort returned after 1806.98 ms and a follow-up request completed 1728.76 ms later, so active cancellation must keep the backend slot until compute really settles.",
  forcedTerminationObservation: "Forced Whisper SIGKILL produced fetch failure, terminated in 1208.59 ms, then restarted without old/new process overlap.",
  forcedTerminationRestartMs: 1_138.73,
  replacementOverlapObserved: false,
  notes: [
    "Whisper latency evidence uses generated non-sensitive TTS speech fixtures at 3, 10, 30, and 60 seconds; the benchmark deletes transient WAV files and never prints recognized transcript text.",
    "The measured generated-speech 60-second Whisper fixture completed in 2339.79 ms and the 20 repeated three-second turns had 983.34 ms p95 latency, so a 10-second queue-inclusive operation deadline keeps headroom without preserving hidden compute indefinitely.",
    "Operation RSS samples include the benchmark Node process and child process trees during work; the highest Node-side PCM/WAV/body-copy RSS observed was 175009792 bytes.",
    "Smart Turn stayed below 76.89 ms across 3-, 10-, 30-, and 60-second submitted buffers because the worker evaluates only the latest eight seconds; endpoint p95 over 20 repeated checks was 61.76 ms.",
    "The active-plus-queued contention probe ran 20 iterations with one active Whisper request, one queued direct Whisper HTTP request, and one Smart Turn endpoint check; contention p95 was 2213.8 ms with 671051776 bytes sampled peak RSS.",
    "The active Forgerie workload measurement used sampled memory.current from the systemd user cgroups for forgerie-sessiond.service and forgerie-web.service; speech peak plus active workload peak was 12708052992 bytes, below the 25027783680-byte 75% host-memory budget. The higher memory.peak value is recorded only as lifetime cgroup context.",
    "One active and one queued operation per backend are the only admitted model slots; queue wait and inference share the same operationDeadlineMs contract.",
  ],
  evidenceGaps: [
    "Physical Fold microphone, thermal, and foreground posture evidence belongs to U10/U8 and is not replaced by generated-speech host benchmarking.",
    "Future adapter-owned queued cancellation and hard-deadline wedged-inference termination still need U2 process-adapter tests; this benchmark proves only direct runtime client abort, direct child termination, restart time, and no intentional replacement overlap.",
  ],
};
