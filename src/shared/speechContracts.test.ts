import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { SPEECH_MAX_TRANSCRIPT_CHARS, SPEECH_SAMPLE_RATE_HZ } from "./speechPolicy.js";
import {
  SpeechErrorResponseSchema,
  SpeechServiceStatusResponseSchema,
  SpeechTranscriptionResponseSchema,
  parseSpeechErrorResponse,
  parseSpeechServiceStatusResponse,
  parseSpeechTranscriptionResponse,
} from "./speechContracts.js";

describe("speech HTTP contracts", () => {
  it("validates status, transcription, and discriminated error payloads", () => {
    expect(Check(SpeechServiceStatusResponseSchema, {
      smartTurn: "ready",
      whisper: "ready",
      capability: "ready",
      limits: {
        sampleRateHz: SPEECH_SAMPLE_RATE_HZ,
        maxTurnSeconds: 60,
        maxTurnBytes: 3_840_000,
        endpointWindowSeconds: 8,
        endpointWindowBytes: 512_000,
      },
    })).toBe(true);

    expect(Check(SpeechTranscriptionResponseSchema, { text: "spoken words" })).toBe(true);
    expect(Check(SpeechTranscriptionResponseSchema, { text: "x".repeat(SPEECH_MAX_TRANSCRIPT_CHARS) })).toBe(true);
    expect(Check(SpeechTranscriptionResponseSchema, { text: "x".repeat(SPEECH_MAX_TRANSCRIPT_CHARS + 1) })).toBe(false);
    expect(Check(SpeechErrorResponseSchema, { error: { kind: "speech_unavailable", message: "Speech is unavailable.", retryable: true } })).toBe(true);
  });

  it("rejects malformed wire payloads instead of trusting ad hoc objects", () => {
    expect(() => parseSpeechServiceStatusResponse({ smartTurn: "ready", whisper: "ready", capability: "ready" })).toThrow(/speech status/i);
    expect(() => parseSpeechTranscriptionResponse({ text: "" })).toThrow(/transcription/i);
    expect(() => parseSpeechErrorResponse({ error: { kind: "unknown", message: "nope", retryable: false } })).toThrow(/speech error/i);
  });
});
