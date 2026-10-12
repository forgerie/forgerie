import type { PromptRequestOptions } from "@shared/promptRequest";

type PromptTransport = (path: string, init: RequestInit) => Promise<Response>;

/** Allocate once per send. The serialized body and ID survive its transport retry. */
export function promptDelivery(body: Record<string, unknown>): RequestInit {
  // getRandomValues also works on the plain HTTP server, unlike randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const identity: PromptRequestOptions = { requestId: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...identity }) };
}

/** Retry only idempotent prompt endpoints, once. Other mutations keep their existing policy. */
export async function deliverPrompt(transport: PromptTransport, path: string, init: RequestInit): Promise<Response> {
  try {
    const response = await transport(path, init);
    if (![408, 429, 502, 503, 504].includes(response.status) || init.signal?.aborted) return response;
    await response.body?.cancel();
  } catch (error) {
    if (init.signal?.aborted) throw error;
  }
  return transport(path, init);
}
