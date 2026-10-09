import { describe, expect, it } from "vitest";
import { SPEECH_POLICY, speechPcmBytesForSeconds } from "../../shared/speechPolicy.js";
import { SpeechAudioValidationError, float32PcmToWav, validateSpeechPcm } from "./speechAudio.js";

function pcmBytes(samples: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 4);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => { view.setFloat32(index * 4, sample, true); });
  return bytes;
}

function pcmBytesWithPrefix(prefix: readonly number[], samples = SPEECH_POLICY.audio.minRequestSamples): Uint8Array {
  const padded = new Array<number>(samples).fill(0);
  prefix.forEach((sample, index) => { padded[index] = sample; });
  return pcmBytes(padded);
}

describe("speech audio contract", () => {
  it("accepts finite little-endian 16 kHz mono float32 PCM within the transcription limit", () => {
    const result = validateSpeechPcm(pcmBytesWithPrefix([-1, -0.25, 0, 0.5, 1]));

    expect([...result.samples.slice(0, 5)]).toEqual([-1, -0.25, 0, 0.5, 1]);
    expect(result.sampleRateHz).toBe(16_000);
    expect(result.durationSeconds).toBeCloseTo(SPEECH_POLICY.audio.minRequestMs / 1_000);
  });

  it.each([
    ["empty", new Uint8Array(), "too_short"],
    ["misaligned", new Uint8Array([0, 1, 2]), "misaligned"],
    ["NaN", pcmBytesWithPrefix([Number.NaN]), "non_finite"],
    ["Infinity", pcmBytesWithPrefix([Infinity]), "non_finite"],
    ["out-of-range", pcmBytesWithPrefix([1.01]), "out_of_range"],
  ])("rejects %s PCM", (_label, bytes, kind) => {
    expect(() => validateSpeechPcm(bytes)).toThrow(SpeechAudioValidationError);
    try {
      validateSpeechPcm(bytes);
    } catch (error) {
      expect(error).toMatchObject({ kind });
    }
  });

  it("enforces the exact 100 ms minimum PCM request boundary", () => {
    const belowBoundary = new Uint8Array(SPEECH_POLICY.audio.minRequestBytes - SPEECH_POLICY.audio.bytesPerSample);
    const atBoundary = new Uint8Array(SPEECH_POLICY.audio.minRequestBytes);

    expect(() => validateSpeechPcm(belowBoundary)).toThrow(SpeechAudioValidationError);
    try {
      validateSpeechPcm(belowBoundary);
    } catch (error) {
      expect(error).toMatchObject({ kind: "too_short" });
    }
    expect(validateSpeechPcm(atBoundary).samples.length).toBe(SPEECH_POLICY.audio.minRequestSamples);
  });

  it("accepts a full-turn recording beyond the retired endpoint window and rejects turns beyond ten minutes", () => {
    const validFullTurn = new Uint8Array(SPEECH_POLICY.audio.endpointWindowBytes + 4);
    expect(validateSpeechPcm(validFullTurn).samples.length).toBe(SPEECH_POLICY.audio.endpointWindowSamples + 1);

    const turnTooLarge = new Uint8Array(speechPcmBytesForSeconds(SPEECH_POLICY.audio.maxTurnSeconds) + 4);
    expect(() => validateSpeechPcm(turnTooLarge)).toThrow(/transcription/iu);
  });

  it("uses the configured transcription limit at its exact boundary", () => {
    const maxTurnSamples = SPEECH_POLICY.audio.minRequestSamples + 1;
    const maxTurnBytes = maxTurnSamples * SPEECH_POLICY.audio.bytesPerSample;
    const policy = { ...SPEECH_POLICY, audio: { ...SPEECH_POLICY.audio, maxTurnSamples, maxTurnBytes, maxTurnSeconds: maxTurnSamples / SPEECH_POLICY.audio.sampleRateHz } };

    expect(validateSpeechPcm(new Uint8Array(maxTurnBytes), { policy }).samples.length).toBe(maxTurnSamples);
    expect(() => validateSpeechPcm(new Uint8Array(maxTurnBytes + 4), { policy })).toThrow(SpeechAudioValidationError);
  });

  it("converts validated PCM to a readable 16 kHz mono signed-16 WAV in memory", () => {
    const pcm = validateSpeechPcm(pcmBytesWithPrefix([-1, -0.5, 0, 0.5, 1]));
    const wav = float32PcmToWav(pcm.samples);

    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(pcm.samples.length * 2);
    expect(wav.readInt16LE(44)).toBe(-32767);
    expect(wav.readInt16LE(48)).toBe(0);
    expect(wav.readInt16LE(52)).toBe(32767);
  });
});
