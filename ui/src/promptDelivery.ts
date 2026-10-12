import { PI_WEB_CAPABILITIES, supportsPiWebCapability } from "@shared/capabilities";
import { parsePiWebRuntimeComponent } from "@shared/piWebStatusParsing";
import type { PromptRequestOptions } from "@shared/promptRequest";

type PromptTransport = (path: string, init: RequestInit) => Promise<Response>;

/** Allocate once per send. The serialized body and ID survive its transport retry. */
export function promptDelivery(body: Record<string, unknown>): RequestInit {
  // getRandomValues also works on the plain HTTP server, unlike randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const identity: PromptRequestOptions = { requestId: [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, ...identity }) };
}

/** An old daemon may ignore requestId, so a failed send alone never authorizes a retry. */
async function daemonSupportsRequestIds(transport: PromptTransport, signal?: AbortSignal | null): Promise<boolean> {
  try {
    const response = await transport("/api/sessiond/runtime", { cache: "no-store", signal: AbortSignal.any([
      ...(signal ? [signal] : []), AbortSignal.timeout(2000),
    ]) });
    if (!response.ok) return false;
    const runtime = parsePiWebRuntimeComponent(await response.json());
    return runtime?.component === "sessiond" && runtime.available && supportsPiWebCapability(runtime, PI_WEB_CAPABILITIES.promptRequestIds);
  } catch {
    // Unknown support fails closed. The caller retains the original send failure.
    return false;
  }
}

function retryDelay(signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 150);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Retry an advertised idempotent prompt endpoint once, after a bounded delay. */
export async function deliverPrompt(transport: PromptTransport, path: string, init: RequestInit): Promise<Response> {
  let failure: { type: "response"; response: Response } | { type: "error"; error: unknown };
  try {
    const response = await transport(path, init);
    if (![408, 429, 502, 503, 504].includes(response.status) || init.signal?.aborted) return response;
    failure = { type: "response", response };
  } catch (error) {
    if (init.signal?.aborted) throw error;
    failure = { type: "error", error };
  }
  if (!await daemonSupportsRequestIds(transport, init.signal)) {
    if (failure.type === "response") return failure.response;
    throw failure.error;
  }
  if (failure.type === "response") await failure.response.body?.cancel();
  await retryDelay(init.signal);
  return transport(path, init);
}
