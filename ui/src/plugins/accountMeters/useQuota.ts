import { useCallback, useEffect, useState } from "react";
import { parseQuotaPayload, type QuotaPayload } from "./quotaData";

/** Reads the router's quota JSON. Injected so tests and captures can serve a fixture. */
export type QuotaRead = (endpoint: string, signal: AbortSignal) => Promise<unknown>;

export const readQuota: QuotaRead = async (endpoint, signal) => {
  let response: Response;
  // The router is on the tailnet and trusts tailnet clients, so no credentials are sent.
  try { response = await fetch(endpoint, { cache: "no-store", credentials: "omit", mode: "cors", signal }); }
  catch (error) {
    if (signal.aborted) throw error;
    // A refused CORS check and an unreachable host fail the same way, and say nothing.
    throw new Error(`Cannot reach ${new URL(endpoint).host}.`, { cause: error });
  }
  if (!response.ok) throw new Error(`The quota service answered HTTP ${String(response.status)}.`);
  return response.json();
};

export interface QuotaState {
  /** The last reading this app could parse. Kept through a failed refresh, and shown as doubtful. */
  payload: QuotaPayload | undefined;
  /** Why the last read failed, if it did. */
  error: string | undefined;
  loading: boolean;
}

/** How often the meters read the router while the app is in view. */
export const QUOTA_POLL_MS = 120_000;

/**
 * Reads the quota now, then every `pollMs` while the page is visible, and on
 * return to view when the reading is more than half a period old. A hidden tab
 * sends nothing. The reading is cleared when the address changes.
 */
export function useQuota(endpoint: string, read: QuotaRead = readQuota, pollMs = QUOTA_POLL_MS): QuotaState & { retry: () => void } {
  const [state, setState] = useState<QuotaState & { endpoint: string }>({ endpoint, payload: undefined, error: undefined, loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let controller: AbortController | undefined;
    let last = 0;
    const run = async () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      last = Date.now();
      setState((previous) => previous.endpoint === endpoint ? { ...previous, loading: true }
        : { endpoint, payload: undefined, error: undefined, loading: true });
      try {
        const payload = parseQuotaPayload(await read(endpoint, current.signal));
        if (!current.signal.aborted) setState({ endpoint, payload, error: undefined, loading: false });
      } catch (error) {
        if (current.signal.aborted) return;
        setState((previous) => ({ ...previous, error: error instanceof Error ? error.message : String(error), loading: false }));
      }
    };
    void run();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void run(); }, pollMs);
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - last > pollMs / 2) void run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [endpoint, read, pollMs, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const current = state.endpoint === endpoint ? state : { payload: undefined, error: undefined, loading: true };
  return { payload: current.payload, error: current.error, loading: current.loading, retry };
}
