import { describe, expect, it } from "vitest";
import { indexProgress, moreMatches, queryMode, resultsView, scopeFolders, searchTerms, titleMatches, type ResultsState } from "./searchModel";
import { HITS } from "./fixtures/hits";

const idle: ResultsState = { hits: [], loading: false, paging: "idle" };

describe("search query", () => {
  it("keeps the server's terms: quotes make a phrase, short terms drop", () => {
    expect(searchTerms(`deploy "cold store" to zao`)).toEqual(["deploy", "cold store", "zao"]);
    expect(searchTerms("ab cd")).toEqual([]);
    expect(searchTerms(`"un closed`)).toEqual(["un closed"]);
  });

  it("filters titles under three characters and searches messages from three", () => {
    expect(queryMode("")).toBe("empty");
    expect(queryMode("   ")).toBe("empty");
    expect(queryMode("de")).toBe("title");
    expect(queryMode("dep")).toBe("messages");
    // Every term is under three characters, so the server would refuse it.
    expect(queryMode("ab cd")).toBe("title");
  });

  it("matches a title by case-insensitive substring and never an untitled session", () => {
    expect(titleMatches("Fix the Deploy", "dE")).toBe(true);
    expect(titleMatches("Fix the deploy", "zq")).toBe(false);
    expect(titleMatches(undefined, "de")).toBe(false);
  });

  it("scopes to the chosen group's project folders, and to nothing without a group", () => {
    const projects = [{ id: "a", path: "/code/a" }, { id: "b", path: "/code/b" }, { id: "c", path: "/code/c" }];
    expect(scopeFolders(projects, ["a", "c"])).toEqual(["/code/a", "/code/c"]);
    expect(scopeFolders(projects, undefined)).toBeUndefined();
    expect(scopeFolders(projects, [])).toEqual([]);
  });

  it("states the index progress with real numbers", () => {
    expect(indexProgress({ state: "building", indexedFiles: 4210, totalFiles: 13_719 })).toBe("Indexing 4,210 of 13,719 sessions — newer sessions first");
    expect(moreMatches(1)).toBe("+1 more match");
    expect(moreMatches(1200)).toBe("+1,200 more matches");
  });
});

describe("results view", () => {
  it("shows skeleton rows before the first answer, then the hits", () => {
    expect(resultsView("deploy", { ...idle, loading: true })).toEqual({ type: "loading" });
    expect(resultsView("deploy", { ...idle, answered: "deploy", hits: HITS })).toMatchObject({ type: "hits", busy: false, hits: HITS, more: "none" });
  });

  it("keeps the old hits with a busy mark while a newer query runs", () => {
    expect(resultsView("deploys", { ...idle, answered: "deploy", hits: HITS, loading: true })).toMatchObject({ type: "hits", busy: true, query: "deploy" });
  });

  it("fails inline when nothing for this query can show, and keeps hits when a refresh fails", () => {
    expect(resultsView("deploy", { ...idle, error: "Down" })).toEqual({ type: "failed", message: "Down" });
    expect(resultsView("other", { ...idle, answered: "deploy", hits: HITS, error: "Down" })).toEqual({ type: "failed", message: "Down" });
    expect(resultsView("deploy", { ...idle, answered: "deploy", hits: HITS, error: "Down" })).toMatchObject({ type: "hits", error: "Down" });
  });

  it("adds a progress line while the index builds, and offers more only with a cursor", () => {
    const view = resultsView("deploy", { ...idle, answered: "deploy", hits: HITS, nextCursor: "c1", index: { state: "building", indexedFiles: 10, totalFiles: 40 } });
    expect(view).toMatchObject({ type: "hits", more: "idle", progress: { value: 10, max: 40, text: "Indexing 10 of 40 sessions — newer sessions first" } });
    expect(resultsView("deploy", { ...idle, answered: "deploy", hits: HITS, index: { state: "ready", indexedFiles: 40, totalFiles: 40 } }))
      .toMatchObject({ progress: undefined });
  });
});
