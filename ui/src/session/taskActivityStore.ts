// The browser's view of one session's live Durable tasks. It reads
// GET /api/sessions/:id/tasks?cwd=… (src/server/sessions/durableTaskRoutes.ts).
// There is no push of its own: the binding refreshes it on panel open, on
// reconnect, and on every durable_children_changed event.
import { z } from "zod";
import { taskActivitySchema, type TaskActivity } from "./taskActivityModel";

export type Request = (path: string, init: RequestInit) => Promise<Response>;
export interface SessionRef { id: string; cwd: string }

export interface TaskActivityState {
  /** The last good read. Undefined until the first read returns. */
  activity: TaskActivity | undefined;
  /** A read is in flight. */
  reading: boolean;
  /** Why the last read failed, in words. Cleared by the next good read. */
  error: string | undefined;
  /** The list may be out of date: the connection dropped or a read failed since it was read. */
  stale: boolean;
}

export interface TaskActivityTiming { refreshDelayMs?: number }

const errorSchema = z.object({ error: z.string() });

/** Reads a session's live tasks. Refresh is debounced, so a burst of change events costs one read. */
export function createTaskActivityStore(request: Request, ref: () => SessionRef | undefined, timing: TaskActivityTiming = {}) {
  let state: TaskActivityState = { activity: undefined, reading: false, error: undefined, stale: false };
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** Only the newest read may land: an older one that returns late would put back a list the server already replaced. */
  let latest = 0;
  const update = (next: Partial<TaskActivityState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };

  async function read() {
    const session = ref();
    if (!session || disposed) return;
    const version = ++latest;
    update({ reading: true });
    try {
      const response = await request(`/api/sessions/${encodeURIComponent(session.id)}/tasks?${new URLSearchParams({ cwd: session.cwd })}`,
        { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const failure = errorSchema.safeParse(body);
        throw new Error(failure.success ? failure.data.error : `HTTP ${String(response.status)}`);
      }
      const parsed = taskActivitySchema.safeParse(body);
      // A reply this page cannot read most likely comes from a newer or older server than the page.
      if (!parsed.success) throw new Error("The server sent task data this page cannot read. Reload the page.");
      const activity = parsed.data;
      if (version === latest) update({ activity, reading: false, error: undefined, stale: false });
    } catch (error) {
      // The last good list stays, marked stale, so a failed read never empties the panel.
      if (version === latest) update({ reading: false, error: error instanceof Error ? error.message : String(error), stale: state.activity !== undefined });
    }
  }

  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(() => { void read(); }, timing.refreshDelayMs ?? 250);
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    refresh,
    /** Try again now, for the reader's own press. */
    retry() { clearTimeout(timer); void read(); },
    /** The connection dropped: keep the list, but say it may be out of date until the next read returns. */
    markStale() { if (state.activity !== undefined && !state.stale) update({ stale: true }); },
    dispose() { disposed = true; clearTimeout(timer); listeners.clear(); },
  };
}
