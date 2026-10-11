import type { FastifyInstance, FastifyReply } from "fastify";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { SessionSearchRoutesService } from "./sessionSearchService.js";
import { parseSearchQuery, SessionSearchError } from "./sessionSearchText.js";

interface SearchQuery { q?: string; scope?: string | string[]; cursor?: string; limit?: string }

export function registerSessionSearchRoutes(app: FastifyInstance, search: SessionSearchRoutesService): void {
  app.get<{ Querystring: SearchQuery }>("/sessions/search", async (request, reply) => {
    try {
      const q = requireQuery(request.query.q);
      const scope = request.query.scope;
      return await search.search({ q,
        ...(scope === undefined ? {} : { scope: typeof scope === "string" ? [scope] : scope }),
        ...(request.query.cursor === undefined ? {} : { cursor: request.query.cursor }),
        ...(request.query.limit === undefined ? {} : { limit: Number(request.query.limit) }),
      });
    } catch (error) { return searchError(reply, error); }
  });
  app.get<{ Params: { sessionId: string }; Querystring: { q?: string; cwd?: string } }>("/sessions/:sessionId/search-matches", async (request, reply) => {
    try {
      const q = requireQuery(request.query.q);
      if (typeof request.query.cwd !== "string" || request.query.cwd === "") throw new SessionSearchError("invalid_request", "cwd query parameter is required");
      let cwd: string;
      try { cwd = normalizeRequestCwd(request.query.cwd); }
      catch (error) { throw new SessionSearchError("invalid_request", error instanceof Error ? error.message : String(error)); }
      return await search.matches(request.params.sessionId, cwd, q);
    } catch (error) { return searchError(reply, error); }
  });
}

function requireQuery(value: unknown): string {
  if (typeof value !== "string") throw new SessionSearchError("query_too_short", "Use at least one term with at least 3 characters");
  if (value.length > 4096) throw new SessionSearchError("invalid_request", "Search query is too long");
  parseSearchQuery(value);
  return value;
}

function searchError(reply: FastifyReply, error: unknown): FastifyReply {
  const code = error instanceof SessionSearchError ? error.code : "index_unavailable";
  return reply.code(code === "index_unavailable" ? 503 : 400).send({ error: error instanceof Error ? error.message : String(error), code });
}
