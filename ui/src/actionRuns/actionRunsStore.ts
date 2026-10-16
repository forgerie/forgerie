import { runKey, sameRunLink, type ActionRun, type ActionRunApi, type ActionRunItem, type ActionRunLink, type DerivedRuns, type RunSessionRef } from "./actionRunApi";

/** What the Actions list draws. `idle`: nobody opened it yet, so nothing was read. */
export type RunsLoad =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; items: readonly ActionRunItem[]; derived: readonly DerivedRuns[] }
  | { type: "failed"; message: string };

/** The run whose jobs are open, and how its read went. Its data lives in the list's item. */
export interface RunDetailState { key: string; runId: number; load: { type: "loading" } | { type: "ready" } | { type: "failed"; message: string } }

export interface ActionRunsState {
  load: RunsLoad;
  /** The list is read again; the rows on show are the last read. */
  listing: boolean;
  /** Why the last reread failed. The rows on show stay. */
  listError: string | undefined;
  /** Run keys being read again after a change. Their rows keep the last read meanwhile. */
  reading: ReadonlySet<string>;
  /** The last write's refusal. `key` names the run it was for; a refused link has none. */
  notice: { text: string; key?: string | undefined } | undefined;
  /** A write is in flight. Writes do not overlap. */
  writing: boolean;
  detail: RunDetailState | undefined;
}

const INITIAL: ActionRunsState = { load: { type: "idle" }, listing: false, listError: undefined, reading: new Set(), notice: undefined, writing: false, detail: undefined };
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
/** What makes a link worth reading again: a new watch state or a new wake. */
const linkVersion = (link: ActionRunLink) => `${link.watch.kind}:${link.watch.kind === "watching" ? String(link.watch.wakes) : link.watch.kind === "stopped" ? link.watch.at : ""}`;
const upsert = (items: readonly ActionRunItem[], next: ActionRunItem) =>
  items.some((item) => sameRunLink(item.link, next.link)) ? items.map((item) => sameRunLink(item.link, next.link) ? next : item) : [...items, next];

/**
 * One session's linked Actions runs, kept for the pull request panel.
 *
 * It reads nothing until the panel opens (`open`), and never on a timer: the
 * server's watcher is the poller. After the first read, a catalog change
 * (`syncLinks`, fed by `session.action-run` events) rereads only the run it
 * names. After a reconnect the list route is read again (`recover`), because
 * the server does not replay missed events.
 */
export function createActionRunsStore(api: ActionRunApi) {
  let state = INITIAL;
  let ref: RunSessionRef | undefined;
  /** Every request of one session shares this; a session change aborts them all. */
  let session = new AbortController();
  let listing: AbortController | undefined;
  let seen = new Map<string, string>();
  let catalog: readonly ActionRunLink[] = [];
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ActionRunsState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const ready = () => state.load.type === "ready" ? state.load : undefined;
  const patchItems = (change: (items: readonly ActionRunItem[]) => readonly ActionRunItem[]) => {
    const load = ready();
    if (load) set({ load: { ...load, items: change(load.items) } });
  };
  const itemOf = (key: string) => ready()?.items.find((item) => runKey(item.link) === key);
  const derivedRun = (key: string): ActionRun | undefined => ready()?.derived.flatMap((group) => group.runs).find((run) => runKey(run) === key);
  const reading = (key: string, on: boolean) => {
    const next = new Set(state.reading);
    if (on) next.add(key); else next.delete(key);
    set({ reading: next });
  };

  function list() {
    const target = ref;
    if (!target) return;
    listing?.abort();
    const controller = new AbortController();
    listing = controller;
    const signal = AbortSignal.any([session.signal, controller.signal]);
    if (ready()) set({ listing: true }); else set({ load: { type: "loading" } });
    api.list(target, signal).then((result) => {
      if (signal.aborted) return;
      seen = new Map(catalog.map((link) => [runKey(link), linkVersion(link)]));
      set({ load: { type: "ready", items: result.items, derived: result.derived }, listing: false, listError: undefined });
    }, (error: unknown) => {
      if (signal.aborted) return;
      // A failed reread keeps the rows it has and says why above them.
      if (ready()) set({ listing: false, listError: messageOf(error) });
      else set({ load: { type: "failed", message: messageOf(error) }, listing: false });
    });
  }

  function readOne(link: ActionRunLink) {
    const target = ref;
    if (!target) return;
    const key = runKey(link);
    const signal = session.signal;
    reading(key, true);
    api.read(target, link.runId, signal).then(
      (result) => { if (!signal.aborted) patchItems((items) => upsert(items, { link: result.link, run: result.run })); },
      (error: unknown) => { if (!signal.aborted) patchItems((items) => upsert(items, { ...(items.find((item) => sameRunLink(item.link, link)) ?? { run: null }), link, error: messageOf(error) })); },
    ).finally(() => { if (!signal.aborted) reading(key, false); });
  }

  async function write(key: string | undefined, run: (target: RunSessionRef) => Promise<void>): Promise<boolean> {
    const target = ref;
    if (!target || state.writing) return false;
    set({ writing: true, notice: undefined });
    try { await run(target); return true; }
    catch (error) { set({ notice: { text: messageOf(error), key } }); return false; }
    finally { set({ writing: false }); }
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The session whose runs these are. A different one starts over, unread. */
    setSession(next: RunSessionRef | undefined) {
      if (next?.id === ref?.id && next?.cwd === ref?.cwd) return;
      session.abort();
      session = new AbortController();
      listing = undefined;
      ref = next;
      seen = new Map();
      state = INITIAL;
      for (const listener of listeners) listener();
    },
    /** The panel opened: read the list once. A list that failed is read again. */
    open() { if (state.load.type === "idle" || state.load.type === "failed") list(); },
    refresh: list,
    /** The connection came back. Events in between are lost, so a list that was read is read again. */
    recover() { if (state.load.type !== "idle") list(); },
    /**
     * The catalog's links for this session. A link that appeared or changed is
     * read again; a link that went away leaves the list.
     */
    syncLinks(links: readonly ActionRunLink[]) {
      catalog = links;
      if (!ready()) return;
      const now = new Map(links.map((link) => [runKey(link), linkVersion(link)]));
      const changed = links.filter((link) => seen.get(runKey(link)) !== linkVersion(link));
      const gone = [...seen.keys()].filter((key) => !now.has(key));
      seen = now;
      if (gone.length > 0) {
        patchItems((items) => items.filter((item) => !gone.includes(runKey(item.link))));
        if (state.detail && gone.includes(state.detail.key)) set({ detail: undefined });
      }
      for (const link of changed) {
        // The link itself is news: show the new watch state before GitHub answers.
        patchItems((items) => upsert(items, { ...(items.find((item) => sameRunLink(item.link, link)) ?? { run: derivedRun(runKey(link)) ?? null }), link }));
        readOne(link);
      }
    },
    /** Link a run by its ID or URL. Resolves true once the server linked it. */
    link: (run: number | string) => write(undefined, async (target) => {
      const result = await api.link(target, run);
      patchItems((items) => upsert(items, { link: result.link, run: result.run }));
    }),
    unlink: (key: string, runId: number) => write(key, async (target) => {
      const removed = await api.unlink(target, runId);
      patchItems((items) => items.filter((item) => !sameRunLink(item.link, removed)));
      if (state.detail?.key === key) set({ detail: undefined });
    }),
    /** Watch a linked or a derived run, or stop. Watching a derived run links it, so it joins the list. */
    setWatch: (key: string, runId: number, on: boolean) => write(key, async (target) => {
      const link = on ? await api.watch(target, runId) : await api.stopWatch(target, runId);
      const item = itemOf(key);
      patchItems((items) => upsert(items, item ? { ...item, link } : { link, run: derivedRun(key) ?? null }));
    }),
    /** Open one linked run's jobs. They are read fresh; the list's copy shows meanwhile. */
    openDetail(key: string, runId: number) {
      const target = ref;
      if (!target) return;
      const signal = session.signal;
      set({ detail: { key, runId, load: { type: "loading" } } });
      const settle = (load: RunDetailState["load"]) => { if (!signal.aborted && state.detail?.key === key) set({ detail: { key, runId, load } }); };
      api.read(target, runId, signal).then((result) => {
        if (signal.aborted) return;
        patchItems((items) => upsert(items, { link: result.link, run: result.run }));
        settle({ type: "ready" });
      }, (error: unknown) => settle({ type: "failed", message: messageOf(error) }));
    },
    closeDetail() { if (state.detail) set({ detail: undefined }); },
    clearNotice() { if (state.notice) set({ notice: undefined }); },
    dispose() { session.abort(); listeners.clear(); },
  };
}
