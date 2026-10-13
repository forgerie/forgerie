// The browser's copy of one session's decision log, and the overturn action.
// Routes: GET /api/sessions/:id/decisions?cwd= and POST /api/sessions/:id/decisions/:did/overturn { cwd, note }.
// A change fires the session's `workflow_runs_changed` event; the binding calls refresh() on it.
import { z } from "zod";
import { decisionSchema, decisionsSchema, sortDecisions, type Decision, type DecisionLogView } from "./decisionsModel";

export type Request = (path: string, init: RequestInit) => Promise<Response>;
export interface SessionRef { id: string; cwd: string }
export type DecisionsState = DecisionLogView;

const errorSchema = z.object({ error: z.string() });

/** Reads and overturns a session's decisions. Refresh is debounced, so a burst of change events costs one read. */
export function createDecisionsStore(request: Request, ref: () => SessionRef | undefined, refreshDelayMs = 150) {
  let state: DecisionsState = {};
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const update = (next: DecisionsState) => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const base = (session: SessionRef) => `/api/sessions/${encodeURIComponent(session.id)}/decisions`;
  async function call<T>(path: string, schema: z.ZodType<T>, body?: Record<string, unknown>): Promise<T> {
    const response = await request(path, { cache: "no-store", signal: AbortSignal.timeout(15_000),
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw new Error(parsed.success ? parsed.data.error : `HTTP ${String(response.status)}`);
    }
    return schema.parse(await response.json());
  }
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);

  // Reads can answer out of order. Each read takes the next number, and only the newest read's answer counts.
  // An overturn the server accepted retires every read that started before it, since those reads predate it.
  let generation = 0;
  async function read() {
    const session = ref();
    if (!session) return;
    const mine = ++generation;
    try {
      const decisions = sortDecisions(await call(`${base(session)}?${new URLSearchParams({ cwd: session.cwd })}`, decisionsSchema));
      if (mine === generation) update({ ...state, decisions, readError: undefined });
    }
    // Keep what was read before: the list stays while the read is retried.
    catch (error) { if (mine === generation) update({ ...state, readError: message(error) }); }
  }
  const replace = (decision: Decision) => sortDecisions((state.decisions ?? []).some((candidate) => candidate.id === decision.id)
    ? (state.decisions ?? []).map((candidate) => candidate.id === decision.id ? decision : candidate) : [decision, ...state.decisions ?? []]);

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    refresh() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void read(); }, refreshDelayMs);
    },
    /** Reads again at once, such as after a failed read. */
    retry: () => read(),
    /**
     * Sends the reader's correction. Resolves true once the server took it. Any failure is the reader's to see, and
     * the log is read again, since another tab may have overturned it first.
     */
    async overturn(id: string, note: string): Promise<boolean> {
      const session = ref();
      if (!session || state.overturning !== undefined || note.trim() === "") return false;
      update({ ...state, overturning: id, error: undefined });
      try {
        const decision = await call(`${base(session)}/${encodeURIComponent(id)}/overturn`, decisionSchema, { cwd: session.cwd, note });
        generation += 1;
        update({ ...state, overturning: undefined, decisions: replace(decision) });
        return true;
      } catch (error) {
        update({ ...state, overturning: undefined, error: message(error) });
        void read();
        return false;
      }
    },
    dismissError() { if (state.error !== undefined) update({ ...state, error: undefined }); },
    dispose() { disposed = true; if (timer !== undefined) clearTimeout(timer); listeners.clear(); },
  };
}
