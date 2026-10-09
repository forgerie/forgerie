import type { IncomingMessage, ServerResponse } from "node:http";

/** An answer with a status the browser should see, not a 500. */
export class SettingsHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface JsonBodyLimits {
  maxBytes: number;
  /** Shown when the body is larger than `maxBytes`. */
  tooLarge: string;
  /** Refuse a body without a JSON content type. */
  requireJsonType?: boolean;
}

/** Reads a request body as JSON, refusing it once it passes the limit. */
export async function readJsonBody(request: IncomingMessage, limits: JsonBodyLimits): Promise<unknown> {
  if (limits.requireJsonType === true && request.headers["content-type"]?.startsWith("application/json") !== true) throw new SettingsHttpError(415, "Send JSON.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > limits.maxBytes) throw new SettingsHttpError(413, limits.tooLarge);
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new SettingsHttpError(400, "The request body is not JSON."); }
}

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

/** Writes must come from a page on this host, not from another site. */
export function refuseCrossSite(request: IncomingMessage, message: string): void {
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== "" && new URL(origin).host !== request.headers.host) throw new SettingsHttpError(403, message);
}

export function isErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
