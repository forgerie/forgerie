import { once } from "node:events";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { SPEECH_POLICY, type SpeechRuntimePolicy } from "../../shared/speechPolicy.js";
import { parseSpeechErrorResponse, parseSpeechServiceStatusResponse } from "../../shared/speechContracts.js";
import { SpeechProcessError } from "./speechProcess.js";
import { createSpeechService } from "./speechService.js";
import type { SpeechBackend, SpeechService, SpeechServiceStatus } from "./speechService.js";

function pcmBytes(samples: readonly number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach((sample, index) => { buffer.writeFloatLE(sample, index * 4); });
  return buffer;
}

function validPcm(policy: SpeechRuntimePolicy = SPEECH_POLICY): Buffer {
  return pcmBytes(Array.from({ length: policy.audio.minRequestSamples }, () => 0.05));
}

function tinyPolicy(overrides: Partial<SpeechRuntimePolicy> = {}): SpeechRuntimePolicy {
  const policy: SpeechRuntimePolicy = {
    ...SPEECH_POLICY,
    audio: {
      ...SPEECH_POLICY.audio,
      minRequestMs: 1,
      minRequestSamples: 1,
      minRequestBytes: 4,
      endpointWindowSeconds: 1,
      endpointWindowSamples: 2,
      endpointWindowBytes: 8,
      maxTurnSeconds: 1,
      maxTurnSamples: 2,
      maxTurnBytes: 8,
    },
    timing: { ...SPEECH_POLICY.timing, operationDeadlineMs: 1_000, endpointDeadlineMs: 500 },
    admission: {
      ...SPEECH_POLICY.admission,
      maxQueuedPcmBytes: 8,
      maxConcurrentParsingBytes: 4,
      globalWindowMs: 60_000,
      globalEndpointChecksPerWindow: 1,
      globalTranscriptionsPerWindow: 1,
    },
    ...overrides,
  };
  return policy;
}

interface ServiceOptions {
  status?: SpeechServiceStatus;
  checkTurn?: SpeechService["checkTurn"];
  transcribe?: SpeechService["transcribe"];
  close?: SpeechService["close"];
}

function speechService(options: ServiceOptions = {}): SpeechService {
  const status = options.status ?? { smartTurn: "ready", whisper: "ready", capability: "ready" };
  return {
    status: () => status,
    warm: () => Promise.resolve(),
    checkTurn: options.checkTurn ?? vi.fn(() => Promise.resolve({ complete: true, probability: 0.75, samples: SPEECH_POLICY.audio.minRequestSamples })),
    transcribe: options.transcribe ?? vi.fn(() => Promise.resolve({ text: "spoken words" })),
    close: options.close ?? vi.fn(() => Promise.resolve()),
  };
}

function speechBackend(options: Partial<SpeechBackend> = {}): SpeechBackend {
  return {
    status: options.status ?? (() => "ready"),
    start: options.start ?? (() => Promise.resolve()),
    close: options.close ?? (() => Promise.resolve()),
    ...(options.checkTurn === undefined ? {} : { checkTurn: options.checkTurn }),
    ...(options.transcribe === undefined ? {} : { transcribe: options.transcribe }),
  };
}

async function appWithSpeech(service: SpeechService = speechService(), policy: SpeechRuntimePolicy = SPEECH_POLICY, speechAllowedHosts: readonly string[] = ["forgerie.example.test"]): Promise<FastifyInstance> {
  return await buildApp({ speech: service, speechPolicy: policy, speechAllowedHosts, clientDist: false, logger: false });
}

async function close(app: FastifyInstance): Promise<void> {
  await app.close();
}

async function listenOnLoopback(app: FastifyInstance): Promise<number> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === "string") throw new Error("Expected Fastify to listen on a TCP port.");
  return address.port;
}

async function connectSocket(port: number): Promise<Socket> {
  const socket = new Socket();
  socket.connect(port, "127.0.0.1");
  await once(socket, "connect");
  return socket;
}

function writeSpeechPost(socket: Socket, port: number, path: string, headers: Readonly<Record<string, string>>, payload: Buffer | Uint8Array): void {
  const head = [
    `POST ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${String(port)}`,
    "Connection: keep-alive",
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "",
    "",
  ].join("\r\n");
  socket.write(head);
  if (payload.byteLength > 0) socket.write(payload);
}

interface RawHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

async function readClosedHttpResponse(socket: Socket): Promise<RawHttpResponse> {
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => { chunks.push(chunk); });
  await Promise.race([
    once(socket, "close"),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => { reject(new Error(`Timed out waiting for raw speech socket closure. Received: ${Buffer.concat(chunks).toString("utf8")}`)); }, 1_000);
    }),
  ]);
  return parseRawHttpResponse(Buffer.concat(chunks).toString("utf8"));
}

function parseRawHttpResponse(raw: string): RawHttpResponse {
  const [head = "", body = ""] = raw.split("\r\n\r\n", 2);
  const lines = head.split("\r\n");
  const statusCode = Number(lines[0]?.split(" ")[1]);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
  }
  const contentLength = Number(headers["content-length"]);
  return { statusCode, headers, body: Number.isSafeInteger(contentLength) ? body.slice(0, contentLength) : body };
}

function expectClosedSpeechError(response: RawHttpResponse, statusCode: number, kind: ReturnType<typeof parseSpeechErrorResponse>["error"]["kind"]): void {
  expect(response.statusCode).toBe(statusCode);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["connection"]).toBe("close");
  expect(parseSpeechErrorResponse(JSON.parse(response.body)).error.kind).toBe(kind);
}

describe("speech routes", () => {
  it("publishes gateway-local status with no-store and no selected-machine alias", async () => {
    const service = speechService({ status: { smartTurn: "unavailable", whisper: "ready", capability: "manual-only" } });
    const app = await appWithSpeech(service);
    try {
      const response = await app.inject({ method: "GET", url: "/api/speech/status" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const status = parseSpeechServiceStatusResponse(response.json());
      expect(status).toMatchObject({ smartTurn: "unavailable", whisper: "ready", capability: "manual-only" });
      expect(status.limits).toMatchObject({ sampleRateHz: 16_000, maxTurnSeconds: 600, maxTurnBytes: 38_400_000, endpointWindowSeconds: 8 });

      const machineAlias = await app.inject({ method: "GET", url: "/api/machines/local/speech/status" });
      expect(machineAlias.statusCode).toBe(404);
    } finally {
      await close(app);
    }
  });

  it("accepts same-origin browser endpoint checks and transcriptions through typed binary routes", async () => {
    let checkSignal: AbortSignal | undefined;
    let transcribeSignal: AbortSignal | undefined;
    let checkCalls = 0;
    let transcribeCalls = 0;
    const checkTurn: SpeechService["checkTurn"] = (_pcm, options) => {
      checkCalls += 1;
      checkSignal = options?.signal;
      return Promise.resolve({ complete: false, probability: 0.25, samples: SPEECH_POLICY.audio.minRequestSamples });
    };
    const transcribe: SpeechService["transcribe"] = (_pcm, options) => {
      transcribeCalls += 1;
      transcribeSignal = options?.signal;
      return Promise.resolve({ text: "hello from speech" });
    };
    const app = await appWithSpeech(speechService({ checkTurn, transcribe }));
    const payload = validPcm();
    try {
      const check = await app.inject({
        method: "POST",
        url: "/api/speech/check-turn",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(payload.byteLength),
          origin: "https://forgerie.example.test",
          host: "forgerie.example.test",
          "sec-fetch-site": "same-origin",
        },
        payload,
      });
      expect(check.statusCode).toBe(200);
      expect(check.headers["cache-control"]).toBe("no-store");
      expect(check.json()).toEqual({ complete: false, probability: 0.25, samples: SPEECH_POLICY.audio.minRequestSamples });
      expect(checkCalls).toBe(1);
      expect(checkSignal).toBeInstanceOf(AbortSignal);
      expect(checkSignal?.aborted).toBe(false);

      const transcription = await app.inject({
        method: "POST",
        url: "/api/speech/transcribe",
        headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) },
        payload,
      });
      expect(transcription.statusCode).toBe(200);
      expect(transcription.headers["cache-control"]).toBe("no-store");
      expect(transcription.json()).toEqual({ text: "hello from speech" });
      expect(transcribeCalls).toBe(1);
      expect(transcribeSignal).toBeInstanceOf(AbortSignal);
      expect(transcribeSignal?.aborted).toBe(false);
    } finally {
      await close(app);
    }
  });

  it("aborts the operation signal when a real client disconnects after a complete upload", async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveService!: (value: { complete: boolean; probability: number; samples: number }) => void;
    const pendingService = new Promise<{ complete: boolean; probability: number; samples: number }>((resolve) => { resolveService = resolve; });
    const checkTurn: SpeechService["checkTurn"] = (_pcm, options) => {
      capturedSignal = options?.signal;
      return pendingService;
    };
    const app = await appWithSpeech(speechService({ checkTurn }), SPEECH_POLICY, ["127.0.0.1:0"]);
    const payload = validPcm();
    let socket: Socket | undefined;
    try {
      const port = await listenOnLoopback(app);
      socket = await connectSocket(port);
      writeSpeechPost(socket, port, "/api/speech/check-turn", {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(payload.byteLength),
      }, payload);
      await vi.waitFor(() => { expect(capturedSignal).toBeInstanceOf(AbortSignal); });

      socket.destroy();

      await vi.waitFor(() => { expect(capturedSignal?.aborted).toBe(true); });
      resolveService({ complete: true, probability: 1, samples: SPEECH_POLICY.audio.minRequestSamples });
    } finally {
      socket?.destroy();
      resolveService({ complete: true, probability: 1, samples: SPEECH_POLICY.audio.minRequestSamples });
      await close(app);
    }
  });

  it("destroys stalled partial-body sockets at the speech upload deadline and recovers admission", async () => {
    const policy = tinyPolicy({
      timing: { ...SPEECH_POLICY.timing, bodyUploadDeadlineMs: 50, operationDeadlineMs: 1_000, endpointDeadlineMs: 500 },
      admission: { ...tinyPolicy().admission, globalEndpointChecksPerWindow: 2 },
    });
    const app = await appWithSpeech(speechService(), policy, ["127.0.0.1:0"]);
    const payload = validPcm(policy);
    let socket: Socket | undefined;
    try {
      const port = await listenOnLoopback(app);
      socket = await connectSocket(port);
      writeSpeechPost(socket, port, "/api/speech/check-turn", {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(payload.byteLength),
      }, payload.subarray(0, 1));
      await once(socket, "close");

      const recovered = await app.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) }, payload });
      expect(recovered.statusCode).toBe(200);
    } finally {
      socket?.destroy();
      await close(app);
    }
  });

  it("closes raw slow-body sockets after representative speech guard rejections", async () => {
    const policy = tinyPolicy({
      admission: { ...tinyPolicy().admission, maxConcurrentParsingBytes: 16, globalEndpointChecksPerWindow: 10 },
    });
    const app = await appWithSpeech(speechService(), policy, ["127.0.0.1:0"]);
    const payload = validPcm(policy);
    let socket: Socket | undefined;
    try {
      const port = await listenOnLoopback(app);
      for (const scenario of [
        {
          name: "origin",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(payload.byteLength),
            Origin: "https://evil.example.test",
            "Sec-Fetch-Site": "cross-site",
          },
          statusCode: 403,
          kind: "forbidden",
        },
        {
          name: "media",
          headers: { "Content-Type": "text/plain", "Content-Length": String(payload.byteLength) },
          statusCode: 415,
          kind: "unsupported_media_type",
        },
        {
          name: "encoding",
          headers: { "Content-Type": "application/octet-stream", "Content-Encoding": "gzip", "Content-Length": String(payload.byteLength) },
          statusCode: 415,
          kind: "unsupported_encoding",
        },
        {
          name: "length",
          headers: { "Content-Type": "application/octet-stream" },
          statusCode: 411,
          kind: "bad_request",
        },
        {
          name: "too_large",
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(policy.audio.endpointWindowBytes + policy.audio.bytesPerSample) },
          statusCode: 413,
          kind: "too_large",
        },
        {
          name: "too_short",
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(policy.audio.minRequestBytes - 1) },
          statusCode: 400,
          kind: "too_short",
        },
      ] as const) {
        socket = await connectSocket(port);
        const closed = readClosedHttpResponse(socket);
        writeSpeechPost(socket, port, "/api/speech/check-turn", scenario.headers, payload.subarray(0, 1));
        const response = await closed;
        expectClosedSpeechError(response, scenario.statusCode, scenario.kind);
        socket = undefined;
      }
    } finally {
      socket?.destroy();
      await close(app);
    }
  });

  it("closes raw slow-body sockets after speech admission and budget rejections", async () => {
    const policy = tinyPolicy({
      admission: { ...tinyPolicy().admission, maxConcurrentParsingBytes: 0, globalEndpointChecksPerWindow: 2 },
    });
    const app = await appWithSpeech(speechService(), policy, ["127.0.0.1:0"]);
    const payload = validPcm(policy);
    let socket: Socket | undefined;
    try {
      const port = await listenOnLoopback(app);
      socket = await connectSocket(port);
      let closed = readClosedHttpResponse(socket);
      writeSpeechPost(socket, port, "/api/speech/check-turn", {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(payload.byteLength),
      }, payload.subarray(0, 1));
      expectClosedSpeechError(await closed, 429, "overloaded");
      socket = undefined;
      await close(app);

      const budgetPolicy = tinyPolicy({
        admission: { ...tinyPolicy().admission, maxConcurrentParsingBytes: 4, globalEndpointChecksPerWindow: 1 },
      });
      const budgetApp = await appWithSpeech(speechService(), budgetPolicy, ["127.0.0.1:0"]);
      try {
        const budgetPort = await listenOnLoopback(budgetApp);
        const ok = await budgetApp.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) }, payload });
        expect(ok.statusCode).toBe(200);

        socket = await connectSocket(budgetPort);
        closed = readClosedHttpResponse(socket);
        writeSpeechPost(socket, budgetPort, "/api/speech/check-turn", {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(payload.byteLength),
        }, payload.subarray(0, 1));
        expectClosedSpeechError(await closed, 429, "overloaded");
        socket = undefined;
      } finally {
        socket?.destroy();
        await close(budgetApp);
      }
    } finally {
      socket?.destroy();
      if (app.server.listening) await close(app);
    }
  });

  it("keeps direct trusted-tailnet clients without browser headers accepted but rejects cross-origin and DNS-rebound browser requests", async () => {
    const app = await appWithSpeech(undefined, SPEECH_POLICY, ["https://FORGERIE.example.test"]);
    const payload = validPcm();
    try {
      const direct = await app.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) }, payload });
      expect(direct.statusCode).toBe(200);

      const canonicalBrowser = await app.inject({
        method: "POST",
        url: "/api/speech/check-turn",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(payload.byteLength),
          origin: "https://FORGERIE.EXAMPLE.TEST",
          host: "forgerie.example.test",
          "sec-fetch-site": "same-origin",
        },
        payload,
      });
      expect(canonicalBrowser.statusCode).toBe(200);

      const crossOrigin = await app.inject({
        method: "POST",
        url: "/api/speech/check-turn",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(payload.byteLength),
          origin: "https://evil.example.test",
          host: "forgerie.example.test",
          "sec-fetch-site": "cross-site",
        },
        payload,
      });
      expect(crossOrigin.statusCode).toBe(403);
      expect(parseSpeechErrorResponse(crossOrigin.json())).toEqual({ error: { kind: "forbidden", message: "Speech request origin is not allowed.", retryable: false } });

      const rebound = await app.inject({
        method: "POST",
        url: "/api/speech/check-turn",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(payload.byteLength),
          origin: "https://attacker-controlled.example.test",
          host: "attacker-controlled.example.test",
          "sec-fetch-site": "same-origin",
        },
        payload,
      });
      expect(rebound.statusCode).toBe(403);

      const secFetchWithoutOrigin = await app.inject({
        method: "POST",
        url: "/api/speech/check-turn",
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(payload.byteLength),
          host: "forgerie.example.test",
          "sec-fetch-site": "same-origin",
        },
        payload,
      });
      expect(secFetchWithoutOrigin.statusCode).toBe(403);
    } finally {
      await close(app);
    }
  });

  it("maps speech body parser failures to stable no-store errors", async () => {
    const policy = tinyPolicy({
      admission: { ...tinyPolicy().admission, maxConcurrentParsingBytes: 32, globalEndpointChecksPerWindow: 10 },
    });
    const app = await appWithSpeech(speechService(), policy);
    try {
      const tooLarge = await app.inject({
        method: "POST",
        url: "/api/speech/check-turn",
        headers: { "content-type": "application/octet-stream", "content-length": String(policy.audio.endpointWindowBytes) },
        payload: Buffer.alloc(policy.audio.endpointWindowBytes + policy.audio.bytesPerSample),
      });
      expect(tooLarge.statusCode).toBe(413);
      expect(tooLarge.headers["cache-control"]).toBe("no-store");
      expect(parseSpeechErrorResponse(tooLarge.json())).toEqual({ error: { kind: "too_large", message: "Speech audio exceeds the operation byte limit.", retryable: false, limit: policy.audio.endpointWindowBytes } });
      expect(tooLarge.body).not.toContain("FST_ERR_CTP_BODY_TOO_LARGE");
      expect(tooLarge.json()).not.toHaveProperty("statusCode");
      expect(tooLarge.json()).not.toHaveProperty("code");

      const mismatchedLength = await app.inject({
        method: "POST",
        url: "/api/speech/check-turn",
        headers: { "content-type": "application/octet-stream", "content-length": String(policy.audio.endpointWindowBytes) },
        payload: Buffer.alloc(policy.audio.endpointWindowBytes - policy.audio.bytesPerSample),
      });
      expect(mismatchedLength.statusCode).toBe(400);
      expect(mismatchedLength.headers["cache-control"]).toBe("no-store");
      expect(parseSpeechErrorResponse(mismatchedLength.json())).toEqual({ error: { kind: "bad_request", message: "Speech audio body size did not match Content-Length.", retryable: false } });
      expect(mismatchedLength.body).not.toContain("FST_ERR_CTP_INVALID_CONTENT_LENGTH");
      expect(mismatchedLength.json()).not.toHaveProperty("statusCode");
      expect(mismatchedLength.json()).not.toHaveProperty("code");
    } finally {
      await close(app);
    }
  });

  it("rejects unsupported media type, content encoding, declared length, and lets the service own exact PCM validation before backend calls", async () => {
    const backendCheckTurn = vi.fn(() => Promise.resolve({ complete: true, probability: 1, samples: 1 }));
    const validatingService = createSpeechService({ smartTurn: speechBackend({ checkTurn: backendCheckTurn }), whisper: speechBackend() });
    const app = await appWithSpeech(validatingService);
    const payload = validPcm();
    try {
      const wrongType = await app.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "text/plain", "content-length": String(payload.byteLength) }, payload });
      expect(wrongType.statusCode).toBe(415);
      expect(parseSpeechErrorResponse(wrongType.json()).error.kind).toBe("unsupported_media_type");

      const encoded = await app.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-encoding": "gzip", "content-length": String(payload.byteLength) }, payload });
      expect(encoded.statusCode).toBe(415);
      expect(parseSpeechErrorResponse(encoded.json()).error.kind).toBe("unsupported_encoding");

      const tooLargeDeclared = await app.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-length": String(SPEECH_POLICY.audio.endpointWindowBytes + 4) }, payload });
      expect(tooLargeDeclared.statusCode).toBe(413);
      expect(parseSpeechErrorResponse(tooLargeDeclared.json()).error.kind).toBe("too_large");

      const invalidPayload = pcmBytes([Number.NaN, ...Array.from({ length: SPEECH_POLICY.audio.minRequestSamples - 1 }, () => 0)]);
      const invalidPcm = await app.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-length": String(invalidPayload.byteLength) }, payload: invalidPayload });
      expect(invalidPcm.statusCode).toBe(400);
      expect(parseSpeechErrorResponse(invalidPcm.json()).error.kind).toBe("invalid_pcm");
      expect(backendCheckTurn).not.toHaveBeenCalled();
    } finally {
      await close(app);
    }
  });

  it("applies aggregate parsing admission and global route token budgets before service invocation", async () => {
    const policy = tinyPolicy();
    let releaseActive!: (value: { complete: boolean; probability: number; samples: number }) => void;
    const active = new Promise<{ complete: boolean; probability: number; samples: number }>((resolve) => { releaseActive = resolve; });
    const checkTurn = vi.fn(() => active);
    const app = await appWithSpeech(speechService({ checkTurn }), policy);
    const payload = validPcm(policy);
    try {
      const first = app.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) }, payload });
      await vi.waitFor(() => { expect(checkTurn).toHaveBeenCalledOnce(); });

      const admittedTooMuch = await app.inject({ method: "POST", url: "/api/speech/transcribe", headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) }, payload });
      expect(admittedTooMuch.statusCode).toBe(429);
      expect(parseSpeechErrorResponse(admittedTooMuch.json()).error.kind).toBe("overloaded");

      releaseActive({ complete: true, probability: 1, samples: policy.audio.minRequestSamples });
      await expect(first).resolves.toBeDefined();
      await close(app);

      const budgetApp = await appWithSpeech(speechService(), policy);
      try {
        const ok = await budgetApp.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) }, payload });
        expect(ok.statusCode).toBe(200);
        const limited = await budgetApp.inject({ method: "POST", url: "/api/speech/check-turn", headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) }, payload });
        expect(limited.statusCode).toBe(429);
        expect(parseSpeechErrorResponse(limited.json()).error.kind).toBe("overloaded");
      } finally {
        await close(budgetApp);
      }
    } finally {
      if (!app.server.listening) await Promise.resolve();
      else await close(app);
    }
  });

  it("maps service failures to stable errors without leaking child output, raw PCM, or transcript text", async () => {
    const canary = "SECRET_CHILD_STDERR transcript text raw pcm";
    const app = await appWithSpeech(speechService({ transcribe: () => Promise.reject(new SpeechProcessError("inference_failed", canary)) }));
    const payload = validPcm();
    try {
      const response = await app.inject({ method: "POST", url: "/api/speech/transcribe", headers: { "content-type": "application/octet-stream", "content-length": String(payload.byteLength) }, payload });
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: { kind: "speech_failed", message: "Speech processing failed.", retryable: true } });
      expect(response.body).not.toContain(canary);
    } finally {
      await close(app);
    }
  });

  it("closes the injected speech service exactly once with the app", async () => {
    const closeSpeech = vi.fn(() => Promise.resolve());
    const app = await appWithSpeech(speechService({ close: closeSpeech }));
    await close(app);
    await close(app);
    expect(closeSpeech).toHaveBeenCalledOnce();
  });
});
