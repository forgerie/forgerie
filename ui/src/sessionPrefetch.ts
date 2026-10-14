import type { Row } from "./picker/board";
import type { SessionRegistry } from "./sessionRegistry";

/** Picker intent and idle share the registry's bounded queue, never a second response cache. */
export function createSessionPrefetch(registry: Pick<SessionRegistry, "prefetch" | "cancelPrefetch" | "getSnapshot">, options: {
  allowed?: () => boolean;
  idle?: (callback: () => void) => () => void;
} = {}) {
  let cancelIdle: (() => void) | undefined;
  let stopped = false;
  const allowed = options.allowed ?? (() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    return document.visibilityState === "visible" && navigator.onLine && !connection?.saveData && !["2g", "slow-2g"].includes(connection?.effectiveType ?? "");
  });
  const eligible = (row: Row) => row.state !== "archived" && !row.session.archived && !row.session.starting
    && (row.session.worktree === undefined || row.session.worktree.state.kind === "active");
  function prefetch(row: Row) {
    if (!stopped && allowed() && eligible(row)) registry.prefetch(row.session);
  }
  const schedule = options.idle ?? ((callback: () => void) => {
    if (typeof requestIdleCallback === "function") { const id = requestIdleCallback(callback); return () => cancelIdleCallback(id); }
    const id = setTimeout(callback, 100); return () => clearTimeout(id);
  });
  return {
    intent: prefetch,
    cancel: (row: Row) => registry.cancelPrefetch(row.session),
    idle: (rows: readonly Row[]) => {
      cancelIdle?.();
      if (stopped || !allowed()) return;
      const kept = registry.getSnapshot();
      if (kept.length >= 6) return;
      const rank = (row: Row) => kept.find(record => record.entry.session.id === row.session.id)?.selections ?? 0;
      const candidates = rows.filter(eligible).sort((a, b) => Number(b.state === "unread") - Number(a.state === "unread") || rank(b) - rank(a));
      let index = 0;
      const next = () => {
        cancelIdle = undefined;
        if (stopped || !allowed() || registry.getSnapshot().length >= 6) return;
        const candidate = candidates[index++];
        if (!candidate) return;
        prefetch(candidate);
        if (index < candidates.length) cancelIdle = schedule(next);
      };
      cancelIdle = schedule(next);
    },
    pause: () => { cancelIdle?.(); cancelIdle = undefined; },
    dispose: () => { stopped = true; cancelIdle?.(); cancelIdle = undefined; },
  };
}
