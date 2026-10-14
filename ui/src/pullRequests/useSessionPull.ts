import { useCallback, useEffect, useRef, useState } from "react";
import { sameLink, type MergeMethod, type PullItem, type PullLink, type PullRequestApi, type PullSessionRef } from "./pullRequestApi";

/** What the panel draws. `ready` with no items: the session links no pull request. */
export type PullsLoad =
  | { type: "loading" }
  | { type: "ready"; items: readonly PullItem[] }
  | { type: "failed"; message: string };

export interface SessionPulls {
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
  linkNumber: (number: number) => Promise<boolean>;
  unlink: (number: number) => Promise<void>;
  setWatch: (number: number, on: boolean) => Promise<void>;
  merge: (number: number, method: MergeMethod) => Promise<void>;
  clearNotice: () => void;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
/** What makes a link worth reading again: a new watch state or a new wake. */
export const linkKey = (link: PullLink) => `${link.repo.toLowerCase()}#${String(link.number)}:${link.watch.kind}:${link.watch.kind === "watching" ? String(link.watch.wakes) : ""}`;
const upsert = (items: readonly PullItem[], next: PullItem) =>
  items.some((item) => sameLink(item.link, next.link)) ? items.map((item) => sameLink(item.link, next.link) ? next : item) : [...items, next];

/**
 * Binding: every pull request linked to one session. Reads them all once on
 * open and on request. After that, a catalog change rereads only the pull
 * request it names: each read costs several GitHub requests, and the server's
 * watcher, not this client, is the poller.
 */
export function useSessionPulls(api: PullRequestApi, ref: PullSessionRef | undefined, catalogLinks: readonly PullLink[], lifetime?: AbortSignal): SessionPulls {
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
  useEffect(() => {
    if (!id || !cwd) return;
    const key = JSON.stringify([id, cwd, generation]);
    if (lifetime && fullRead.current?.key === key) return;
    fullRead.current?.controller.abort();
    const controller = new AbortController();
    fullRead.current = { key, controller };
    const signal = lifetime ? AbortSignal.any([lifetime, controller.signal]) : controller.signal;
    setLoad((current) => current.type === "ready" ? current : { type: "loading" });
    api.list({ id, cwd }, signal).then((items) => {
      if (signal.aborted) return;
      seen.current = new Map(latestCatalog.current.map((link) => [`${link.repo.toLowerCase()}#${String(link.number)}`, linkKey(link)]));
      setLoad({ type: "ready", items });
    }, (error: unknown) => {
      if (!signal.aborted) setLoad({ type: "failed", message: messageOf(error) });
    });
    return lifetime ? undefined : () => controller.abort();
  }, [api, id, cwd, generation, lifetime]);

  // Partial reads: a catalog link that appeared or changed is read again; a link that went away leaves.
  const catalogKey = catalogLinks.map(linkKey).join("|");
  useEffect(() => {
    if (!id || !cwd || !loaded) return;
    const links = latestCatalog.current;
    const now = new Map(links.map((link) => [`${link.repo.toLowerCase()}#${String(link.number)}`, linkKey(link)]));
    const changed = links.filter((link) => seen.current.get(`${link.repo.toLowerCase()}#${String(link.number)}`) !== linkKey(link));
    const gone = [...seen.current.keys()].filter((key) => !now.has(key));
    seen.current = now;
    if (gone.length > 0) setLoad((current) => current.type !== "ready" ? current
      : { type: "ready", items: current.items.filter((item) => !gone.includes(`${item.link.repo.toLowerCase()}#${String(item.link.number)}`)) });
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
  }, [api, id, cwd, loaded, catalogKey, lifetime]);

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

  return {
    links: catalogLinks, load, reading, notice, writing, refresh, clearNotice: () => setNotice(undefined),
    linkNumber: (number) => write(async (target) => { patch(await api.link(target, number)); }),
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
