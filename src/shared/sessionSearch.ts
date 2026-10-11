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
