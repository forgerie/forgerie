import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubApi, GitHubAuthState } from "./githubApi";

/** How often the page asks Forgerie whether the code was approved. Forgerie itself asks GitHub. */
export const PENDING_POLL_MS = 3000;
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export type GitHubAuthLoad = { type: "loading" } | { type: "ready"; value: GitHubAuthState } | { type: "failed"; message: string };

/**
 * Binding: this machine's GitHub login, as Forgerie reports it. Read once on open, and every few
 * seconds only while a login code waits for approval. `onConnected` runs when a login completes,
 * so the list can read GitHub again.
 */
export function useGitHubAuth(api: Pick<GitHubApi, "status" | "login" | "disconnect"> | undefined, onConnected: () => void) {
  const [load, setLoad] = useState<GitHubAuthLoad>({ type: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const connected = useRef(onConnected);
  connected.current = onConnected;
  const read = useCallback((signal?: AbortSignal) => {
    if (!api) return;
    api.status(signal).then((value) => { if (!signal?.aborted) setLoad((previous) => {
      if (previous.type === "ready" && previous.value.state === "pending" && value.state === "connected") connected.current();
      return { type: "ready", value };
    }); }, (reason: unknown) => { if (!signal?.aborted) setLoad({ type: "failed", message: messageOf(reason) }); });
  }, [api]);
  useEffect(() => {
    const controller = new AbortController();
    read(controller.signal);
    return () => controller.abort();
  }, [read]);
  const pending = load.type === "ready" && load.value.state === "pending";
  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const timer = setInterval(() => read(controller.signal), PENDING_POLL_MS);
    return () => { clearInterval(timer); controller.abort(); };
  }, [pending, read]);
  const act = useCallback(async (run: () => Promise<GitHubAuthState>) => {
    setBusy(true); setError(undefined);
    try { setLoad({ type: "ready", value: await run() }); } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }, []);
  return {
    load, busy, error,
    connect: useCallback(() => { if (api) void act(() => api.login()); }, [api, act]),
    /** Also cancels a code that is waiting. */
    disconnect: useCallback(() => { if (api) void act(() => api.disconnect()); }, [api, act]),
  };
}
