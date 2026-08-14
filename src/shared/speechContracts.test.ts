import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { SPEECH_SAMPLE_RATE_HZ } from "./speechPolicy.js";
import {
  SpeechErrorResponseSchema,
  SpeechServiceStatusResponseSchema,
  SpeechTranscriptionResponseSchema,
  SpeechTurnDecisionResponseSchema,
  parseSpeechErrorResponse,
  parseSpeechServiceStatusResponse,
  parseSpeechTranscriptionResponse,
  parseSpeechTurnDecisionResponse,
} from "./speechContracts.js";

describe("speech HTTP contracts", () => {
  it("validates status, endpoint decision, transcription, and discriminated error payloads", () => {
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

    expect(Check(SpeechTurnDecisionResponseSchema, { complete: true, probability: 0.75, samples: 32_000 })).toBe(true);
    expect(Check(SpeechTranscriptionResponseSchema, { text: "spoken words" })).toBe(true);
    expect(Check(SpeechErrorResponseSchema, { error: { kind: "speech_unavailable", message: "Speech is unavailable.", retryable: true } })).toBe(true);
  });

  it("rejects malformed wire payloads instead of trusting ad hoc objects", () => {
    expect(() => parseSpeechServiceStatusResponse({ smartTurn: "ready", whisper: "ready", capability: "ready" })).toThrow(/speech status/i);
    expect(() => parseSpeechTurnDecisionResponse({ complete: true, probability: 1.5, samples: 1 })).toThrow(/turn decision/i);
    expect(() => parseSpeechTranscriptionResponse({ text: "" })).toThrow(/transcription/i);
    expect(() => parseSpeechErrorResponse({ error: { kind: "unknown", message: "nope", retryable: false } })).toThrow(/speech error/i);
  });
});
