// The browser's view of one session's child agents. It reads
// /api/sessions/:id/children (src/server/sessions/durableChildRoutes.ts).
import { z } from "zod";
import { actionResultSchema, discardPreviewSchema, reviewSchema, runsSchema, cleanupStateSchema, type ChildDetail, type Runs } from "./childWorkModel";
import type { WorktreeActionResult } from "../worktrees/worktreeApi";
import { newStartupToken } from "../newSession";
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
  detail?: ChildDetail;
  runs?: Runs;
  outcome?: WorktreeActionResult;
  pending?: string;
  drafts?: Readonly<Record<string, string>>;
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
  let detailVersion = 0;
  let retryRead: (() => Promise<void>) | undefined;
  let continuation: { id: number; text: string; requestId: string } | undefined;
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
      if (children.length > 0) {
        try {
          const runs = await call(`/api/sessions/children/runs?${new URLSearchParams({ session: session.id })}`, runsSchema);
          update({ ...state, runs });
        } catch { update({ ...state, runs: undefined }); } // History failures do not hide active children; opening history shows the error.
      }
    } catch (error) {
      // 404: the flag is off or the session is not a Durable one. Stop asking.
      if (error instanceof HttpFailure && error.status === 404) update({ ...state, available: false, children: [] });
      else update({ ...state, error: error instanceof Error ? error.message : String(error) });
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
    pollTimer = setTimeout(() => { void Promise.all([readList(), readOpen()]).then(schedulePoll); }, timing.pollMs ?? 1000);
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

  const requireSession = () => { const session = ref(); if (!session) throw new Error("Session is no longer open"); return session; };
  const json = (session: SessionRef, body: Record<string, string> = {}): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cwd: session.cwd, ...body }) });
  async function detail(title: string, load: (session: SessionRef) => Promise<ChildDetail>) {
    const version = ++detailVersion;
    retryRead = () => detail(title, load);
    update({ ...state, detail: { kind: "loading", title } });
    try {
      const result = await load(requireSession());
      if (version === detailVersion) update({ ...state, detail: result, ...(result.kind === "runs" ? { runs: result.data } : {}) });
    } catch (error) {
      if (version === detailVersion) update({ ...state, detail: { kind: "failed", message: error instanceof Error ? error.message : String(error) } });
    }
  }
  async function mutate(id: number, action: "land" | "discard", token?: string) {
    if (state.pending) return;
    update({ ...state, pending: action, error: undefined });
    try {
      const session = requireSession();
      const outcome = await call(path(session, `/${String(id)}/worktree/${action}`), actionResultSchema, json(session, token === undefined ? {} : { confirmationToken: token }));
      if (state.open?.conversationId === id) {
        ++detailVersion;
        update({ ...state, outcome, detail: { kind: "none" } });
      }
    } catch (error) { update({ ...state, error: error instanceof Error ? error.message : String(error) }); }
    finally { await Promise.all([readList(), readOpen()]); update({ ...state, pending: undefined }); }
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    refresh,
    open(conversationId: number) {
      if (state.open?.conversationId === conversationId) return;
      ++detailVersion;
      update({ ...state, open: { conversationId }, detail: { kind: "none" }, outcome: undefined, error: undefined });
      void readOpen().then(schedulePoll);
    },
    close() { ++detailVersion; clearTimeout(pollTimer); update({ ...state, open: undefined, detail: { kind: "none" }, outcome: undefined }); },
    updateDraft(key: string, change: (text: string) => string) { update({ ...state, drafts: { ...state.drafts, [key]: change(state.drafts?.[key] ?? "") } }); },
    retryDetail() { return retryRead?.(); },
    dismissDetail() { ++detailVersion; update({ ...state, detail: { kind: "none" } }); },
    dismissOutcome() { update({ ...state, outcome: undefined }); },
    review: (id: number) => detail("Review changes", async (session) => ({ kind: "review", data: await call(path(session, `/${String(id)}/worktree/changes`, true), reviewSchema) })),
    previewDiscard: (id: number) => detail("Review discard", async (session) => ({ kind: "discard", data: await call(path(session, `/${String(id)}/worktree/discard-preview`), discardPreviewSchema, json(session)) })),
    openRuns: () => detail("Run history", async (session) => ({ kind: "runs", data: await call(`/api/sessions/children/runs?${new URLSearchParams({ session: session.id })}`, runsSchema) })),
    openCleanup: () => detail("Worktrees", async () => ({ kind: "cleanup", data: await call("/api/sessions/worktrees/cleanup", cleanupStateSchema) })),
    land: (id: number) => mutate(id, "land"),
    discard: (id: number, token: string) => mutate(id, "discard", token),
    async continue(id: number, text: string) {
      if (state.pending) throw new Error("Wait for the current action to finish");
      const navigation = detailVersion;
      if (continuation?.id !== id || continuation.text !== text) continuation = { id, text, requestId: newStartupToken() };
      const session = requireSession();
      update({ ...state, pending: "continue", error: undefined });
      try {
        const next = await call(path(session, `/${String(id)}/continue`), z.object({ conversationId: z.number().int().positive() }), json(session, { text, requestId: continuation.requestId }));
        continuation = undefined;
        await readList();
        if (!disposed && detailVersion === navigation) {
          ++detailVersion;
          update({ ...state, open: { conversationId: next.conversationId }, detail: { kind: "none" }, outcome: undefined });
          await readOpen();
          schedulePoll();
        }
      } catch (error) { update({ ...state, error: error instanceof Error ? error.message : String(error) }); throw error; }
      finally { update({ ...state, pending: undefined }); }
    },
    dismissError() { update({ ...state, error: undefined }); },
    send: (conversationId: number, text: string) => act(async () => {
      await post(requireSession(), `/${String(conversationId)}/message`, { text });
    }),
    stop: (conversationId: number) => act(async () => {
      await post(requireSession(), `/${String(conversationId)}/stop`, {});
    }),
    answer: (questionId: string, answer: string) => act(async () => {
      await post(requireSession(), "/questions/answer", { questionId, answer });
    }),
    dispose() { disposed = true; clearTimeout(refreshTimer); clearTimeout(pollTimer); listeners.clear(); },
  };
}
