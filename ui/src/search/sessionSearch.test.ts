import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSearchApi, type SearchHit, type SearchMatch, type SearchPage } from "./searchApi";
import { createSessionSearch, placeOf } from "./sessionSearch";
import { HITS, MORE_HITS } from "./fixtures/hits";

const ready = { state: "ready" as const, indexedFiles: 9, totalFiles: 9 };
interface Call { path: string; url: URL; signal: AbortSignal; answer: (body: unknown, status?: number) => void; fail: (error: Error) => void }
let calls: Call[];
const api = () => createSearchApi((path, init) => new Promise<Response>((resolve, reject) => {
  const url = new URL(path, "http://forgerie.test");
  calls.push({ path, url, signal: init.signal!, answer: (body, status = 200) => resolve(Response.json(body, { status })), fail: reject });
  init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
}));
const page = (hits: readonly SearchHit[], extra: Partial<SearchPage> = {}): SearchPage => ({ hits: [...hits], index: ready, ...extra });
const settle = () => vi.advanceTimersByTimeAsync(0);
const searches = () => calls.filter((call) => call.url.pathname === "/api/sessions/search");

beforeEach(() => { vi.useFakeTimers(); calls = []; });
afterEach(() => { vi.useRealTimers(); });

describe("session search state", () => {
  it("waits 200 ms after the last keystroke, then asks once with the scope", async () => {
    const search = createSessionSearch(api());
    search.actions.setScope(["/code/forgerie", "/code/kori"]);
    search.actions.setQuery("dep");
    await vi.advanceTimersByTimeAsync(150);
    search.actions.setQuery("deplo");
    await vi.advanceTimersByTimeAsync(150);
    search.actions.setQuery("deploy");
    // The skeleton shows at once, before the request goes out.
    expect(search.getSnapshot().results.loading).toBe(true);
    expect(search.getSnapshot().results.answered).toBeUndefined();
    await vi.advanceTimersByTimeAsync(199);
    expect(searches()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(searches()).toHaveLength(1);
    expect(searches()[0]!.url.searchParams.get("q")).toBe("deploy");
    expect(searches()[0]!.url.searchParams.getAll("scope")).toEqual(["/code/forgerie", "/code/kori"]);
    expect(searches()[0]!.url.searchParams.get("limit")).toBe("50");
    searches()[0]!.answer(page(HITS));
    await settle();
    expect(search.getSnapshot().results).toMatchObject({ answered: "deploy", loading: false, hits: HITS });
  });

  it("aborts a stale request and keeps the old hits busy until the new answer", async () => {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer(page(HITS));
    await settle();
    search.actions.setQuery("deploys");
    await vi.advanceTimersByTimeAsync(200);
    search.actions.setQuery("deployed");
    expect(search.getSnapshot().results).toMatchObject({ answered: "deploy", loading: true, hits: HITS });
    await vi.advanceTimersByTimeAsync(200);
    expect(searches()[1]!.signal.aborted).toBe(true);
    // A late answer to the aborted request changes nothing.
    searches()[1]!.answer(page([]));
    await settle();
    expect(search.getSnapshot().results.hits).toEqual(HITS);
    searches()[2]!.answer(page(HITS.slice(0, 1)));
    await settle();
    expect(search.getSnapshot().results).toMatchObject({ answered: "deployed", loading: false, hits: HITS.slice(0, 1) });
  });

  it("makes no request for a short query, and stops one in flight", async () => {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    search.actions.setQuery("de");
    expect(searches()[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(searches()).toHaveLength(1);
    expect(search.getSnapshot().results.loading).toBe(false);
  });

  it("asks again every 3 s while the index builds, without a busy mark, and stops when it is ready", async () => {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer(page(HITS.slice(0, 1), { index: { state: "building", indexedFiles: 1, totalFiles: 9 } }));
    await settle();
    await vi.advanceTimersByTimeAsync(2999);
    expect(searches()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(searches()).toHaveLength(2);
    expect(search.getSnapshot().results.loading).toBe(false);
    searches()[1]!.answer(page(HITS));
    await settle();
    expect(search.getSnapshot().results).toMatchObject({ hits: HITS, index: ready });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(searches()).toHaveLength(2);
  });

  it("stops asking once the query is cleared", async () => {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer(page(HITS, { index: { state: "building", indexedFiles: 1, totalFiles: 9 } }));
    await settle();
    search.actions.clear();
    expect(search.getSnapshot()).toMatchObject({ query: "", results: { hits: [], loading: false } });
    expect(search.getSnapshot().results.answered).toBeUndefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(searches()).toHaveLength(1);
  });

  it("keeps the typed query on a failure, and Retry asks again", async () => {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer({ error: "The search index is not available.", code: "index_unavailable" }, 503);
    await settle();
    expect(search.getSnapshot()).toMatchObject({ query: "deploy", results: { loading: false, error: "The search index is not available." } });
    search.actions.retry();
    await settle();
    expect(searches()).toHaveLength(2);
    searches()[1]!.answer(page(HITS));
    await settle();
    expect(search.getSnapshot().results).toMatchObject({ error: undefined, hits: HITS });
  });

  it("loads the next page after the shown hits", async () => {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer(page(HITS, { nextCursor: "page-2" }));
    await settle();
    search.actions.more();
    expect(search.getSnapshot().results.paging).toBe("loading");
    expect(searches()[1]!.url.searchParams.get("cursor")).toBe("page-2");
    searches()[1]!.answer(page(MORE_HITS));
    await settle();
    expect(search.getSnapshot().results).toMatchObject({ paging: "idle", nextCursor: undefined, hits: [...HITS, ...MORE_HITS] });
  });

  it("asks again at once within the new folders when the group filter changes", async () => {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer(page(HITS));
    await settle();
    search.actions.setScope(["/code/kori"]);
    await settle();
    expect(searches()[1]!.url.searchParams.getAll("scope")).toEqual(["/code/kori"]);
    search.actions.setScope(["/code/kori"]);
    await settle();
    expect(searches()).toHaveLength(2);
  });
});

describe("an opened hit", () => {
  const matches: SearchMatch[] = [
    { entryId: "e1", role: "user", offBranch: false, position: 0 },
    { entryId: "off", role: "assistant", offBranch: true },
    { entryId: "s-deploy-entry", role: "user", offBranch: false, position: 4 },
    { entryId: "e3", role: "assistant", offBranch: false, position: 9 },
  ];
  async function opened(hit: SearchHit) {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer(page(HITS));
    await settle();
    search.actions.open(hit);
    return search;
  }
  const matchesRequest = () => calls.filter((call) => call.url.pathname.endsWith("/search-matches")).at(-1)!;

  it("reads its session's on-branch matches and starts at the opened one", async () => {
    const search = await opened(HITS[0]!);
    expect(search.getSnapshot().found).toMatchObject({ place: { type: "loading" } });
    expect(matchesRequest().url.pathname).toBe("/api/sessions/s-deploy/search-matches");
    expect(Object.fromEntries(matchesRequest().url.searchParams)).toEqual({ q: "deploy", cwd: "/code/forgerie" });
    matchesRequest().answer({ matches });
    await settle();
    const found = search.getSnapshot().found;
    expect(found).toMatchObject({ place: { type: "message", current: 1 } });
    expect(found?.place.type === "message" ? found.place.list.map((match) => match.position) : []).toEqual([0, 4, 9]);
    search.actions.step(1);
    search.actions.step(1);
    expect(search.getSnapshot().found).toMatchObject({ place: { current: 0 } });
    search.actions.step(-1);
    expect(search.getSnapshot().found).toMatchObject({ place: { current: 2 } });
    // The query and its hits stay for the next look at the list.
    expect(search.getSnapshot()).toMatchObject({ query: "deploy", results: { hits: HITS } });
  });

  it("asks where an off-branch hit lies too, because its label dates from indexing", async () => {
    // The index said "other branch"; the session has since moved onto it.
    const search = await opened(HITS[2]!);
    expect(matchesRequest().url.pathname).toBe("/api/sessions/s-branch/search-matches");
    matchesRequest().answer({ matches: [{ entryId: "s-branch-entry", role: "assistant", offBranch: false, position: 7 }] });
    await settle();
    expect(search.getSnapshot().found).toMatchObject({ place: { type: "message", current: 0, list: [{ position: 7 }] } });
  });

  it("opens the tree for an on-branch label that the session has since left", async () => {
    const search = await opened(HITS[0]!);
    matchesRequest().answer({ matches: [...matches.filter((match) => match.entryId !== "s-deploy-entry"), { entryId: "s-deploy-entry", role: "user", offBranch: true }] });
    await settle();
    expect(search.getSnapshot().found).toMatchObject({ place: { type: "entry", entryId: "s-deploy-entry" } });
  });

  it("says the passage is gone rather than show another one", async () => {
    const search = await opened(HITS[0]!);
    matchesRequest().answer({ matches: matches.filter((match) => match.entryId !== "s-deploy-entry") });
    await settle();
    expect(search.getSnapshot().found?.place).toEqual({ type: "missing" });
    // An on-branch entry with no position cannot be shown either.
    expect(placeOf("x", [{ entryId: "x", role: "user", offBranch: false }])).toEqual({ type: "missing" });
    search.actions.closeFound();
    expect(search.getSnapshot().found).toBeUndefined();
  });

  it("keeps a failure to read the matches, and Retry reads them again", async () => {
    const search = await opened(HITS[0]!);
    matchesRequest().answer({ error: "Gone away" }, 500);
    await settle();
    expect(search.getSnapshot().found?.place).toEqual({ type: "failed", message: "Gone away" });
    search.actions.retryMatches();
    matchesRequest().answer({ matches });
    await settle();
    expect(search.getSnapshot().found).toMatchObject({ place: { type: "message", current: 1 } });
  });
});

describe("the group filter's folders", () => {
  it("asks nothing and finds nothing for a group with no folder, unlike no filter at all", async () => {
    const search = createSessionSearch(api());
    search.actions.setScope([]);
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(1000);
    expect(searches()).toHaveLength(0);
    expect(search.getSnapshot().results).toMatchObject({ answered: "deploy", hits: [], noFolders: true, loading: false });
    // Clearing the filter searches every folder: no scope at all.
    search.actions.setScope(undefined);
    await settle();
    expect(searches()).toHaveLength(1);
    expect(searches()[0]!.url.searchParams.has("scope")).toBe(false);
    searches()[0]!.answer(page(HITS));
    await settle();
    expect(search.getSnapshot().results).toMatchObject({ hits: HITS, noFolders: false });
  });
});

describe("refreshing while the index builds", () => {
  it("reads every loaded page again and offers more once more sessions are read", async () => {
    const building = (indexedFiles: number) => ({ state: "building" as const, indexedFiles, totalFiles: 9 });
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer(page(HITS.slice(0, 2), { nextCursor: "p2", index: building(3) }));
    await settle();
    search.actions.more();
    // The second page was the last one the index had read so far.
    searches()[1]!.answer(page(HITS.slice(2), { index: building(3) }));
    await settle();
    expect(search.getSnapshot().results).toMatchObject({ nextCursor: undefined, hits: HITS });
    await vi.advanceTimersByTimeAsync(3000);
    // The refresh walks the whole chain from the first page.
    expect(searches()[2]!.url.searchParams.has("cursor")).toBe(false);
    searches()[2]!.answer(page(HITS.slice(0, 2), { nextCursor: "p2", index: building(6) }));
    await settle();
    expect(searches()[3]!.url.searchParams.get("cursor")).toBe("p2");
    searches()[3]!.answer(page(HITS.slice(2), { nextCursor: "p3", index: building(6) }));
    await settle();
    expect(searches()).toHaveLength(4);
    expect(search.getSnapshot().results).toMatchObject({ nextCursor: "p3", hits: HITS, loading: false, index: { indexedFiles: 6 } });
    search.actions.more();
    expect(searches()[4]!.url.searchParams.get("cursor")).toBe("p3");
    searches()[4]!.answer(page(MORE_HITS, { index: building(6) }));
    await settle();
    expect(search.getSnapshot().results.hits).toEqual([...HITS, ...MORE_HITS]);
  });

  it("frees Show more when a refresh stops a page that was loading", async () => {
    const search = createSessionSearch(api());
    search.actions.setQuery("deploy");
    await vi.advanceTimersByTimeAsync(200);
    searches()[0]!.answer(page(HITS.slice(0, 2), { nextCursor: "p2", index: { state: "building", indexedFiles: 1, totalFiles: 9 } }));
    await settle();
    await vi.advanceTimersByTimeAsync(2900);
    search.actions.more();
    await vi.advanceTimersByTimeAsync(100);
    expect(searches()[1]!.signal.aborted).toBe(true);
    searches()[2]!.answer(page(HITS.slice(0, 2), { nextCursor: "p2", index: ready }));
    await settle();
    expect(search.getSnapshot().results).toMatchObject({ paging: "idle", nextCursor: "p2" });
  });
});
