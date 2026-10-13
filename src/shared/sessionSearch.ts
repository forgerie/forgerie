export const MIN_SEARCH_TERM_LENGTH = 3;

/**
 * Whitespace splits terms outside phrases. Quotes toggle a phrase anywhere;
 * doubled quotes inside a phrase are literal, and an unfinished phrase takes
 * the rest of the query. Keep terms by code-point length before case folding.
 */
export function searchQueryTerms(query: string): string[] {
  const terms: string[] = [];
  let term = "";
  let quoted = false;
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (char === '"') {
      if (quoted && query[i + 1] === '"') { term += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && /\s/u.test(char ?? "")) {
      if (Array.from(term).length >= MIN_SEARCH_TERM_LENGTH) terms.push(term.toLowerCase());
      term = "";
    } else term += char ?? "";
  }
  if (Array.from(term).length >= MIN_SEARCH_TERM_LENGTH) terms.push(term.toLowerCase());
  return [...new Set(terms)];
}

export interface MatchedPassage {
  entryId: string;
  role: "user" | "assistant";
  timestamp: string;
  /** At most 240 UTF-16 code units. Marks use offsets into this text. */
  text: string;
  marks: [number, number][];
}

export interface SearchHit {
  sessionId: string;
  cwd: string;
  title: string;
  modified: string;
  archived: boolean;
  passage: MatchedPassage;
  otherMatches: number;
  offBranch: boolean;
}

export interface SessionSearchIndexStatus {
  state: "building" | "ready";
  indexedFiles: number;
  totalFiles: number;
}

export interface SessionSearchResponse {
  hits: SearchHit[];
  nextCursor?: string;
  index: SessionSearchIndexStatus;
}

export interface SessionSearchMatch {
  entryId: string;
  role: "user" | "assistant";
  offBranch: boolean;
  /** Index in the unpaged /messages response after browser projection. */
  position?: number;
}

export interface SessionSearchMatchesResponse {
  matches: SessionSearchMatch[];
}
