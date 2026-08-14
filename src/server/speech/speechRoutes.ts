import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SPEECH_POLICY, type SpeechRuntimePolicy } from "../../shared/speechPolicy.js";
import { parseSpeechTranscriptionResponse, parseSpeechTurnDecisionResponse, type SpeechErrorKind, type SpeechErrorResponse, type SpeechServiceStatusResponse } from "../../shared/speechContracts.js";
import { SpeechAudioValidationError, type SpeechPcmOperation } from "./speechAudio.js";
import { SpeechProcessError } from "./speechProcess.js";
import { createSpeechService, speechServiceUnavailable, type SpeechService } from "./speechService.js";

const speechPaths = new Set(["/api/speech/check-turn", "/api/speech/transcribe"]);

export interface SpeechRouteOptions {
  readonly policy?: SpeechRuntimePolicy;
  readonly speechAllowedHosts?: readonly string[];
}

export function createUnavailableSpeechService(): SpeechService {
  return createSpeechService({
    smartTurn: speechServiceUnavailable("runtime_not_configured"),
    whisper: speechServiceUnavailable("runtime_not_configured"),
  });
}

export function registerSpeechRoutes(app: FastifyInstance, service: SpeechService, options: SpeechRouteOptions = {}): void {
  const policy = options.policy ?? SPEECH_POLICY;
  const admission = new SpeechBodyAdmission(policy);
  const endpointBudget = new TokenBudget(policy.admission.globalEndpointChecksPerWindow, policy.admission.globalWindowMs);
  const transcriptionBudget = new TokenBudget(policy.admission.globalTranscriptionsPerWindow, policy.admission.globalWindowMs);
  const browserAllowedHosts = canonicalHostSet(options.speechAllowedHosts ?? []);

  registerSpeechBodyParser(app);

  app.addHook("onClose", async () => {
    await service.close();
  });

  app.get("/api/speech/status", async (_request, reply) => {
    return sendNoStore(reply, statusResponse(service, policy));
  });

  app.post<{ Body: Buffer }>("/api/speech/check-turn", {
    bodyLimit: policy.audio.endpointWindowBytes,
    errorHandler: speechParserErrorHandler(policy, "endpoint"),
    onRequest: [speechRequestGuard(policy, admission, endpointBudget, "endpoint", browserAllowedHosts)],
  }, async (request, reply) => handlePcmOperation(request, reply, async (signal) => parseSpeechTurnDecisionResponse(await service.checkTurn(request.body, { signal }))));

  app.post<{ Body: Buffer }>("/api/speech/transcribe", {
    bodyLimit: policy.audio.maxTurnBytes,
    errorHandler: speechParserErrorHandler(policy, "transcription"),
    onRequest: [speechRequestGuard(policy, admission, transcriptionBudget, "transcription", browserAllowedHosts)],
  }, async (request, reply) => handlePcmOperation(request, reply, async (signal) => parseSpeechTranscriptionResponse(await service.transcribe(request.body, { signal }))));
}

function registerSpeechBodyParser(app: FastifyInstance): void {
  if (app.hasContentTypeParser("application/octet-stream")) return;
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => { done(null, body); });
}

function statusResponse(service: SpeechService, policy: SpeechRuntimePolicy): SpeechServiceStatusResponse {
  return {
    ...service.status(),
    limits: {
      sampleRateHz: 16_000,
      maxTurnSeconds: policy.audio.maxTurnSeconds,
      maxTurnBytes: policy.audio.maxTurnBytes,
      endpointWindowSeconds: policy.audio.endpointWindowSeconds,
      endpointWindowBytes: policy.audio.endpointWindowBytes,
    },
  };
}

function speechRequestGuard(policy: SpeechRuntimePolicy, admission: SpeechBodyAdmission, budget: TokenBudget, operation: SpeechPcmOperation, browserAllowedHosts: ReadonlySet<string>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!speechPaths.has(request.url.split("?")[0] ?? request.url)) return;
    if (!isBrowserOriginAllowed(request, browserAllowedHosts)) {
      await sendPreParseSpeechError(request, reply, 403, "forbidden", "Speech request origin is not allowed.", false);
      return;
    }
    if (!isOctetStream(request.headers["content-type"])) {
      await sendPreParseSpeechError(request, reply, 415, "unsupported_media_type", "Speech audio must use application/octet-stream.", false);
      return;
    }
    if (!isIdentityEncoding(request.headers["content-encoding"])) {
      await sendPreParseSpeechError(request, reply, 415, "unsupported_encoding", "Speech audio content encoding is not supported.", false);
      return;
    }
    const declaredLength = declaredContentLength(request.headers["content-length"]);
    if (declaredLength === undefined) {
      await sendPreParseSpeechError(request, reply, 411, "bad_request", "Speech audio requires a valid Content-Length header.", false);
      return;
    }
    const limit = operation === "endpoint" ? policy.audio.endpointWindowBytes : policy.audio.maxTurnBytes;
    if (declaredLength > limit) {
      await sendPreParseSpeechError(request, reply, 413, "too_large", "Speech audio exceeds the operation byte limit.", false, limit);
      return;
    }
    if (declaredLength < policy.audio.minRequestBytes) {
      await sendPreParseSpeechError(request, reply, 400, "too_short", "Speech audio is shorter than the minimum request duration.", false, policy.audio.minRequestBytes);
      return;
    }
    const admissionRelease = admission.admit(declaredLength);
    if (admissionRelease === undefined) {
      await sendPreParseSpeechError(request, reply, 429, "overloaded", "Speech audio admission is full.", true, policy.admission.maxConcurrentParsingBytes);
      return;
    }
    if (!budget.take()) {
      admissionRelease();
      await sendPreParseSpeechError(request, reply, 429, "overloaded", "Speech request budget is exhausted.", true);
      return;
    }
    let released = false;
    let bodyUploadComplete = false;
    const release = (): void => {
      if (released) return;
      released = true;
      clearTimeout(bodyUploadTimer);
      admissionRelease();
    };
    const bodyUploadTimer = setTimeout(() => {
      if (bodyUploadComplete || released) return;
      release();
      request.raw.destroy(new Error("Speech audio body upload deadline exceeded."));
    }, policy.timing.bodyUploadDeadlineMs);
    request.raw.once("end", () => {
      bodyUploadComplete = true;
      clearTimeout(bodyUploadTimer);
    });
    reply.raw.once("finish", release);
    reply.raw.once("close", release);
    request.raw.once("aborted", release);
  };
}

function speechParserErrorHandler(policy: SpeechRuntimePolicy, operation: SpeechPcmOperation) {
  return (error: FastifyError, request: FastifyRequest, reply: FastifyReply): void => {
    if (error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      const limit = operation === "endpoint" ? policy.audio.endpointWindowBytes : policy.audio.maxTurnBytes;
      sendPreParseSpeechError(request, reply, 413, "too_large", "Speech audio exceeds the operation byte limit.", false, limit);
      return;
    }
    if (error.code === "FST_ERR_CTP_INVALID_CONTENT_LENGTH") {
      sendPreParseSpeechError(request, reply, 400, "bad_request", "Speech audio body size did not match Content-Length.", false);
      return;
    }
    reply.send(error);
  };
}

async function handlePcmOperation(
  request: FastifyRequest<{ Body: Buffer }>,
  reply: FastifyReply,
  run: (signal: AbortSignal) => Promise<unknown>,
): Promise<unknown> {
  try {
    const body = request.body;
    if (!(body instanceof Uint8Array)) {
      return await Promise.resolve(sendSpeechError(reply, 400, "bad_request", "Speech audio body is invalid.", false));
    }
    const abort = requestAbortSignal(request, reply);
    try {
      const response = await run(abort.signal);
      return await Promise.resolve(sendNoStore(reply, response));
    } finally {
      abort.cleanup();
    }
  } catch (error) {
    return await sendMappedSpeechError(reply, error);
  }
}

function requestAbortSignal(request: FastifyRequest, reply: FastifyReply): { signal: AbortSignal; cleanup(): void } {
  const controller = new AbortController();
  const abort = (): void => { controller.abort(); };
  let replyFinished = false;
  const finish = (): void => { replyFinished = true; };
  const close = (): void => {
    if (!replyFinished && !reply.raw.writableEnded) abort();
  };
  request.raw.once("aborted", abort);
  reply.raw.once("finish", finish);
  reply.raw.once("close", close);
  return {
    signal: controller.signal,
    cleanup: () => {
      request.raw.off("aborted", abort);
      reply.raw.off("finish", finish);
      reply.raw.off("close", close);
    },
  };
}

function isBrowserOriginAllowed(request: FastifyRequest, allowedHosts: ReadonlySet<string>): boolean {
  if (!isBrowserClassifiedRequest(request)) return true;
  const secFetchSite = headerValue(request.headers["sec-fetch-site"]);
  if (secFetchSite !== undefined && secFetchSite !== "same-origin" && secFetchSite !== "none") return false;
  const origin = headerValue(request.headers.origin);
  const host = headerValue(request.headers.host);
  if (origin === undefined || host === undefined) return false;
  const originHost = canonicalOriginHost(origin);
  const requestHost = originHost === undefined ? undefined : canonicalHost(host, originHost.protocol);
  return originHost !== undefined && requestHost !== undefined && originHost.host === requestHost && allowedHosts.has(requestHost);
}

function isBrowserClassifiedRequest(request: FastifyRequest): boolean {
  if (headerValue(request.headers.origin) !== undefined) return true;
  return Object.keys(request.headers).some((key) => key.toLowerCase().startsWith("sec-fetch-"));
}

function isOctetStream(value: string | string[] | undefined): boolean {
  const contentType = headerValue(value);
  if (contentType === undefined) return false;
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/octet-stream";
}

function isIdentityEncoding(value: string | string[] | undefined): boolean {
  const encoding = headerValue(value);
  return encoding === undefined || encoding.trim() === "" || encoding.toLowerCase() === "identity";
}

function declaredContentLength(value: string | string[] | undefined): number | undefined {
  const header = headerValue(value);
  if (header === undefined || !/^\d+$/u.test(header)) return undefined;
  const length = Number(header);
  return Number.isSafeInteger(length) ? length : undefined;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function canonicalOriginHost(origin: string): { host: string; protocol: "http:" | "https:" } | undefined {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return { host: url.host.toLowerCase(), protocol: url.protocol };
  } catch {
    return undefined;
  }
}

function canonicalHost(host: string, protocol: "http:" | "https:" = "http:"): string | undefined {
  const trimmed = host.trim();
  if (trimmed === "") return undefined;
  try {
    return new URL(`${protocol}//${trimmed}`).host.toLowerCase();
  } catch {
    return undefined;
  }
}

function canonicalAllowedHost(host: string): string | undefined {
  const trimmed = host.trim();
  if (trimmed === "") return undefined;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.host.toLowerCase();
  } catch {
    return undefined;
  }
}

function canonicalHostSet(hosts: readonly string[]): ReadonlySet<string> {
  const canonicalHosts = hosts.map(canonicalAllowedHost).filter((host): host is string => host !== undefined);
  return new Set(canonicalHosts);
}

async function sendMappedSpeechError(reply: FastifyReply, error: unknown): Promise<FastifyReply> {
  if (error instanceof SpeechAudioValidationError) {
    if (error.kind === "too_large") return sendSpeechError(reply, 413, "too_large", "Speech audio exceeds the operation byte limit.", false);
    if (error.kind === "too_short") return sendSpeechError(reply, 400, "too_short", "Speech audio is shorter than the minimum request duration.", false);
    return sendSpeechError(reply, 400, "invalid_pcm", "Speech audio is invalid.", false);
  }
  if (error instanceof SpeechProcessError) {
    switch (error.kind) {
      case "unavailable":
        return sendSpeechError(reply, 503, "speech_unavailable", "Speech is unavailable.", true);
      case "overloaded":
        return sendSpeechError(reply, 429, "overloaded", "Speech processing is busy.", true);
      case "timeout":
        return sendSpeechError(reply, 504, "timeout", "Speech processing timed out.", true);
      case "aborted":
        return sendSpeechError(reply, 499, "cancelled", "Speech request was cancelled.", true);
      case "closed":
        return sendSpeechError(reply, 503, "closed", "Speech service is closed.", true);
      case "empty":
        return sendSpeechError(reply, 422, "transcription_empty", "Speech transcription was empty.", false);
      case "too_short":
        return sendSpeechError(reply, 400, "too_short", "Speech audio is shorter than the minimum request duration.", false);
      case "protocol":
      case "startup_timeout":
      case "child_exit":
      case "inference_failed":
        return sendSpeechError(reply, 502, "speech_failed", "Speech processing failed.", true);
    }
  }
  return sendSpeechError(reply, 502, "speech_failed", "Speech processing failed.", true);
}

function sendNoStore(reply: FastifyReply, payload: unknown): FastifyReply {
  return reply.header("Cache-Control", "no-store").send(payload);
}

function sendPreParseSpeechError(request: FastifyRequest, reply: FastifyReply, statusCode: number, kind: SpeechErrorKind, message: string, retryable: boolean, limit?: number): FastifyReply {
  closeRawConnectionAfterReply(request, reply);
  return sendSpeechError(reply.header("Connection", "close"), statusCode, kind, message, retryable, limit);
}

function sendSpeechError(reply: FastifyReply, statusCode: number, kind: SpeechErrorKind, message: string, retryable: boolean, limit?: number): FastifyReply {
  const payload: SpeechErrorResponse = { error: { kind, message, retryable, ...(limit === undefined ? {} : { limit }) } };
  return reply.code(statusCode).header("Cache-Control", "no-store").send(payload);
}

function closeRawConnectionAfterReply(request: FastifyRequest, reply: FastifyReply): void {
  const socket = request.raw.socket;
  const closeSocket = (): void => {
    if (!socket.destroyed) socket.destroy();
  };
  reply.raw.once("finish", closeSocket);
  reply.raw.once("close", () => {
    reply.raw.off("finish", closeSocket);
  });
}

class SpeechBodyAdmission {
  private activeBytes = 0;

  public constructor(private readonly policy: SpeechRuntimePolicy) {}

  public admit(bytes: number): (() => void) | undefined {
    if (this.activeBytes + bytes > this.policy.admission.maxConcurrentParsingBytes) return undefined;
    this.activeBytes += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeBytes = Math.max(0, this.activeBytes - bytes);
    };
  }
}

class TokenBudget {
  private windowStartedAt = 0;
  private used = 0;

  public constructor(private readonly limit: number, private readonly windowMs: number) {}

  public take(): boolean {
    const now = Date.now();
    if (now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}
