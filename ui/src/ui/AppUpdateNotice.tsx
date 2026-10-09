import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchBuild, type UpdateCheck } from "../appUpdate";

/** How often an open, visible app asks whether a new build was deployed. */
export const UPDATE_POLL_MS = 60_000;

/**
 * The deployed build's entry, while it differs from the running one. Checks
 * when the app comes back into view or online, and every minute while it is
 * visible. Without a running build name (the dev server), it never checks.
 */
export function useAppUpdate(running: string | undefined, check: (running: string) => Promise<UpdateCheck> = fetchBuild): string | undefined {
  // Kept with the build it was checked against, so a different running build never inherits it.
  const [available, setAvailable] = useState<{ running: string; entry: string }>();
  useEffect(() => {
    if (running === undefined) return;
    let stopped = false;
    const run = () => {
      if (document.visibilityState !== "visible") return;
      void check(running).then((result) => {
        if (stopped) return;
        // An unknown answer (a restart, a lost network) keeps what was known.
        if (result.type === "available") setAvailable({ running, entry: result.entry });
        else if (result.type === "current") setAvailable(undefined);
      });
    };
    const timer = setInterval(run, UPDATE_POLL_MS);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
    };
  }, [running, check]);
  return available !== undefined && available.running === running ? available.entry : undefined;
}

/**
 * Tells the reader a new version is deployed and lets them choose when to
 * load it. It never reloads by itself: unsent drafts are saved in this
 * browser and survive the refresh, but the moment is the reader's.
 */
export function AppUpdateNotice({ running, check, reload = () => window.location.reload() }: {
  running: string | undefined;
  check?: (running: string) => Promise<UpdateCheck>;
  reload?: () => void;
}) {
  const available = useAppUpdate(running, check);
  const [dismissed, setDismissed] = useState<string>();
  if (available === undefined || available === dismissed) return null;
  return <div className="app-update">
    <div className="picker-toast" role="status">
      <span>A new version of Forgerie is ready.</span>
      <button type="button" className="picker-toast-undo" onClick={reload}>Refresh</button>
      <button type="button" className="picker-toast-close" aria-label="Not now" title="Not now" onClick={() => setDismissed(available)}><XIcon aria-hidden /></button>
    </div>
  </div>;
}
