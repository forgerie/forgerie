import {
  parseSpeechErrorResponse,
  parseSpeechServiceStatusResponse,
  parseSpeechTranscriptionResponse,
  parseSpeechTurnDecisionResponse,
  type SpeechErrorKind,
  type SpeechServiceStatusResponse,
  type SpeechTranscriptionResponse,
  type SpeechTurnDecisionResponse,
} from "./speechContracts";
import { SPEECH_PCM_BYTES_PER_SAMPLE } from "./speechPolicy";

export type SpeechApiErrorKind = SpeechErrorKind | "cancelled" | "network" | "invalid_response";

export class SpeechApiError extends Error {
  public constructor(
    public readonly kind: SpeechApiErrorKind,
    message: string,
    public readonly options: { readonly status?: number; readonly retryable: boolean; readonly limit?: number } = { retryable: false },
  ) {
    super(message);
    this.name = "SpeechApiError";
  }

  public get status(): number | undefined {
    return this.options.status;
  }

  public get retryable(): boolean {
    return this.options.retryable;
  }

  public get limit(): number | undefined {
    return this.options.limit;
  }
}

export interface SpeechApiRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export async function getSpeechStatus(options: SpeechApiRequestOptions = {}): Promise<SpeechServiceStatusResponse> {
  return speechJsonRequest("api/speech/status", parseSpeechServiceStatusResponse, { method: "GET" }, options);
}

export async function checkSpeechTurn(pcm: Float32Array, options: SpeechApiRequestOptions = {}): Promise<SpeechTurnDecisionResponse> {
  throwIfCallerAborted(options.signal);
  const body = speechPcmRequestBody(pcm);
  return speechJsonRequest("api/speech/check-turn", parseSpeechTurnDecisionResponse, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: body.buffer,
  }, options);
}

export async function transcribeSpeech(pcm: Float32Array, options: SpeechApiRequestOptions = {}): Promise<SpeechTranscriptionResponse> {
  throwIfCallerAborted(options.signal);
  const body = speechPcmRequestBody(pcm);
  return speechJsonRequest("api/speech/transcribe", parseSpeechTranscriptionResponse, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: body.buffer,
  }, options);
}

export function speechPcmRequestBody(pcm: Float32Array): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(pcm.length * SPEECH_PCM_BYTES_PER_SAMPLE);
  const view = new DataView(body.buffer);
  for (let index = 0; index < pcm.length; index += 1) view.setFloat32(index * SPEECH_PCM_BYTES_PER_SAMPLE, pcm[index] ?? 0, true);
  return body;
}

async function speechJsonRequest<T>(path: string, parse: (value: unknown) => T, init: RequestInit, options: SpeechApiRequestOptions): Promise<T> {
  const abort = composeAbort(options.signal, options.timeoutMs);
  try {
    const response = await fetch(`/${path}`, { ...init, signal: abort.signal });
    const body: unknown = await response.json().catch((): unknown => undefined);
    if (!response.ok) throw errorFromResponse(response.status, body);
    try {
      return parse(body);
    } catch (error) {
      throw new SpeechApiError("invalid_response", error instanceof Error ? error.message : "Speech response was invalid.", { retryable: true });
    }
  } catch (error) {
    if (error instanceof SpeechApiError) throw error;
    if (abort.signal.aborted || isAbortError(error)) throw errorFromAbortCause(abort.cause());
    throw new SpeechApiError("network", "Speech request failed.", { retryable: true });
  } finally {
    abort.cleanup();
  }
}

function errorFromResponse(status: number, body: unknown): SpeechApiError {
  try {
    const parsed = parseSpeechErrorResponse(body);
    return new SpeechApiError(parsed.error.kind, parsed.error.message, { status, retryable: parsed.error.retryable, ...(parsed.error.limit === undefined ? {} : { limit: parsed.error.limit }) });
  } catch {
    return new SpeechApiError("speech_failed", "Speech request failed.", { status, retryable: status >= 500 || status === 429 });
  }
}

type SpeechAbortCause = "caller" | "timeout";

function composeAbort(parent: AbortSignal | undefined, timeoutMs: number | undefined): { readonly signal: AbortSignal; cause(): SpeechAbortCause | undefined; cleanup(): void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cause: SpeechAbortCause | undefined;
  const abortWith = (nextCause: SpeechAbortCause): void => {
    if (controller.signal.aborted) return;
    cause = nextCause;
    controller.abort();
  };
  const abortFromParent = (): void => { abortWith("caller"); };
  if (parent?.aborted === true) abortWith("caller");
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  if (timeoutMs !== undefined) timer = setTimeout(() => { abortWith("timeout"); }, Math.max(0, timeoutMs));
  return {
    signal: controller.signal,
    cause: () => cause,
    cleanup: () => {
      parent?.removeEventListener("abort", abortFromParent);
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

function throwIfCallerAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new SpeechApiError("cancelled", "Speech request was cancelled.", { retryable: false });
}

function errorFromAbortCause(cause: SpeechAbortCause | undefined): SpeechApiError {
  if (cause === "timeout") return new SpeechApiError("timeout", "Speech request timed out.", { retryable: true });
  return new SpeechApiError("cancelled", "Speech request was cancelled.", { retryable: false });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
