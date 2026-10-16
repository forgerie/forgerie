import type { PullLink, PullSessionRef } from "../../shared/pullRequests.js";
import type { PullSessionGateway, PullSessionState } from "./pullRequestService.js";

export const WATCH_POLL_MS = 60_000;
const UNREADABLE_MS = 15 * 60_000;
export function watchReadExpired(lastReadAt: string, now: number): boolean { return now - Date.parse(lastReadAt) >= UNREADABLE_MS; }

interface WatchRecord { revision: number; session: PullSessionRef; watch: PullLink["watch"]; pending?: { id: string; text: string }; startLeaf?: string | null }
interface WatchStore<R, K> {
  get(key: K): R | undefined;
  update(key: K, revision: number, change: (record: R) => R): Promise<R | undefined>;
}
export function watchStopReason(session: PullSessionState, startLeaf: string | null | undefined): string | undefined {
  if (!session.available) return "Session is archived, missing, or read-only.";
  if (session.settled && session.leaf !== startLeaf) return "Session needs a response from the user.";
  return undefined;
}

/** Stop wins over in-flight reads. Retry only local compare-and-writes. */
export async function stopWatch<R extends WatchRecord, K>(store: WatchStore<R, K>, key: K, reason: string, at: () => string, publish: (record: R) => void): Promise<R | undefined> {
  for (;;) {
    const current = store.get(key);
    if (current === undefined || (current.watch.kind !== "watching" && current.pending === undefined)) return current;
    const stopped = await store.update(key, current.revision, record => {
      delete record.pending;
      return { ...record, watch: { kind: "stopped", reason, at: at() } };
    });
    if (stopped !== undefined) { publish(stopped); return stopped; }
  }
}

/** Acknowledge durable news only after the gateway confirms transcript delivery. */
export async function deliverWatch<R extends WatchRecord, K>(store: WatchStore<R, K>, key: K, record: R, sessions: PullSessionGateway, disposed: () => boolean, publish: (record: R) => void, acknowledge: (record: R) => R = record => record): Promise<void> {
  const current = () => !disposed() && store.get(key)?.revision === record.revision;
  if (record.pending === undefined || !current()) return;
  const result = await sessions.wake(record.session, record.pending, current);
  if (result === "busy" || disposed()) return;
  const next = await store.update(key, record.revision, value => { delete value.pending; return acknowledge(value); });
  if (next !== undefined) publish(next);
}
