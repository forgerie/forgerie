import type { SearchHit, SearchIndex } from "./searchApi";

/** The shortest term the server searches. Shorter terms are ignored, so a query of them only filters titles. */
export const MIN_TERM = 3;

/**
 * The query's terms, by the server's rules: split on spaces, quotes make a
 * phrase, terms under three characters are dropped. Case is the server's job.
 */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.matchAll(/"([^"]*)"?|(\S+)/gu)) {
    const term = (match[1] ?? match[2] ?? "").trim();
    if (term.length >= MIN_TERM) terms.push(term);
  }
  return terms;
}

/**
 * What a query does. Empty: nothing. Title: it narrows the session list by
 * title, because no term is long enough to search messages. Messages: hits
 * replace the list.
 */
export type QueryMode = "empty" | "title" | "messages";
export function queryMode(query: string): QueryMode {
  if (query.trim() === "") return "empty";
  return searchTerms(query).length > 0 ? "messages" : "title";
}

/** A title filter: case-insensitive substring of the session's title. An untitled session never matches. */
export function titleMatches(title: string | undefined, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return needle === "" || (title ?? "").toLocaleLowerCase().includes(needle);
}

/** The folders a group filter covers: its projects' paths. No filter means no scope, which is every folder. */
export function scopeFolders(projects: readonly { id: string; path: string }[], projectIds: readonly string[] | undefined): string[] | undefined {
  if (projectIds === undefined) return undefined;
  return projects.filter((project) => projectIds.includes(project.id)).map((project) => project.path);
}

const NUMBER = new Intl.NumberFormat("en-US");
export const formatCount = (count: number) => NUMBER.format(count);

/** The progress line while the index builds. */
export function indexProgress(index: SearchIndex): string {
  return `Indexing ${formatCount(index.indexedFiles)} of ${formatCount(index.totalFiles)} sessions — newer sessions first`;
}

export const moreMatches = (count: number) => `+${formatCount(count)} more ${count === 1 ? "match" : "matches"}`;

/** What the results area shows for the current query. */
export type ResultsView =
  /** The first answer for this query is on its way: skeleton rows. */
  | { type: "loading" }
  /** The request failed and nothing for this query can show. */
  | { type: "failed"; message: string }
  | {
    type: "hits"; query: string; hits: readonly SearchHit[];
    /** Hits of an earlier query stay while a newer one is on its way. */
    busy: boolean;
    progress?: { text: string; value: number; max: number } | undefined;
    /** A failure while hits stay on screen, such as a refresh. */
    error?: string | undefined;
    more: "none" | "idle" | "loading" | "failed";
  }
  /** A title filter found no session. */
  | { type: "titles-none"; query: string };

export interface ResultsState {
  /** The query the shown hits answer. Undefined until a first answer arrives. */
  answered?: string | undefined;
  hits: readonly SearchHit[];
  nextCursor?: string | undefined;
  index?: SearchIndex | undefined;
  /** A request for the current query is in flight. */
  loading: boolean;
  error?: string | undefined;
  paging: "idle" | "loading" | "failed";
}

export function resultsView(query: string, results: ResultsState): ResultsView {
  if (results.answered === undefined) {
    if (results.error !== undefined && !results.loading) return { type: "failed", message: results.error };
    return { type: "loading" };
  }
  if (results.error !== undefined && !results.loading && results.answered !== query.trim()) return { type: "failed", message: results.error };
  return {
    type: "hits", query: results.answered, hits: results.hits, busy: results.loading,
    progress: results.index?.state === "building"
      ? { text: indexProgress(results.index), value: results.index.indexedFiles, max: results.index.totalFiles } : undefined,
    error: results.loading ? undefined : results.error,
    more: results.nextCursor === undefined ? "none" : results.paging,
  };
}
