import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError, toFile } from "openai";
import { SPEECH_MAX_TRANSCRIPT_CHARS } from "../../shared/speechPolicy.js";
import { float32PcmToWav, type ValidatedSpeechPcm } from "./speechAudio.js";
import { SpeechError, type SpeechComponentStatus, type SpeechOperationOptions } from "./speechErrors.js";
import type { SpeechBackend, SpeechTranscription } from "./speechService.js";
import type { SpeechToTextSettings } from "./speechToTextSettings.js";

export interface OpenAiTranscriptionBackendOptions {
  /** Read at each use, so a Settings change applies to the next status check or recording. */
  readonly settings: () => SpeechToTextSettings;
  /** The service's key. Undefined sends no Authorization header. */
  readonly apiKey: () => string | undefined;
  readonly statusTimeoutMs?: number;
  readonly transcriptionTimeoutMs?: number;
}

const DEFAULT_STATUS_TIMEOUT_MS = 3_000;
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 120_000;

/**
 * Sends speech to any service that speaks the OpenAI audio API: a 16-bit mono
 * WAV to `POST <baseUrl>/audio/transcriptions`, reading `{ text }` back. The
 * official `openai` client builds the request, so a service that works with
 * that client works here.
 */
export function createOpenAiTranscriptionBackend(options: OpenAiTranscriptionBackendOptions): SpeechBackend {
  const closing = new AbortController();
  return {
    status: async () => {
      if (closing.signal.aborted) return "unavailable";
      const settings = options.settings();
      if (settings.baseUrl === undefined) return "unavailable";
      return await reachable(clientFor(settings.baseUrl, options.apiKey()), options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS, closing.signal);
    },
    close: () => {
      closing.abort();
      return Promise.resolve();
    },
    transcribe: async (pcm, operation = {}) => {
      if (closing.signal.aborted) throw new SpeechError("closed", "Speech service is closed.");
      const settings = options.settings();
      if (settings.baseUrl === undefined) throw new SpeechError("unavailable", "Speech to text has no service address.");
      return await transcribe(clientFor(settings.baseUrl, options.apiKey()), settings, pcm, {
        timeoutMs: operation.timeoutMs ?? options.transcriptionTimeoutMs ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
        signal: operation.signal === undefined ? closing.signal : AbortSignal.any([operation.signal, closing.signal]),
      }, closing.signal);
    },
  };
}

/**
 * Every option the client would otherwise read from OPENAI_* variables is set
 * here, so an OpenAI key in this process's environment never reaches another
 * service. The client refuses to start without a key; with none, a placeholder
 * satisfies it and the null header removes it from every request.
 */
function clientFor(baseURL: string, apiKey: string | undefined): OpenAI {
  return new OpenAI({
    baseURL, apiKey: apiKey ?? "none", adminAPIKey: null, organization: null, project: null, webhookSecret: null,
    maxRetries: 0,
    ...(apiKey === undefined ? { defaultHeaders: { Authorization: null } } : {}),
  });
}

/**
 * The OpenAI API has no health route; `GET /models` is the closest standard
 * one. A service that answers 404 or 405 is up but does not list models.
 */
async function reachable(client: OpenAI, timeoutMs: number, signal: AbortSignal): Promise<SpeechComponentStatus> {
  try {
    await client.models.list({ timeout: timeoutMs, signal });
    return "ready";
  } catch (error) {
    if (error instanceof APIError && (error.status === 404 || error.status === 405)) return "ready";
    return "unavailable";
  }
}

async function transcribe(client: OpenAI, settings: SpeechToTextSettings, pcm: ValidatedSpeechPcm, operation: Required<SpeechOperationOptions>, closing: AbortSignal): Promise<SpeechTranscription> {
  let text: string;
  try {
    const result = await client.audio.transcriptions.create({
      file: await toFile(float32PcmToWav(pcm.samples), "speech.wav", { type: "audio/wav" }),
      model: settings.model,
      response_format: "json",
      ...(settings.language === undefined ? {} : { language: settings.language }),
    }, { timeout: operation.timeoutMs, signal: operation.signal });
    text = result.text;
  } catch (error) {
    throw speechErrorFor(error, closing);
  }
  if (typeof text !== "string") throw new SpeechError("failed", "Speech service returned no text.");
  if (Array.from(text).length > SPEECH_MAX_TRANSCRIPT_CHARS) throw new SpeechError("failed", "Speech service returned more text than the limit.");
  const trimmed = text.trim();
  if (trimmed === "") throw new SpeechError("empty", "Speech service returned empty text.");
  return { text: trimmed };
}

function speechErrorFor(error: unknown, closing: AbortSignal): SpeechError {
  // Timeout is a subclass of the connection error, so test it first.
  if (error instanceof APIConnectionTimeoutError) return new SpeechError("timeout", "Speech service timed out.", { cause: error });
  if (error instanceof APIUserAbortError) return closing.aborted
    ? new SpeechError("closed", "Speech service is closed.", { cause: error })
    : new SpeechError("aborted", "Speech request was cancelled.", { cause: error });
  if (error instanceof APIConnectionError) return new SpeechError("unavailable", "Speech service did not answer.", { cause: error });
  if (error instanceof APIError && error.status === 429) return new SpeechError("overloaded", "Speech service is busy.", { cause: error });
  if (error instanceof APIError) return new SpeechError("failed", `Speech service answered HTTP ${String(error.status)}.`, { cause: error });
  return new SpeechError("failed", "Speech request failed.", { cause: error });
}
