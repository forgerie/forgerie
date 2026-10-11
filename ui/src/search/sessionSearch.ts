import { SearchError, type SearchApi, type SearchHit, type SearchMatch } from "./searchApi";
import { queryMode, type ResultsState } from "./searchModel";

/** The hit the reader opened, and where its session's matches stand. */
export type FoundState =
  | { type: "message"; key: number; hit: SearchHit; query: string; matches: MatchesState }
  /** An off-branch hit: the history tree shows it. */
  | { type: "entry"; key: number; hit: SearchHit };
export type MatchesState =
  | { type: "loading" }
  | { type: "failed"; message: string }
  /** On-branch matches in branch order, each with its `/messages` position. `current` indexes `list`. */
  | { type: "ready"; list: readonly (SearchMatch & { position: number })[]; current: number };

export interface SessionSearchState {
  query: string;
  results: ResultsState;
  found?: FoundState | undefined;
}

export interface SearchTiming {
  /** The wait after the last keystroke before a request. */
  debounceMs?: number;
  /** How often an open query asks again while the index builds. */
  refreshMs?: number;
}
export const SEARCH_DEBOUNCE_MS = 200;
export const SEARCH_REFRESH_MS = 3000;

const EMPTY_RESULTS: ResultsState = { hits: [], loading: false, paging: "idle" };
const messageOf = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const sameScope = (left: readonly string[] | undefined, right: readonly string[] | undefined) =>
  left === right || (left !== undefined && right !== undefined && left.length === right.length && left.every((folder, index) => folder === right[index]));

/**
 * Session search for one page: the query, its hits, and the hit the reader
 * opened. It lives above the layout switch, so a fold, an unfold, a rotation
 * or opening a hit never loses it; only `clear` does. Pure state with no
 * React, so its timing can be tested on its own.
 */
export function createSessionSearch(api: SearchApi, timing: SearchTiming = {}) {
  const debounceMs = timing.debounceMs ?? SEARCH_DEBOUNCE_MS;
  const refreshMs = timing.refreshMs ?? SEARCH_REFRESH_MS;
  let state: SessionSearchState = { query: "", results: EMPTY_RESULTS };
  let scope: readonly string[] | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let first: AbortController | undefined;
  let page: AbortController | undefined;
  let matches: AbortController | undefined;
  /** Pages loaded past the first, so a refresh while building keeps them. */
  let pages = 1;
  let foundKey = 0;
  const listeners = new Set<() => void>();
  const update = (next: SessionSearchState) => { state = next; for (const listener of listeners) listener(); };
  const results = (next: Partial<ResultsState>) => update({ ...state, results: { ...state.results, ...next } });

  function stopRequests() {
    clearTimeout(debounce); clearTimeout(refresh);
    debounce = undefined; refresh = undefined;
    first?.abort(); page?.abort();
    first = undefined; page = undefined;
  }
  /** Ask for the first page of `term`. A refresh keeps the shown hits without a busy mark. */
  async function run(term: string, silent: boolean) {
    first?.abort(); page?.abort(); clearTimeout(refresh);
    const controller = new AbortController();
    first = controller;
    if (!silent) results({ loading: true, error: undefined });
    try {
      const answer = await api.search({ q: term, scope }, controller.signal);
      if (controller.signal.aborted) return;
      first = undefined;
      const current = state.results;
      // A refresh while the index builds keeps the pages the reader already loaded.
      const kept = silent && pages > 1 && current.answered === term;
      const fresh = new Set(answer.hits.map((hit) => hit.sessionId));
      results({
        answered: term, loading: false, error: undefined, index: answer.index, paging: "idle",
        hits: kept ? [...answer.hits, ...current.hits.filter((hit) => !fresh.has(hit.sessionId))] : answer.hits,
        nextCursor: kept ? current.nextCursor : answer.nextCursor,
      });
      if (!kept) pages = 1;
      if (answer.index.state === "building") refresh = setTimeout(() => { void run(term, true); }, refreshMs);
    } catch (cause) {
      if (controller.signal.aborted) return;
      first = undefined;
      results({ loading: false, error: messageOf(cause) });
      // A refresh that failed tries again on the same beat; the reader's own retry is the Retry control.
      if (silent && cause instanceof SearchError && cause.code === undefined) refresh = setTimeout(() => { void run(term, true); }, refreshMs);
    }
  }
  /** Start, or restart, the request the current query needs. */
  function schedule(delay: number) {
    stopRequests();
    const term = state.query.trim();
    if (queryMode(term) !== "messages") {
      if (state.results.loading || state.results.error !== undefined) results({ loading: false, error: undefined });
      return;
    }
    // The busy mark (or the skeleton) shows at once; the request waits for typing to pause.
    results({ loading: true, error: undefined });
    debounce = setTimeout(() => { debounce = undefined; void run(term, false); }, delay);
  }

  async function loadMatches(found: Extract<FoundState, { type: "message" }>) {
    matches?.abort();
    const controller = new AbortController();
    matches = controller;
    const settle = (next: MatchesState) => {
      if (controller.signal.aborted || state.found?.key !== found.key) return;
      update({ ...state, found: { ...found, matches: next } });
    };
    settle({ type: "loading" });
    try {
      const all = await api.matches({ sessionId: found.hit.sessionId, q: found.query, cwd: found.hit.cwd }, controller.signal);
      const list = all.filter((match): match is SearchMatch & { position: number } => !match.offBranch && match.position !== undefined);
      if (list.length === 0) { settle({ type: "failed", message: "No match is on the current branch any more." }); return; }
      const opened = list.findIndex((match) => match.entryId === found.hit.passage.entryId);
      settle({ type: "ready", list, current: Math.max(opened, 0) });
    } catch (cause) {
      settle({ type: "failed", message: messageOf(cause) });
    }
  }

  const actions = {
    setQuery(query: string) {
      if (query === state.query) return;
      const wasMessages = queryMode(state.query) === "messages";
      update({ ...state, query });
      // A space typed after the answered query is not a new search.
      if (wasMessages && queryMode(query) === "messages" && query.trim() === state.results.answered && !state.results.loading) return;
      schedule(debounceMs);
    },
    /** The ✕ and Escape: the query and its hits go. An opened hit's match bar stays. */
    clear() {
      stopRequests();
      pages = 1;
      update({ ...state, query: "", results: EMPTY_RESULTS });
    },
    retry() { schedule(0); },
    /** The next page, after the hits already shown. */
    more() {
      const { answered, nextCursor } = state.results;
      if (answered === undefined || nextCursor === undefined || state.results.paging === "loading" || first) return;
      page?.abort();
      const controller = new AbortController();
      page = controller;
      results({ paging: "loading" });
      api.search({ q: answered, scope, cursor: nextCursor }, controller.signal).then((answer) => {
        if (controller.signal.aborted) return;
        page = undefined;
        pages += 1;
        const shown = new Set(state.results.hits.map((hit) => hit.sessionId));
        results({ paging: "idle", hits: [...state.results.hits, ...answer.hits.filter((hit) => !shown.has(hit.sessionId))],
          nextCursor: answer.nextCursor, index: answer.index });
      }, () => {
        if (controller.signal.aborted) return;
        page = undefined;
        results({ paging: "failed" });
      });
    },
    /** The group filter changed. An open query asks again at once, within the new folders. */
    setScope(next: readonly string[] | undefined) {
      if (sameScope(scope, next)) return;
      scope = next;
      if (queryMode(state.query) === "messages") schedule(0);
    },
    /** The reader opened a hit. An on-branch hit steps through its session's matches. */
    open(hit: SearchHit) {
      matches?.abort();
      foundKey += 1;
      const query = state.results.answered ?? state.query.trim();
      if (hit.offBranch) { update({ ...state, found: { type: "entry", key: foundKey, hit } }); return; }
      const found: FoundState = { type: "message", key: foundKey, hit, query, matches: { type: "loading" } };
      update({ ...state, found });
      void loadMatches(found);
    },
    /** Previous (-1) or next (+1) match, round the end. */
    step(delta: 1 | -1) {
      const found = state.found;
      if (found?.type !== "message" || found.matches.type !== "ready") return;
      const { list, current } = found.matches;
      update({ ...state, found: { ...found, matches: { ...found.matches, current: (current + delta + list.length) % list.length } } });
    },
    retryMatches() {
      if (state.found?.type === "message") void loadMatches(state.found);
    },
    closeFound() {
      matches?.abort();
      if (state.found) update({ ...state, found: undefined });
    },
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    actions,
    /** Stop every timer and request. The search can start again later. */
    dispose() { stopRequests(); matches?.abort(); },
  };
}
export type SessionSearchStore = ReturnType<typeof createSessionSearch>;
export type SessionSearchActions = SessionSearchStore["actions"];
