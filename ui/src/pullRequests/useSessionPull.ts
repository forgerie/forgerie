import { useCallback, useEffect, useRef, useState } from "react";
import type { MergeMethod, PullLink, PullRequest, PullRequestApi, PullSessionRef } from "./pullRequestApi";

/** What the panel draws. `none`: the session has no linked pull request. */
export type PullLoad =
  | { type: "loading" }
  | { type: "none" }
  | { type: "ready"; value: PullRequest }
  | { type: "failed"; message: string };

export interface SessionPull {
  link: PullLink | undefined;
  load: PullLoad;
  /** The last write's outcome, in words: a refusal or a merge receipt. */
  notice: { tone: "error" | "done"; text: string } | undefined;
  /** A write is in flight. Writes do not overlap. */
  writing: boolean;
  refresh: () => void;
  linkNumber: (number: number) => Promise<void>;
  setWatch: (on: boolean) => Promise<void>;
  merge: (method: MergeMethod) => Promise<void>;
  clearNotice: () => void;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
/** Changes that mean GitHub may say something new: another PR, a watch change, or a wake. */
export const linkKey = (link: PullLink | undefined) => link ? `${link.repo}#${String(link.number)}:${link.watch.kind}:${link.watch.kind === "watching" ? String(link.watch.wakes) : ""}` : "";

/**
 * Binding: one session's pull request. Reads once on open, again when the
 * catalog reports a new link, watch state, or wake, and on request. Each read
 * costs several GitHub requests, so nothing polls here; the server's watcher
 * is the poller.
 */
export function useSessionPull(api: PullRequestApi, ref: PullSessionRef | undefined, catalogLink: PullLink | undefined): SessionPull {
  const [link, setLink] = useState<PullLink | undefined>(catalogLink);
  const [load, setLoad] = useState<PullLoad>({ type: "loading" });
  const [notice, setNotice] = useState<SessionPull["notice"]>();
  const [writing, setWriting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const id = ref?.id;
  const cwd = ref?.cwd;

  // The catalog's live link wins over an older read: it carries watch changes and wakes.
  const catalogKey = linkKey(catalogLink);
  // Keyed on the link's meaning, not its object identity: the catalog rebuilds objects on unrelated events.
  const latest = useRef(catalogLink);
  latest.current = catalogLink;
  useEffect(() => { if (latest.current) setLink(latest.current); }, [catalogKey]);

  useEffect(() => {
    if (!id || !cwd) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoad((current) => current.type === "ready" ? current : { type: "loading" });
    api.read({ id, cwd }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLink(result.link ?? undefined);
      setLoad(result.pull ? { type: "ready", value: result.pull } : result.link
        ? { type: "failed", message: `Pull request #${String(result.link.number)} is linked, but the server sent no data for it. Read it again.` }
        : { type: "none" });
    }, (error: unknown) => {
      if (controller.signal.aborted) return;
      setLoad({ type: "failed", message: messageOf(error) });
    });
    return () => controller.abort();
  }, [api, id, cwd, catalogKey, generation]);

  const refresh = useCallback(() => { setLoad({ type: "loading" }); setGeneration((value) => value + 1); }, []);
  const write = useCallback(async (run: (ref: PullSessionRef) => Promise<void>) => {
    if (!id || !cwd) return;
    setWriting(true);
    setNotice(undefined);
    try { await run({ id, cwd }); }
    catch (error) { setNotice({ tone: "error", text: messageOf(error) }); }
    finally { setWriting(false); }
  }, [id, cwd]);

  return {
    link, load, notice, writing, refresh, clearNotice: () => setNotice(undefined),
    linkNumber: (number) => write(async (target) => {
      const result = await api.link(target, number);
      setLink(result.link ?? undefined);
      setLoad(result.pull ? { type: "ready", value: result.pull } : { type: "none" });
    }),
    setWatch: (on) => write(async (target) => {
      const next = on ? await api.watch(target) : await api.stopWatch(target);
      if (next) setLink(next);
    }),
    merge: (method) => write(async (target) => {
      if (load.type !== "ready") throw new Error("Read the pull request before you merge it.");
      const result = await api.merge(target, load.value, method);
      setNotice({ tone: "done", text: result.text });
      refresh();
    }),
  };
}
