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
  readonly bodyUploadDeadlineMs: number;
  /** Queue-inclusive deadline for one admitted transcription operation. */
  readonly operationDeadlineMs: number;
  readonly captureStartupTimeoutMs: number;
  readonly pauseAfterSpeechMs: number;
  readonly holdThresholdMs: number;
}

/** Browser pause-candidate timing, not a backend endpoint-check budget. */
export interface SpeechEndpointPolicy {
  readonly minIntervalMs: number;
  readonly minNewVoicedAudioMs: number;
}

export interface SpeechAdmissionPolicy {
  readonly queuedOperationsPerBackend: number;
  readonly maxQueuedPcmBytes: number;
  readonly maxConcurrentParsingBytes: number;
  readonly globalWindowMs: number;
  readonly globalTranscriptionsPerWindow: number;
}

export interface SpeechRestartPolicy {
  readonly maxRestartsPerWindow: number;
  readonly restartWindowMs: number;
  readonly restartBackoffMs: number;
}

export interface SpeechProcessPolicy {
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
const pauseAfterSpeechMs = 650;
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
    bodyUploadDeadlineMs,
    operationDeadlineMs,
    captureStartupTimeoutMs: 1_000,
    pauseAfterSpeechMs,
    holdThresholdMs: 450,
  },
  endpoint: {
    minIntervalMs: 900,
    minNewVoicedAudioMs: pauseAfterSpeechMs,
  },
  admission: {
    queuedOperationsPerBackend: 1,
    maxQueuedPcmBytes: maxTurnBytes,
    maxConcurrentParsingBytes: maxTurnBytes,
    globalWindowMs: 60_000,
    globalTranscriptionsPerWindow: 12,
  },
  restart: {
    maxRestartsPerWindow: 2,
    restartWindowMs: 120_000,
    restartBackoffMs: 1_500,
  },
  process: {
    whisperThreads: 4,
    persistentWarmthMaxMemoryFraction,
  },
};
