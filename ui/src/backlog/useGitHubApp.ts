import { useCallback, useEffect, useRef, useState } from "react";
import type { GitHubApi, GitHubAppState, GitHubSetup } from "./githubApi";

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

export type GitHubAppLoad = { type: "loading" } | { type: "ready"; value: GitHubAppState } | { type: "failed"; message: string };
/** How the page leaves for GitHub and learns what came back. Injected so tests stay on the page. */
export interface GitHubAppPage {
  origin: string;
  /** The `code` and `state` GitHub added to this page's address, if it just returned from Create. */
  setupReturn: () => { code: string; state: string } | undefined;
  /** Removes `code` and `state` from the address, so a reload does not reuse a spent code. */
  clearSetupReturn: () => void;
  submit: (setup: GitHubSetup) => void;
}

/**
 * Binding: this machine's GitHub App. Read once on open. When GitHub has just sent the person back
 * from creating the app, it finishes the setup first, then tells the list to read GitHub again.
 */
export function useGitHubApp(api: Pick<GitHubApi, "status" | "setup" | "created" | "remove"> | undefined, page: GitHubAppPage, onChanged: () => void) {
  const [load, setLoad] = useState<GitHubAppLoad>({ type: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    const returned = pageRef.current.setupReturn();
    if (returned) {
      // A code works once, so it leaves the address before it is spent.
      pageRef.current.clearSetupReturn();
      setBusy(true);
      api.created(returned.code, returned.state).then((value) => {
        if (controller.signal.aborted) return;
        setLoad({ type: "ready", value }); changed.current();
      }, (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(messageOf(reason));
        api.status(controller.signal).then((value) => { if (!controller.signal.aborted) setLoad({ type: "ready", value }); },
          (failure: unknown) => { if (!controller.signal.aborted) setLoad({ type: "failed", message: messageOf(failure) }); });
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    } else {
      api.status(controller.signal).then((value) => { if (!controller.signal.aborted) setLoad({ type: "ready", value }); },
        (reason: unknown) => { if (!controller.signal.aborted) setLoad({ type: "failed", message: messageOf(reason) }); });
    }
    return () => controller.abort();
  }, [api]);
  return {
    load, busy, error,
    /** Leaves for GitHub. Nothing comes back to this call: GitHub returns to the page instead. */
    setUp: useCallback(() => {
      if (!api) return;
      setBusy(true); setError(undefined);
      api.setup(pageRef.current.origin).then((setup) => pageRef.current.submit(setup),
        (reason: unknown) => { setError(messageOf(reason)); setBusy(false); });
    }, [api]),
    remove: useCallback(() => {
      if (!api) return;
      setBusy(true); setError(undefined);
      api.remove().then((value) => { setLoad({ type: "ready", value }); changed.current(); }, (reason: unknown) => setError(messageOf(reason)))
        .finally(() => setBusy(false));
    }, [api]),
  };
}
