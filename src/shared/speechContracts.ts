import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { SPEECH_SAMPLE_RATE_HZ } from "./speechPolicy.js";

export const SpeechComponentStatusSchema = Type.Union([
  Type.Literal("warming"),
  Type.Literal("ready"),
  Type.Literal("unavailable"),
]);

export const SpeechCapabilitySchema = Type.Union([
  Type.Literal("warming"),
  Type.Literal("ready"),
  Type.Literal("manual-only"),
  Type.Literal("unavailable"),
]);

export const SpeechLimitsSchema = Type.Object({
  sampleRateHz: Type.Literal(SPEECH_SAMPLE_RATE_HZ),
  maxTurnSeconds: Type.Number({ minimum: 0 }),
  maxTurnBytes: Type.Integer({ minimum: 1 }),
  endpointWindowSeconds: Type.Number({ minimum: 0 }),
  endpointWindowBytes: Type.Integer({ minimum: 1 }),
}, { additionalProperties: false });

export const SpeechServiceStatusResponseSchema = Type.Object({
  smartTurn: SpeechComponentStatusSchema,
  whisper: SpeechComponentStatusSchema,
  capability: SpeechCapabilitySchema,
  limits: SpeechLimitsSchema,
}, { additionalProperties: false });

export const SpeechTurnDecisionResponseSchema = Type.Object({
  complete: Type.Boolean(),
  probability: Type.Number({ minimum: 0, maximum: 1 }),
  samples: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

export const SpeechTranscriptionResponseSchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 4096 }),
}, { additionalProperties: false });

export const SpeechErrorKindSchema = Type.Union([
  Type.Literal("bad_request"),
  Type.Literal("cancelled"),
  Type.Literal("closed"),
  Type.Literal("forbidden"),
  Type.Literal("invalid_pcm"),
  Type.Literal("overloaded"),
  Type.Literal("speech_failed"),
  Type.Literal("speech_unavailable"),
  Type.Literal("timeout"),
  Type.Literal("too_large"),
  Type.Literal("too_short"),
  Type.Literal("transcription_empty"),
  Type.Literal("unsupported_encoding"),
  Type.Literal("unsupported_media_type"),
], { description: "Stable speech route error kinds." });

export const SpeechErrorResponseSchema = Type.Object({
  error: Type.Object({
    kind: SpeechErrorKindSchema,
    message: Type.String({ minLength: 1, maxLength: 240 }),
    retryable: Type.Boolean(),
    limit: Type.Optional(Type.Integer({ minimum: 0 })),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

export type SpeechServiceStatusResponse = Static<typeof SpeechServiceStatusResponseSchema>;
export type SpeechTurnDecisionResponse = Static<typeof SpeechTurnDecisionResponseSchema>;
export type SpeechTranscriptionResponse = Static<typeof SpeechTranscriptionResponseSchema>;
export type SpeechErrorKind = Static<typeof SpeechErrorKindSchema>;
export type SpeechErrorResponse = Static<typeof SpeechErrorResponseSchema>;

export function parseSpeechServiceStatusResponse(value: unknown): SpeechServiceStatusResponse {
  assertSpeechServiceStatusResponse(value);
  return value;
}

export function parseSpeechTurnDecisionResponse(value: unknown): SpeechTurnDecisionResponse {
  assertSpeechTurnDecisionResponse(value);
  return value;
}

export function parseSpeechTranscriptionResponse(value: unknown): SpeechTranscriptionResponse {
  assertSpeechTranscriptionResponse(value);
  return value;
}

export function parseSpeechErrorResponse(value: unknown): SpeechErrorResponse {
  assertSpeechErrorResponse(value);
  return value;
}

function assertSpeechServiceStatusResponse(value: unknown): asserts value is SpeechServiceStatusResponse {
  if (!Check(SpeechServiceStatusResponseSchema, value)) throw new Error("Invalid speech status response.");
}

function assertSpeechTurnDecisionResponse(value: unknown): asserts value is SpeechTurnDecisionResponse {
  if (!Check(SpeechTurnDecisionResponseSchema, value)) throw new Error("Invalid speech turn decision response.");
}

function assertSpeechTranscriptionResponse(value: unknown): asserts value is SpeechTranscriptionResponse {
  if (!Check(SpeechTranscriptionResponseSchema, value)) throw new Error("Invalid speech transcription response.");
}

function assertSpeechErrorResponse(value: unknown): asserts value is SpeechErrorResponse {
  if (!Check(SpeechErrorResponseSchema, value)) throw new Error("Invalid speech error response.");
}
