import { afterTranscriptPaint } from "../readPaint";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WorktreeApi, WorktreeInfo } from "./worktreeApi";

/**
 * The open session's worktree. Three sources, each trusted for what it knows:
 * the catalog's live events for state, setup, cleanup, and the branch name;
 * the latest Git read for the counts; the status read until either arrives.
 */
export function combineWorktree(sources: { catalog?: WorktreeInfo | undefined; status?: WorktreeInfo | undefined; fetched?: WorktreeInfo | undefined }): WorktreeInfo | undefined {
  const counts = sources.fetched ?? sources.status ?? sources.catalog;
  const live = sources.catalog;
  if (!counts) return undefined;
  if (!live || live.id !== counts.id) return counts;
  const active = live.state.kind === "active";
  return { ...counts, branch: live.branch, state: live.state, setup: live.setup, cleanup: live.cleanup, owned: counts.owned,
    ...(live.archiveCleanup ? { archiveCleanup: live.archiveCleanup } : {}),
    // Counts describe a checkout that no longer exists once it is landed or discarded.
    ...(active ? {} : { ahead: undefined, behind: undefined, dirtyFiles: undefined }) };
}

/**
 * Binding: keeps the open session's worktree counts fresh. It reads Git when
 * the session opens and each time a run ends, because that is when commits
 * and edits change; nothing polls.
 */
export function useSessionWorktree(api: Pick<WorktreeApi, "get"> | undefined, sources: { catalog?: WorktreeInfo | undefined; status?: WorktreeInfo | undefined }, running: boolean, visibility?: { visible: boolean; revision: number; afterPaint?: (signal: AbortSignal) => Promise<void> }) {
  const [fetched, setFetched] = useState<WorktreeInfo>();
  const id = sources.catalog?.id ?? sources.status?.id;
  const active = (sources.catalog ?? sources.status)?.state.kind === "active";
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    if (!api || !id) return;
    const attempt = ++latest.current;
    try {
      const result = await api.get(id);
      if (attempt === latest.current) setFetched(result.info);
    } catch { /* The counts stay as last read; the status read still describes the worktree. */ }
  }, [api, id]);
  const observed = useRef<{ id: string | undefined; event: string } | undefined>(undefined);
  const visible = visibility?.visible ?? true;
  const revision = visibility?.revision;
  const afterPaint = visibility?.afterPaint ?? afterTranscriptPaint;
  useEffect(() => {
    if (!visible) return;
    const event = JSON.stringify([running, active, revision]);
    const previous = observed.current;
    if (previous?.id === id && previous?.event === event) return;
    observed.current = { id, event };
    if (running || !active) return;
    if (previous === undefined || previous.id !== id || visibility === undefined) { void refresh(); return; }
    const controller = new AbortController();
    let refreshed = false;
    void afterPaint(controller.signal).then(() => { if (!controller.signal.aborted) { refreshed = true; void refresh(); } });
    return () => { controller.abort(); if (!refreshed) observed.current = previous; };
  }, [id, running, active, refresh, visible, revision, afterPaint, visibility === undefined]);
  const info = combineWorktree({ ...sources, fetched: fetched?.id === id ? fetched : undefined });
  return { info, refresh };
}
