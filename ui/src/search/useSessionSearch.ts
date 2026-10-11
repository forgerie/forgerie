import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { SearchApi } from "./searchApi";
import { createSessionSearch, type SearchTiming, type SessionSearchActions, type SessionSearchState } from "./sessionSearch";

/** What the app gets from session search: plain state and the reader's actions. */
export interface SessionSearch { state: SessionSearchState; actions: SessionSearchActions }

/**
 * Session search for the page. Call it from a binding above the layout
 * switch, so the query and its hits outlive a fold, a rotation, and the list
 * closing. `scope` holds the group filter's folders; undefined searches all.
 */
export function useSessionSearch(api: SearchApi, scope: readonly string[] | undefined, timing?: SearchTiming): SessionSearch {
  const [search] = useState(() => createSessionSearch(api, timing));
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot);
  useEffect(() => { search.actions.setScope(scope); }, [search, scope]);
  useEffect(() => () => search.dispose(), [search]);
  return useMemo(() => ({ state, actions: search.actions }), [state, search]);
}
