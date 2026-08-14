import { afterEach, describe, expect, it, vi } from "vitest";
import { SPEECH_POLICY } from "../../../shared/speechPolicy";
import { checkSpeechTurn, getSpeechStatus, speechPcmRequestBody, transcribeSpeech } from "./speech";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe("speech API client", () => {
  it("loads status through the app-relative speech route and shared schema", async () => {
    const fetchCalls: { url: string; init: RequestInit | undefined }[] = [];
    installFetch((url, init) => {
      fetchCalls.push({ url, init });
      return jsonResponse(200, {
        smartTurn: "ready",
        whisper: "ready",
        capability: "ready",
        limits: {
          sampleRateHz: 16_000,
          maxTurnSeconds: SPEECH_POLICY.audio.maxTurnSeconds,
          maxTurnBytes: SPEECH_POLICY.audio.maxTurnBytes,
          endpointWindowSeconds: SPEECH_POLICY.audio.endpointWindowSeconds,
          endpointWindowBytes: SPEECH_POLICY.audio.endpointWindowBytes,
        },
      });
    });

    await expect(getSpeechStatus({ appUrlContext: appUrlContext() })).resolves.toMatchObject({ capability: "ready" });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://forgerie.example/app/api/speech/status");
    expect(fetchCalls[0]?.init?.method).toBe("GET");
  });

  it("sends raw little-endian float32 bytes for endpoint and transcription requests", async () => {
    const bodies: Uint8Array[] = [];
    installFetch((_url, init) => {
      expect(init?.headers).toMatchObject({ "content-type": "application/octet-stream" });
      bodies.push(arrayBufferBody(init));
      return bodies.length === 1
        ? jsonResponse(200, { complete: true, probability: 0.75, samples: 2 })
        : jsonResponse(200, { text: "spoken text" });
    });

    const pcm = new Float32Array([0.25, -0.5]);
    await expect(checkSpeechTurn(pcm, { appUrlContext: appUrlContext() })).resolves.toEqual({ complete: true, probability: 0.75, samples: 2 });
    await expect(transcribeSpeech(pcm, { appUrlContext: appUrlContext() })).resolves.toEqual({ text: "spoken text" });

    expect([...bodies[0] ?? []]).toEqual([...speechPcmRequestBody(pcm)]);
    expect([...bodies[1] ?? []]).toEqual([...speechPcmRequestBody(pcm)]);
  });

  it("maps typed server errors and schema-invalid responses to stable SpeechApiError values", async () => {
    installFetch(() => jsonResponse(429, { error: { kind: "overloaded", message: "Speech processing is busy.", retryable: true } }));

    await expect(checkSpeechTurn(new Float32Array([0]), { appUrlContext: appUrlContext() })).rejects.toMatchObject({
      name: "SpeechApiError",
      kind: "overloaded",
      status: 429,
      retryable: true,
      message: "Speech processing is busy.",
    });

    installFetch(() => jsonResponse(200, { complete: "yes" }));
    await expect(checkSpeechTurn(new Float32Array([0]), { appUrlContext: appUrlContext() })).rejects.toMatchObject({
      kind: "invalid_response",
      retryable: true,
    });
  });

  it("rejects pre-aborted caller requests before PCM encoding", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetchCalls = 0;
    installFetch(() => {
      fetchCalls += 1;
      return jsonResponse(200, { text: "unreachable" });
    });
    const encodeSpy = vi.spyOn(DataView.prototype, "setFloat32");

    await expect(transcribeSpeech(new Float32Array([1]), { appUrlContext: appUrlContext(), signal: controller.signal })).rejects.toMatchObject({ kind: "cancelled", retryable: false });
    expect(fetchCalls).toBe(0);
    expect(encodeSpy).not.toHaveBeenCalled();
  });

  it("maps in-flight caller aborts to non-retryable cancellation", async () => {
    const controller = new AbortController();
    const aborts: AbortSignal[] = [];
    installFetch((_url, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) throw new Error("missing abort signal");
      aborts.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => { reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    });

    const request = transcribeSpeech(new Float32Array([0]), { appUrlContext: appUrlContext(), signal: controller.signal, timeoutMs: 1_000 });
    controller.abort();

    await expect(request).rejects.toMatchObject({ kind: "cancelled", retryable: false });
    expect(aborts).toHaveLength(1);
  });

  it("maps client timeouts to retryable timeout errors", async () => {
    vi.useFakeTimers();
    const aborts: AbortSignal[] = [];
    installFetch((_url, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) throw new Error("missing abort signal");
      aborts.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => { reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    });

    const request = transcribeSpeech(new Float32Array([0]), { appUrlContext: appUrlContext(), timeoutMs: 25 });
    const expectation = expect(request).rejects.toMatchObject({ kind: "timeout", retryable: true });
    await vi.advanceTimersByTimeAsync(25);

    await expectation;
    expect(aborts).toHaveLength(1);
  });
});

function installFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): void {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    return Promise.resolve(handler(url, init));
  };
}

function arrayBufferBody(init: RequestInit | undefined): Uint8Array {
  if (!(init?.body instanceof ArrayBuffer)) throw new Error("expected ArrayBuffer body");
  return new Uint8Array(init.body);
}

function appUrlContext() {
  return { viteBaseUrl: "/app/", documentBaseUrl: "https://forgerie.example/app/index.html" };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
