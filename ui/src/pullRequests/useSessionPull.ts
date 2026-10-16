import type { PullRepository } from "@shared/pullRequests";
import { afterTranscriptPaint } from "../readPaint";
import { useCallback, useEffect, useRef, useState } from "react";
import { sameLink, type OpenPullsResponse, type PullPreviewResponse, type MergeMethod, type PullItem, type PullLink, type PullRequestApi, type PullSessionRef } from "./pullRequestApi";

/** What the panel draws. `ready` with no items: the session links no pull request. */
export type PullsLoad =
  | { type: "loading" }
  | { type: "ready"; items: readonly PullItem[] }
  | { type: "failed"; message: string };

export interface PullDiscovery {
  open: (signal?: AbortSignal) => Promise<OpenPullsResponse>;
  preview: (number: number, signal?: AbortSignal) => Promise<PullPreviewResponse>;
}
export interface SessionPulls {
  discovery: PullDiscovery;
  /** The catalog's links: known before GitHub is read, so the header can show at once. */
  links: readonly PullLink[];
  load: PullsLoad;
  /** Numbers being read again after a change. Their rows keep the last read meanwhile. */
  reading: ReadonlySet<number>;
  /** The last write's outcome, in words: a refusal or a merge receipt. */
  notice: { tone: "error" | "done"; text: string } | undefined;
  /** A write is in flight. Writes do not overlap. */
  writing: boolean;
  refresh: () => void;
  linkNumber: (number: number, expected?: PullRepository) => Promise<boolean>;
  unlink: (number: number) => Promise<void>;
  setWatch: (number: number, on: boolean) => Promise<void>;
  merge: (number: number, method: MergeMethod) => Promise<void>;
  clearNotice: () => void;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const pullKey = (link: PullLink) => `${link.repo.toLowerCase()}#${String(link.number)}`;
/** What makes a link worth reading again: a new watch state or a new wake. */
export const linkKey = (link: PullLink) => `${pullKey(link)}:${link.watch.kind}:${link.watch.kind === "watching" ? String(link.watch.wakes) : ""}`;
const seenFromLinks = (links: readonly PullLink[]): Map<string, string> =>
  new Map(links.map(link => [pullKey(link), linkKey(link)]));
const changedSinceRead = (link: PullLink, seen: ReadonlyMap<string, string>): boolean =>
  seen.get(pullKey(link)) !== linkKey(link);
const upsert = (items: readonly PullItem[], next: PullItem) =>
  items.some((item) => sameLink(item.link, next.link)) ? items.map((item) => sameLink(item.link, next.link) ? next : item) : [...items, next];

/**
 * Binding: every pull request linked to one session. Reads them all once on
 * open and on request. After that, a catalog change rereads only the pull
 * request it names: each read costs several GitHub requests, and the server's
 * watcher, not this client, is the poller.
 */
export function useSessionPulls(api: PullRequestApi, ref: PullSessionRef | undefined, catalogLinks: readonly PullLink[], lifetime?: AbortSignal, visibility?: { visible: boolean; revision: number; afterPaint?: (signal: AbortSignal) => Promise<void> }): SessionPulls {
  const [load, setLoad] = useState<PullsLoad>({ type: "loading" });
  const [reading, setReading] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<SessionPulls["notice"]>();
  const [writing, setWriting] = useState(false);
  const [generation, setGeneration] = useState(0);
  const id = ref?.id;
  const cwd = ref?.cwd;
  const loaded = load.type === "ready";

  // Full read: on open, on refresh.
  const seen = useRef(new Map<string, string>());
  const latestCatalog = useRef(catalogLinks);
  const fullRead = useRef<{ key: string; controller: AbortController } | undefined>(undefined);
  latestCatalog.current = catalogLinks;
  const visible = visibility?.visible ?? true;
  const revision = visibility?.revision ?? 0;
  const afterPaint = visibility?.afterPaint ?? afterTranscriptPaint;
  const catalogKey = catalogLinks.map(linkKey).join("|");
  const fullCatalogKey = visibility === undefined ? "" : catalogKey;
  const suspended = useRef(false);
  const completedVersion = useRef(revision);
  const readingFull = useRef(false);
  useEffect(() => () => { suspended.current = true; }, []);
  useEffect(() => {
    if (!id || !cwd || !visible) return;
    const key = JSON.stringify([id, cwd, generation, revision]);
    const changedCatalog = catalogLinks.some(link => changedSinceRead(link, seen.current))
      || seen.current.size !== catalogLinks.length;
    const hiddenEvent = suspended.current && changedCatalog;
    const versionChanged = completedVersion.current !== revision;
    const previous = fullRead.current;
    suspended.current = false;
    if (lifetime && previous?.key === key && !previous.controller.signal.aborted && !hiddenEvent) return;
    previous?.controller.abort();
    const controller = new AbortController();
    fullRead.current = { key, controller };
    const signal = lifetime ? AbortSignal.any([lifetime, controller.signal]) : controller.signal;
    readingFull.current = true;
    let admitted = false;
    const read = async () => {
      if (signal.aborted) return;
      admitted = true; completedVersion.current = revision;
      setLoad(current => current.type === "ready" ? current : { type: "loading" });
      try {
        const items = await api.list({ id, cwd }, signal);
        if (signal.aborted) return;
        seen.current = seenFromLinks(latestCatalog.current);
        setLoad({ type: "ready", items });
      } catch (error) { if (!signal.aborted) setLoad({ type: "failed", message: messageOf(error) }); }
      finally { readingFull.current = false; }
    };
    const defer = previous !== undefined && (hiddenEvent || versionChanged || previous.controller.signal.aborted && previous.key === key);
    if (defer) void afterPaint(signal).then(read); else void read();
    return () => {
      if (!lifetime || !admitted) { controller.abort(); readingFull.current = false; }
    };
  }, [api, id, cwd, generation, lifetime, visible, revision, afterPaint, fullCatalogKey]);

  // Partial reads: a catalog link that appeared or changed is read again; a link that went away leaves.
  useEffect(() => {
    if (!id || !cwd || !loaded || !visible || readingFull.current) return;
    const links = latestCatalog.current;
    const now = seenFromLinks(links);
    const changed = links.filter((link) => changedSinceRead(link, seen.current));
    const gone = [...seen.current.keys()].filter((key) => !now.has(key));
    seen.current = now;
    if (gone.length > 0) setLoad((current) => current.type !== "ready" ? current
      : { type: "ready", items: current.items.filter((item) => !gone.includes(pullKey(item.link))) });
    if (changed.length === 0) return;
    const controller = new AbortController();
    const signal = lifetime ? AbortSignal.any([lifetime, controller.signal]) : controller.signal;
    setReading((current) => new Set([...current, ...changed.map((link) => link.number)]));
    for (const link of changed) {
      // The link itself is news: show the new watch state before GitHub answers.
      setLoad((current) => current.type !== "ready" ? current
        : { type: "ready", items: upsert(current.items, { ...(current.items.find((item) => sameLink(item.link, link)) ?? { pull: null }), link }) });
      api.read({ id, cwd }, link.number, signal).then(
        (result) => { if (!signal.aborted) setLoad((current) => current.type !== "ready" ? current : { type: "ready", items: upsert(current.items, result) }); },
        (error: unknown) => { if (!signal.aborted) setLoad((current) => current.type !== "ready" ? current
          : { type: "ready", items: upsert(current.items, { ...(current.items.find((item) => sameLink(item.link, link)) ?? { pull: null }), link, error: messageOf(error) }) }); },
      ).finally(() => setReading((current) => { const next = new Set(current); next.delete(link.number); return next; }));
    }
    return lifetime ? undefined : () => controller.abort();
  }, [api, id, cwd, loaded, catalogKey, lifetime, visible]);

  const refresh = useCallback(() => { setLoad({ type: "loading" }); setGeneration((value) => value + 1); }, []);
  const write = useCallback(async (run: (target: PullSessionRef) => Promise<void>): Promise<boolean> => {
    if (!id || !cwd) return false;
    setWriting(true);
    setNotice(undefined);
    try { await run({ id, cwd }); return true; }
    catch (error) { setNotice({ tone: "error", text: messageOf(error) }); return false; }
    finally { setWriting(false); }
  }, [id, cwd]);
  const items = load.type === "ready" ? load.items : [];
  const patch = (next: PullItem) => setLoad((current) => current.type !== "ready" ? current : { type: "ready", items: upsert(current.items, next) });
  const itemOf = (number: number) => items.find((item) => item.link.number === number);

  const open = useCallback((signal?: AbortSignal) => {
    if (!id || !cwd) return Promise.reject(new Error("Select a session workspace first."));
    return api.open({ id, cwd }, signal);
  }, [api, id, cwd]);
  const preview = useCallback((number: number, signal?: AbortSignal) => {
    if (!id || !cwd) return Promise.reject(new Error("Select a session workspace first."));
    return api.preview({ id, cwd }, number, signal);
  }, [api, id, cwd]);

  return {
    discovery: { open, preview }, links: catalogLinks, load, reading, notice, writing, refresh, clearNotice: () => setNotice(undefined),
    linkNumber: (number, expected) => write(async (target) => { patch(await api.link(target, number, expected)); }),
    unlink: async (number) => {
      await write(async (target) => {
        const removed = await api.unlink(target, number);
        setLoad((current) => current.type !== "ready" ? current : { type: "ready", items: current.items.filter((item) => !sameLink(item.link, removed)) });
      });
    },
    setWatch: async (number, on) => {
      await write(async (target) => {
        const link = on ? await api.watch(target, number) : await api.stopWatch(target, number);
        const item = itemOf(number);
        patch({ ...(item ?? { pull: null }), link });
      });
    },
    merge: async (number, method) => {
      await write(async (target) => {
        const pull = itemOf(number)?.pull;
        if (!pull) throw new Error("Read the pull request before you merge it.");
        const result = await api.merge(target, pull, method);
        setNotice({ tone: "done", text: result.text });
        patch(await api.read(target, number));
      });
    },
  };
}
