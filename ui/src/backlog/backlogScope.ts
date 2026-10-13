import { useCallback, useState } from "react";
export type BacklogScope = "mine" | "everyone";
const KEY = "forgerie.backlog.scope";
/** A non-sensitive browser preference. Storage may be disabled. */
export function readBacklogScope(): BacklogScope {
  try { return window.localStorage.getItem(KEY) === "everyone" ? "everyone" : "mine"; } catch { return "mine"; }
}
export function useBacklogScope() {
  const [scope, setValue] = useState(readBacklogScope);
  const setScope = useCallback((value: BacklogScope) => { try { window.localStorage.setItem(KEY, value); } catch { /* The current page still works without persistence. */ } setValue(value); }, []);
  return { scope, setScope };
}
