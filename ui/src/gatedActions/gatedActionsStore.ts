// The browser's copy of one session's gated actions, and the reader's two choices on each.
// Routes: GET /api/sessions/:id/gated-actions?cwd= (newest first, `[]` for a session without Durable children) and
// POST /api/sessions/:id/gated-actions/:gid/approve|refuse { cwd }, which answer the record.
// A change fires the session's `workflow_runs_changed` event; the binding calls refresh() on it.
import { z } from "zod";
import { gatedActionSchema, gatedActionsSchema, isSettled, sortGated, type GatedAction, type GatedChoice } from "./gatedActionsModel";

export type Request = (path: string, init: RequestInit) => Promise<Response>;
export interface SessionRef { id: string; cwd: string }

export interface GatedActionsState {
  /** Newest first. Undefined until the first read answers. */
  records?: readonly GatedAction[] | undefined;
  /** Why the last read failed. Cleared by the next read that answers. */
  readError?: string | undefined;
  /** The action with a choice on its way, and which choice. */
  deciding?: { id: string; choice: GatedChoice } | undefined;
  /** Why the last choice failed, for the card it was made on. */
  error?: { id: string; message: string } | undefined;
}

const errorSchema = z.object({ error: z.string() });

/** Reads and decides a session's gated actions. Refresh is debounced, so a burst of change events costs one read. */
export function createGatedActionsStore(request: Request, ref: () => SessionRef | undefined, refreshDelayMs = 150) {
  let state: GatedActionsState = {};
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const update = (next: GatedActionsState) => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const base = (session: SessionRef) => `/api/sessions/${encodeURIComponent(session.id)}/gated-actions`;
  async function call<T>(path: string, schema: z.ZodType<T>, body?: Record<string, unknown>): Promise<T> {
    // A choice waits for the server to record it, not for the call to run: the record says "approved" while it runs.
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
  // A choice the server accepted retires every read that started before it, since those reads predate it.
  let generation = 0;
  async function read() {
    const session = ref();
    if (!session) return;
    const mine = ++generation;
    try {
      const records = sortGated(await call(`${base(session)}?${new URLSearchParams({ cwd: session.cwd })}`, gatedActionsSchema));
      if (mine === generation) update({ ...state, records, readError: undefined });
    }
    // Keep what was read before: a card that was open stays open while the read is retried.
    catch (error) { if (mine === generation) update({ ...state, readError: message(error) }); }
  }
  /**
   * The records with a choice's answer in them. The answer says only that the choice was admitted ("approved" or
   * "refused"); a read can already hold the outcome by the time a slow answer lands, and a known outcome is never undone.
   */
  const admit = (record: GatedAction) => {
    const known = (state.records ?? []).find((candidate) => candidate.id === record.id);
    if (known !== undefined && isSettled(known)) return state.records;
    return sortGated(known !== undefined ? (state.records ?? []).map((candidate) => candidate.id === record.id ? record : candidate)
      : [record, ...state.records ?? []]);
  };

  /**
   * Sends one choice. Resolves true once the server recorded it. A failure stays on the action's card, and the records
   * are read again, since another tab may have decided first. After a success the records are read once more: reads
   * that were on their way are retired with the answer, and one of them may have held the outcome.
   */
  async function decide(id: string, choice: GatedChoice): Promise<boolean> {
    const session = ref();
    if (!session || state.deciding !== undefined) return false;
    update({ ...state, deciding: { id, choice }, error: undefined });
    try {
      const record = await call(`${base(session)}/${encodeURIComponent(id)}/${choice}`, gatedActionSchema, { cwd: session.cwd });
      generation += 1;
      update({ ...state, deciding: undefined, records: admit(record) });
      void read();
      return true;
    } catch (error) {
      update({ ...state, deciding: undefined, error: { id, message: message(error) } });
      void read();
      return false;
    }
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    refresh() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void read(); }, refreshDelayMs);
    },
    /** Reads again at once, such as after a failed read. */
    retry: () => read(),
    /** Approves the call: Forgerie runs it once, exactly as recorded. */
    approve: (id: string) => decide(id, "approve"),
    refuse: (id: string) => decide(id, "refuse"),
    dismissError() { if (state.error !== undefined) update({ ...state, error: undefined }); },
    dispose() { disposed = true; if (timer !== undefined) clearTimeout(timer); listeners.clear(); },
  };
}
