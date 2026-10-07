import { useCallback, useEffect, useRef, useState } from "react";
import type { BacklogApi } from "./backlogApi";
import type { BacklogLoad } from "./backlogModel";

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Binding: the backlog list, read on demand. The server scans every project's
 * folder on each read (about half a second here), so the list is read when
 * something can have changed it, not on a timer: on load, when the page opens,
 * when the tab comes back, and when the caller says so (a start, an archive).
 * A newer read replaces an older one; a failed read keeps the last list.
 */
export function useBacklogList(api: Pick<BacklogApi, "list">) {
  const [load, setLoad] = useState<BacklogLoad>({ type: "loading" });
  const current = useRef<AbortController | undefined>(undefined);
  const refresh = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setLoad((previous) => previous.type === "ready" ? previous : previous.type === "failed" && previous.last ? { type: "ready", value: previous.last } : { type: "loading" });
    api.list(controller.signal).then((value) => { if (!controller.signal.aborted) setLoad({ type: "ready", value }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad((previous) => ({ type: "failed", message: messageOf(error), last: previous.type === "ready" ? previous.value : previous.type === "failed" ? previous.last : undefined }));
      });
  }, [api]);
  useEffect(() => {
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); current.current?.abort(); };
  }, [refresh]);
  return { load, refresh };
}
