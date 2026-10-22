import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPEECH_POLICY } from "../../shared/speechPolicy.js";
import { createOpenAiTranscriptionBackend } from "./openAiTranscriptionBackend.js";
import { validateSpeechPcm, type ValidatedSpeechPcm } from "./speechAudio.js";
import type { SpeechBackend } from "./speechService.js";
import { SPEECH_TO_TEXT_OFF, type SpeechToTextSettings } from "./speechToTextSettings.js";

interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
  readonly form: FormData | undefined;
}

type Handler = (request: ReceivedRequest, response: ServerResponse) => void;

/** An in-process speech service that records what Forgerie sent. */
interface SpeechServer {
  readonly baseUrl: string;
  readonly requests: ReceivedRequest[];
  handle(handler: Handler): void;
}

const servers: Server[] = [];
const backends: SpeechBackend[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(backends.splice(0).map((backend) => backend.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => { resolve(); });
  })));
});

async function startSpeechServer(): Promise<SpeechServer> {
  const requests: ReceivedRequest[] = [];
  let handler: Handler = (_request, response) => { json(response, 200, { text: " spoken words " }); };
  const server = createServer((incoming, response) => {
    void readRequest(incoming).then((request) => {
      requests.push(request);
      handler(request, response);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  return { baseUrl: `http://127.0.0.1:${String(portOf(server))}/v1`, requests, handle: (next) => { handler = next; } };
}

async function readRequest(incoming: IncomingMessage): Promise<ReceivedRequest> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of incoming) if (chunk instanceof Uint8Array) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const contentType = incoming.headers["content-type"] ?? "";
  const form = contentType.startsWith("multipart/form-data")
    ? await new Response(body, { headers: { "content-type": contentType } }).formData()
    : undefined;
  return { method: incoming.method ?? "", path: incoming.url ?? "", authorization: incoming.headers.authorization, form };
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The test server has no TCP port.");
  return address.port;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function backendFor(settings: Partial<SpeechToTextSettings>, apiKey?: string, timeouts: { status?: number; transcription?: number } = {}): SpeechBackend {
  const backend = createOpenAiTranscriptionBackend({
    settings: () => ({ ...SPEECH_TO_TEXT_OFF, ...settings }),
    apiKey: () => apiKey,
    ...(timeouts.status === undefined ? {} : { statusTimeoutMs: timeouts.status }),
    ...(timeouts.transcription === undefined ? {} : { transcriptionTimeoutMs: timeouts.transcription }),
  });
  backends.push(backend);
  return backend;
}

function speech(samples: readonly number[] = [0.5, -0.5, 1, -1]): ValidatedSpeechPcm {
  const padded = new Array<number>(SPEECH_POLICY.audio.minRequestSamples).fill(0);
  samples.forEach((sample, index) => { padded[index] = sample; });
  const bytes = new Uint8Array(padded.length * 4);
  const view = new DataView(bytes.buffer);
  padded.forEach((sample, index) => { view.setFloat32(index * 4, sample, true); });
  return validateSpeechPcm(bytes);
}

async function unusedAddress(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const port = portOf(server);
  await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  return `http://127.0.0.1:${String(port)}/v1`;
}

describe("OpenAI-compatible transcription backend", () => {
  it("posts a 16-bit mono WAV with the model and language to /audio/transcriptions and returns trimmed text", async () => {
    const service = await startSpeechServer();
    const pcm = speech();

    await expect(backendFor({ baseUrl: service.baseUrl, model: "large-v3", language: "en" }).transcribe(pcm)).resolves.toEqual({ text: "spoken words" });

    const [request] = service.requests;
    expect(request).toMatchObject({ method: "POST", path: "/v1/audio/transcriptions", authorization: undefined });
    expect(request?.form?.get("model")).toBe("large-v3");
    expect(request?.form?.get("language")).toBe("en");
    expect(request?.form?.get("response_format")).toBe("json");
    const file = request?.form?.get("file");
    if (!(file instanceof File)) throw new Error("The request had no file part.");
    const wav = Buffer.from(await file.arrayBuffer());
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
    expect(wav.byteLength).toBe(44 + pcm.samples.length * 2);
    expect([wav.readInt16LE(44), wav.readInt16LE(46), wav.readInt16LE(48), wav.readInt16LE(50)]).toEqual([16_384, -16_383, 32_767, -32_767]);
  });

  it("keeps a full-length turn under the 32 MiB upload limit that OpenAI-compatible services use", () => {
    expect(44 + SPEECH_POLICY.audio.maxTurnSamples * 2).toBeLessThan(32 * 1024 * 1024);
  });

  it("omits language when the service should detect it", async () => {
    const service = await startSpeechServer();
    await backendFor({ baseUrl: service.baseUrl, language: undefined }).transcribe(speech());
    expect(service.requests[0]?.form?.has("language")).toBe(false);
  });

  it("sends the configured key as a Bearer token and never the process's OPENAI_API_KEY", async () => {
    const service = await startSpeechServer();
    vi.stubEnv("OPENAI_API_KEY", "sk-from-environment");
    vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:1/v1");

    await backendFor({ baseUrl: service.baseUrl }).transcribe(speech());
    await backendFor({ baseUrl: service.baseUrl }, "speech-key").transcribe(speech());

    expect(service.requests.map((request) => request.authorization)).toEqual([undefined, "Bearer speech-key"]);
  });

  it("reports ready when the service lists models or has no model list, and unavailable otherwise", async () => {
    const service = await startSpeechServer();
    const backend = backendFor({ baseUrl: service.baseUrl });

    service.handle((_request, response) => { json(response, 200, { object: "list", data: [] }); });
    await expect(backend.status()).resolves.toBe("ready");
    expect(service.requests[0]).toMatchObject({ method: "GET", path: "/v1/models" });

    service.handle((_request, response) => { json(response, 404, { error: { message: "Not found" } }); });
    await expect(backend.status()).resolves.toBe("ready");

    service.handle((_request, response) => { json(response, 401, { error: { message: "Bad key" } }); });
    await expect(backend.status()).resolves.toBe("unavailable");

    service.handle((_request, response) => { json(response, 503, { error: { message: "Warming" } }); });
    await expect(backend.status()).resolves.toBe("unavailable");
  });

  it("reports unavailable without a request when the plugin is off or has no address", async () => {
    await expect(backendFor({ baseUrl: undefined }).status()).resolves.toBe("unavailable");
    await expect(backendFor({ baseUrl: undefined }).transcribe(speech())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("reports unavailable when the service does not answer", async () => {
    const baseUrl = await unusedAddress();
    const backend = backendFor({ baseUrl });

    await expect(backend.status()).resolves.toBe("unavailable");
    await expect(backend.transcribe(speech())).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("reports unavailable when a status check hangs past its timeout", async () => {
    const service = await startSpeechServer();
    service.handle(() => { /* never answers */ });
    await expect(backendFor({ baseUrl: service.baseUrl }, undefined, { status: 50 }).status()).resolves.toBe("unavailable");
  });

  it("times out a transcription that runs past the operation budget", async () => {
    const service = await startSpeechServer();
    service.handle(() => { /* never answers */ });
    await expect(backendFor({ baseUrl: service.baseUrl }).transcribe(speech(), { timeoutMs: 50 })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("cancels the HTTP request when the caller aborts, and when the backend closes", async () => {
    const service = await startSpeechServer();
    service.handle(() => { /* never answers */ });
    const backend = backendFor({ baseUrl: service.baseUrl });

    const caller = new AbortController();
    const cancelled = backend.transcribe(speech(), { signal: caller.signal });
    await vi.waitFor(() => { expect(service.requests).toHaveLength(1); });
    caller.abort();
    await expect(cancelled).rejects.toMatchObject({ kind: "aborted" });

    const closing = backend.transcribe(speech());
    await vi.waitFor(() => { expect(service.requests).toHaveLength(2); });
    await backend.close();
    await expect(closing).rejects.toMatchObject({ kind: "closed" });
    await expect(backend.transcribe(speech())).rejects.toMatchObject({ kind: "closed" });
  });

  it.each([
    [429, "overloaded"],
    [500, "failed"],
    [401, "failed"],
  ] as const)("maps HTTP %i to %s", async (status, kind) => {
    const service = await startSpeechServer();
    service.handle((_request, response) => { json(response, status, { error: { message: "no" } }); });
    await expect(backendFor({ baseUrl: service.baseUrl }).transcribe(speech())).rejects.toMatchObject({ kind });
  });

  it("rejects empty text", async () => {
    const service = await startSpeechServer();
    service.handle((_request, response) => { json(response, 200, { text: "  " }); });
    await expect(backendFor({ baseUrl: service.baseUrl }).transcribe(speech())).rejects.toMatchObject({ kind: "empty" });
  });
});
