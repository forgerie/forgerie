import type { SessionSearchIndexStatus, SessionSearchMatch } from "../../shared/sessionSearch.js";
import type { IndexedSearchHit } from "./sessionSearchIndex.js";

export interface SearchWorkerOptions { filePath: string; sessionsDir: string; agentDir?: string }
export type SearchWorkerRequest = { id: number } & SearchWorkerCommand;
export type SearchWorkerCommand = (
  | { kind: "search"; query: string }
  | { kind: "matches"; sessionId: string; query: string }
  | { kind: "refresh"; path: string }
  | { kind: "scan" }
  | { kind: "close" }
);
export type SearchWorkerResult = { hits: IndexedSearchHit[]; index: SessionSearchIndexStatus } | SessionSearchMatch[] | undefined;
export type SearchWorkerReply =
  | { kind: "result"; id: number; result: SearchWorkerResult }
  | { kind: "error"; id: number; error: string }
  | { kind: "log"; message: string }
  | { kind: "progress"; index: SessionSearchIndexStatus };
