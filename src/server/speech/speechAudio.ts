import { SPEECH_PCM_BYTES_PER_SAMPLE, SPEECH_POLICY, SPEECH_SAMPLE_RATE_HZ, type SpeechRuntimePolicy } from "../../shared/speechPolicy.js";

export type SpeechAudioValidationErrorKind = "empty" | "misaligned" | "too_short" | "too_large" | "non_finite" | "out_of_range";

export class SpeechAudioValidationError extends Error {
  public constructor(
    public readonly kind: SpeechAudioValidationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SpeechAudioValidationError";
  }
}

export interface ValidatedSpeechPcm {
  readonly bytes: Uint8Array;
  readonly samples: Float32Array;
  readonly sampleRateHz: number;
  readonly durationSeconds: number;
}

export interface SpeechPcmValidationOptions {
  readonly policy?: SpeechRuntimePolicy;
}

export function validateSpeechPcm(bytes: Uint8Array, options: SpeechPcmValidationOptions = {}): ValidatedSpeechPcm {
  const policy = options.policy ?? SPEECH_POLICY;
  if (bytes.byteLength === 0) {
    throw new SpeechAudioValidationError("too_short", "Speech PCM is empty.");
  }
  if (bytes.byteLength % SPEECH_PCM_BYTES_PER_SAMPLE !== 0) {
    throw new SpeechAudioValidationError("misaligned", "Speech PCM byte length must align to float32 samples.");
  }
  if (bytes.byteLength < policy.audio.minRequestBytes) {
    throw new SpeechAudioValidationError("too_short", `Speech PCM is shorter than the ${String(policy.audio.minRequestMs)} ms minimum request.`);
  }

  const maxBytes = policy.audio.maxTurnBytes;
  if (bytes.byteLength > maxBytes) {
    throw new SpeechAudioValidationError("too_large", `transcription PCM exceeds the ${String(maxBytes)} byte limit.`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / SPEECH_PCM_BYTES_PER_SAMPLE);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = view.getFloat32(index * SPEECH_PCM_BYTES_PER_SAMPLE, true);
    if (!Number.isFinite(sample)) {
      throw new SpeechAudioValidationError("non_finite", "Speech PCM contains a non-finite sample.");
    }
    if (sample < -1 || sample > 1) {
      throw new SpeechAudioValidationError("out_of_range", "Speech PCM contains a sample outside the -1 to 1 range.");
    }
    samples[index] = sample;
  }

  if (samples.length === 0) {
    throw new SpeechAudioValidationError("too_short", "Speech PCM contains no samples.");
  }

  return {
    bytes,
    samples,
    sampleRateHz: SPEECH_SAMPLE_RATE_HZ,
    durationSeconds: samples.length / SPEECH_SAMPLE_RATE_HZ,
  };
}

export function float32PcmToWav(samples: Float32Array): Buffer {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SPEECH_SAMPLE_RATE_HZ, 24);
  wav.writeUInt32LE(SPEECH_SAMPLE_RATE_HZ * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    wav.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2);
  }
  return wav;
}
