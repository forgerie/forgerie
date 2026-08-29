export const SPEECH_SAMPLE_RATE_HZ = 16_000;
export const SPEECH_PCM_BYTES_PER_SAMPLE = 4;
export const SPEECH_CHANNELS = 1;
export const SPEECH_MAX_TRANSCRIPT_CHARS = 12_000;

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
  readonly endpointCompletionGraceMs: number;
  readonly finalRetryTtlMs: number;
  readonly holdThresholdMs: number;
}

export interface SpeechEndpointPolicy {
  readonly minIntervalMs: number;
  readonly minNewVoicedAudioMs: number;
  readonly maxRequestsPerTurn: number;
  readonly maxBytesPerTurn: number;
}

export interface SpeechAdmissionPolicy {
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

export function speechPcmSamplesForSeconds(seconds: number): number {
  return Math.round(seconds * SPEECH_SAMPLE_RATE_HZ);
}

export function speechPcmBytesForSeconds(seconds: number): number {
  return speechPcmSamplesForSeconds(seconds) * SPEECH_PCM_BYTES_PER_SAMPLE * SPEECH_CHANNELS;
}

const minRequestMs = 100;
const minRequestSeconds = minRequestMs / 1_000;
const endpointWindowSeconds = 8;
const maxTurnSeconds = 10 * 60;
const minRequestBytes = speechPcmBytesForSeconds(minRequestSeconds);
const endpointWindowBytes = speechPcmBytesForSeconds(endpointWindowSeconds);
const maxTurnBytes = speechPcmBytesForSeconds(maxTurnSeconds);
const endpointMaxRequestsPerTurn = 16;
const pauseAfterSpeechMs = 650;
const endpointCompletionGraceMs = 60;
const bodyUploadDeadlineMs = 60_000;
const operationDeadlineMs = 120_000;
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
    endpointCompletionGraceMs,
    finalRetryTtlMs: 30_000,
    holdThresholdMs: 450,
  },
  endpoint: {
    minIntervalMs: 900,
    minNewVoicedAudioMs: pauseAfterSpeechMs,
    maxRequestsPerTurn: endpointMaxRequestsPerTurn,
    maxBytesPerTurn: endpointMaxRequestsPerTurn * endpointWindowBytes,
  },
  admission: {
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
