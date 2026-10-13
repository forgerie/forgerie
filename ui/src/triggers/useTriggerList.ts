import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TriggerRefusal, type TriggersApi } from "./triggersApi";
import { listOf, type TriggerListLoad } from "./triggersModel";

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
/** Subscribes to "the triggers changed" and returns the way to stop. */
export type TriggerChanges = (listener: () => void) => () => void;

/**
 * Binding: the trigger list, held at the app's top so the session list's entry
 * stays true while the screen is closed. It is read on load, when the tab comes
 * back, on each `triggers.changed` event, and when the caller says so. A newer
 * read replaces an older one; a failed read keeps the last list. A 503 means
 * the trigger store is off.
 */
export function useTriggerList(api: Pick<TriggersApi, "list">, changes?: TriggerChanges) {
  const [load, setLoad] = useState<TriggerListLoad>({ type: "loading" });
  const current = useRef<AbortController | undefined>(undefined);
  const refresh = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    api.list(controller.signal).then((value) => { if (!controller.signal.aborted) setLoad({ type: "ready", value }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad((previous) => {
          const last = listOf(previous);
          return error instanceof TriggerRefusal && error.status === 503
            ? { type: "off", message: error.message, last } : { type: "failed", message: messageOf(error), last };
        });
      });
  }, [api]);
  useEffect(() => {
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const stop = changes?.(refresh);
    return () => { document.removeEventListener("visibilitychange", onVisible); stop?.(); current.current?.abort(); };
  }, [refresh, changes]);
  return useMemo(() => ({ load, refresh }), [load, refresh]);
}
export type TriggerList = ReturnType<typeof useTriggerList>;
