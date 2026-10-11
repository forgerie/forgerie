import { SearchError, type SearchApi, type SearchHit, type SearchMatch, type SearchPage } from "./searchApi";
import { queryMode, type ResultsState } from "./searchModel";

/**
 * The hit the reader opened. Where its passage lies is not the hit's own
 * `offBranch`, which dates from indexing: the session's `search-matches`,
 * read when the hit opens, decides.
 */
export interface FoundState { key: number; hit: SearchHit; query: string; place: FoundPlace }
export type FoundPlace =
  | { type: "loading" }
  | { type: "failed"; message: string }
  /** The session no longer holds the hit's passage. No other passage stands in for it. */
  | { type: "missing" }
  /** On the current branch: the session's on-branch matches in branch order, each with its `/messages` position. `current` indexes `list`. */
  | { type: "message"; list: readonly (SearchMatch & { position: number })[]; current: number }
  /** Off the current branch: the history tree shows the entry. */
  | { type: "entry"; entryId: string };

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
/** Pages joined in order, each session once. */
function joinHits(pages: readonly (readonly SearchHit[])[]): SearchHit[] {
  const seen = new Set<string>();
  return pages.flat().filter((hit) => {
    if (seen.has(hit.sessionId)) return false;
    seen.add(hit.sessionId);
    return true;
  });
}

/**
 * Where the opened passage lies, from the session's matches. Only the exact
 * entry counts: an on-branch entry needs its position to be shown.
 */
export function placeOf(entryId: string, all: readonly SearchMatch[]): FoundPlace {
  const match = all.find((candidate) => candidate.entryId === entryId);
  if (!match) return { type: "missing" };
  if (match.offBranch) return { type: "entry", entryId };
  const list = all.filter((candidate): candidate is SearchMatch & { position: number } => !candidate.offBranch && candidate.position !== undefined);
  const current = list.findIndex((candidate) => candidate.entryId === entryId);
  return current < 0 ? { type: "missing" } : { type: "message", list, current };
}

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
  /** `undefined` searches every folder; `[]` is a group filter with no folder, which matches nothing. */
  let scope: readonly string[] | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  let first: AbortController | undefined;
  let page: AbortController | undefined;
  let matches: AbortController | undefined;
  /** How many pages the shown hits came from. A refresh while the index builds reads that many again. */
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
  /** The first `count` pages of `term`, each from the cursor the one before it gave. */
  async function readPages(term: string, count: number, signal: AbortSignal): Promise<SearchPage[]> {
    const read: SearchPage[] = [];
    let cursor: string | undefined;
    do {
      const answer = await api.search({ q: term, scope, cursor }, signal);
      read.push(answer);
      cursor = answer.nextCursor;
    } while (cursor !== undefined && read.length < count);
    return read;
  }
  /**
   * Ask for `term`. A refresh while the index builds reads again every page
   * the reader loaded, with no busy mark, and takes its cursor from the fresh
   * answers: a list that had run out offers more once more sessions are read.
   */
  async function run(term: string, silent: boolean) {
    first?.abort(); clearTimeout(refresh);
    if (page) { page.abort(); page = undefined; }
    const controller = new AbortController();
    first = controller;
    if (!silent) results({ loading: true, error: undefined });
    try {
      const count = silent && state.results.answered === term ? pages : 1;
      const read = await readPages(term, count, controller.signal);
      if (controller.signal.aborted) return;
      first = undefined;
      pages = read.length;
      const last = read.at(-1)!;
      results({ answered: term, loading: false, error: undefined, index: last.index, paging: "idle", noFolders: false,
        hits: joinHits(read.map((answer) => answer.hits)), nextCursor: last.nextCursor });
      if (last.index.state === "building") refresh = setTimeout(() => { void run(term, true); }, refreshMs);
    } catch (cause) {
      if (controller.signal.aborted) return;
      first = undefined;
      results({ loading: false, paging: "idle", error: messageOf(cause) });
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
    // A group with no folder matches nothing: there is nothing to ask.
    if (scope !== undefined && scope.length === 0) {
      pages = 1;
      results({ answered: term, hits: [], nextCursor: undefined, index: undefined, loading: false, error: undefined, paging: "idle", noFolders: true });
      return;
    }
    // The busy mark (or the skeleton) shows at once; the request waits for typing to pause.
    results({ loading: true, error: undefined });
    debounce = setTimeout(() => { debounce = undefined; void run(term, false); }, delay);
  }

  async function locate(found: FoundState) {
    matches?.abort();
    const controller = new AbortController();
    matches = controller;
    const settle = (place: FoundPlace) => {
      if (controller.signal.aborted || state.found?.key !== found.key) return;
      update({ ...state, found: { ...found, place } });
    };
    settle({ type: "loading" });
    try {
      settle(placeOf(found.hit.passage.entryId, await api.matches({ sessionId: found.hit.sessionId, q: found.query, cwd: found.hit.cwd }, controller.signal)));
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
        results({ paging: "idle", hits: joinHits([state.results.hits, answer.hits]), nextCursor: answer.nextCursor, index: answer.index });
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
    /** The reader opened a hit. Its session's matches say where the passage lies now. */
    open(hit: SearchHit) {
      foundKey += 1;
      const found: FoundState = { key: foundKey, hit, query: state.results.answered ?? state.query.trim(), place: { type: "loading" } };
      update({ ...state, found });
      void locate(found);
    },
    /** Previous (-1) or next (+1) match, round the end. */
    step(delta: 1 | -1) {
      const found = state.found;
      if (found?.place.type !== "message") return;
      const { list, current } = found.place;
      update({ ...state, found: { ...found, place: { ...found.place, current: (current + delta + list.length) % list.length } } });
    },
    retryMatches() {
      if (state.found) void locate(state.found);
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
export type SessionSearchActions = ReturnType<typeof createSessionSearch>["actions"];
