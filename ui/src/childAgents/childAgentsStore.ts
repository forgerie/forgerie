// The browser's view of one session's child agents. It reads
// /api/sessions/:id/children (src/server/sessions/durableChildRoutes.ts).
import { z } from "zod";
import { childSummariesSchema, childTranscriptSchema, type ChildSummary, type ChildTranscript } from "./childAgentsModel";

export type Request = (path: string, init: RequestInit) => Promise<Response>;
export interface SessionRef { id: string; cwd: string }

export interface OpenChild {
  conversationId: number;
  transcript?: ChildTranscript;
  error?: string;
}
export interface ChildAgentsState {
  /** False once the server says this session hosts no children. Unknown until the first read. */
  available: boolean | undefined;
  children: readonly ChildSummary[];
  open?: OpenChild;
  /** The last action that failed, in words for the reader. */
  error?: string;
}

const okSchema = z.object({ ok: z.literal(true) });
const errorSchema = z.object({ error: z.string() });
class HttpFailure extends Error { constructor(message: string, readonly status: number) { super(message); } }

export interface ChildAgentsTiming { refreshDelayMs?: number; pollMs?: number }

/** Reads and actions on a session's children. Refresh is debounced, so a burst of change events costs one read. */
export function createChildAgentsStore(request: Request, ref: () => SessionRef | undefined, timing: ChildAgentsTiming = {}) {
  let state: ChildAgentsState = { available: undefined, children: [] };
  const listeners = new Set<() => void>();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const update = (next: ChildAgentsState) => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener();
  };
  const path = (session: SessionRef, rest = "", query = false) =>
    `/api/sessions/${encodeURIComponent(session.id)}/children${rest}${query ? `?${new URLSearchParams({ cwd: session.cwd })}` : ""}`;
  async function call<T>(url: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const response = await request(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const body = errorSchema.safeParse(await response.json().catch(() => undefined));
      throw new HttpFailure(body.success ? body.data.error : `HTTP ${String(response.status)}`, response.status);
    }
    return schema.parse(await response.json());
  }
  const post = (session: SessionRef, rest: string, body: Record<string, string>) => call(path(session, rest), okSchema,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: session.cwd, ...body }) });

  async function readList() {
    const session = ref();
    if (!session || state.available === false) return;
    try {
      const children = await call(path(session, "", true), childSummariesSchema);
      update({ ...state, available: true, children });
    } catch (error) {
      // 404: the flag is off or the session is not a Durable one. Stop asking.
      if (error instanceof HttpFailure && error.status === 404) update({ ...state, available: false, children: [] });
    }
  }
  async function readOpen() {
    const session = ref();
    const open = state.open;
    if (!session || !open) return;
    try {
      const transcript = await call(path(session, `/${String(open.conversationId)}/messages`, true), childTranscriptSchema);
      if (state.open?.conversationId === open.conversationId) update({ ...state, open: { conversationId: open.conversationId, transcript } });
    } catch (error) {
      if (state.open?.conversationId === open.conversationId) update({ ...state, open: { ...open, error: error instanceof Error ? error.message : String(error) } });
    }
  }
  /** While an open child works, its answer streams, so read it on a short clock. */
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (disposed || !state.open) return;
    const working = state.open.transcript?.busy ?? true;
    if (!working) return;
    pollTimer = setTimeout(() => { void readOpen().then(schedulePoll); }, timing.pollMs ?? 1000);
  }
  async function act(action: () => Promise<unknown>) {
    try {
      await action();
      update({ ...state, error: undefined });
    } catch (error) {
      update({ ...state, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      refresh();
    }
  }
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { void Promise.all([readList(), readOpen()]).then(schedulePoll); }, timing.refreshDelayMs ?? 250);
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    refresh,
    open(conversationId: number) {
      if (state.open?.conversationId === conversationId) return;
      update({ ...state, open: { conversationId } });
      void readOpen().then(schedulePoll);
    },
    close() { clearTimeout(pollTimer); update({ ...state, open: undefined }); },
    dismissError() { update({ ...state, error: undefined }); },
    send: (conversationId: number, text: string) => act(async () => {
      const session = ref();
      if (session) await post(session, `/${String(conversationId)}/message`, { text });
    }),
    stop: (conversationId: number) => act(async () => {
      const session = ref();
      if (session) await post(session, `/${String(conversationId)}/stop`, {});
    }),
    answer: (questionId: string, answer: string) => act(async () => {
      const session = ref();
      if (session) await post(session, "/questions/answer", { questionId, answer });
    }),
    dispose() { disposed = true; clearTimeout(refreshTimer); clearTimeout(pollTimer); listeners.clear(); },
  };
}
export type ChildAgentsStore = ReturnType<typeof createChildAgentsStore>;
