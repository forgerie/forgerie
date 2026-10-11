import { z } from "zod";

/**
 * The browser's copy of the session search contract (issue #37). sessiond
 * serves it under `/api/sessions/*`, the same base the catalog store reads.
 * Only the consumed fields are specified.
 */
const roleSchema = z.enum(["user", "assistant"]);
/** `[start, end)` character offsets into the passage text. */
const markSchema = z.tuple([z.number().int(), z.number().int()]);
export const searchHitSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  title: z.string(),
  modified: z.string(),
  archived: z.boolean(),
  passage: z.object({
    entryId: z.string().min(1),
    role: roleSchema,
    timestamp: z.union([z.string(), z.number()]).optional(),
    text: z.string(),
    marks: z.array(markSchema),
  }),
  otherMatches: z.number().int().nonnegative(),
  offBranch: z.boolean(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;
export const searchIndexSchema = z.object({
  state: z.enum(["building", "ready"]),
  indexedFiles: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
});
export type SearchIndex = z.infer<typeof searchIndexSchema>;
export const searchPageSchema = z.object({
  hits: z.array(searchHitSchema),
  nextCursor: z.string().optional(),
  index: searchIndexSchema,
});
export type SearchPage = z.infer<typeof searchPageSchema>;
export const searchMatchSchema = z.object({
  entryId: z.string().min(1),
  role: roleSchema,
  offBranch: z.boolean(),
  /** The message's index in the current `/messages` list. Absent when off the branch. */
  position: z.number().int().nonnegative().optional(),
});
export type SearchMatch = z.infer<typeof searchMatchSchema>;
export const searchMatchesSchema = z.object({ matches: z.array(searchMatchSchema) });
const refusalSchema = z.object({ error: z.string(), code: z.string().optional() });

/** A refused or failed search. `code` is the server's reason, such as `index_unavailable`. */
export class SearchError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) { super(message); this.name = "SearchError"; }
}

export type SearchRequest = (path: string, init: RequestInit) => Promise<Response>;
export const SEARCH_PAGE_SIZE = 50;

export function createSearchApi(request: SearchRequest, base = "/api") {
  async function read<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    let response: Response;
    try { response = await request(path, { signal }); } catch (cause) {
      if (signal.aborted) throw cause;
      throw new SearchError("Could not reach the server. Check the connection, then try again.");
    }
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const refusal = refusalSchema.safeParse(body).data;
      throw new SearchError(refusal?.error ?? `Search failed with HTTP ${String(response.status)}.`, response.status, refusal?.code);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new SearchError("The server sent search results this page cannot read.", response.status);
    return parsed.data;
  }
  return {
    /** One page of hits, newest session first. `scope` holds absolute folders; none means every folder. */
    search(query: { q: string; scope?: readonly string[] | undefined; cursor?: string | undefined; limit?: number }, signal: AbortSignal): Promise<SearchPage> {
      const params = new URLSearchParams({ q: query.q });
      for (const folder of query.scope ?? []) params.append("scope", folder);
      if (query.cursor) params.set("cursor", query.cursor);
      params.set("limit", String(query.limit ?? SEARCH_PAGE_SIZE));
      return read(`${base}/sessions/search?${params}`, searchPageSchema, signal);
    },
    /** Every match of a query in one session, ordered by branch position. */
    matches(query: { sessionId: string; q: string; cwd: string }, signal: AbortSignal): Promise<SearchMatch[]> {
      const params = new URLSearchParams({ q: query.q, cwd: query.cwd });
      return read(`${base}/sessions/${encodeURIComponent(query.sessionId)}/search-matches?${params}`, searchMatchesSchema, signal)
        .then((result) => result.matches);
    },
  };
}
export type SearchApi = ReturnType<typeof createSearchApi>;
