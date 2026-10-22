import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { BacklogSuggestionActRequestSchema, BacklogSuggestionFileRequestSchema, BacklogSuggestionSchema, BacklogSuggestionsQuerySchema, BacklogSuggestionsResponseSchema } from "../../../shared/backlogSuggestions.js";
import { BacklogErrorSchema } from "../../../shared/backlog.js";
import { BacklogError } from "../backlogError.js";
import type { BacklogSuggestionService } from "./suggestionService.js";

export function registerBacklogSuggestionRoutes(app: FastifyInstance, service: BacklogSuggestionService, prefix = ""): void {
  const errors = { 400: BacklogErrorSchema, 404: BacklogErrorSchema, 409: BacklogErrorSchema, 503: BacklogErrorSchema };
  const run = async (reply: FastifyReply, action: () => unknown) => {
    try { return await action(); }
    catch (error) {
      const kind = error instanceof BacklogError ? error.kind : "unavailable";
      if (kind === "unavailable") reply.log.error({ err: error }, "backlog suggestion request failed");
      return reply.code({ "invalid-request": 400, "not-found": 404, conflict: 409, unavailable: 503 }[kind]).send({ kind, error: error instanceof Error ? error.message : "Suggestion request failed" });
    }
  };
  app.get<{ Querystring: unknown }>(`${prefix}/backlog/suggestions`, { schema: { response: { 200: BacklogSuggestionsResponseSchema, ...errors } } }, (request, reply) => run(reply, () => {
    if (!Check(BacklogSuggestionsQuerySchema, request.query)) throw new BacklogError("invalid-request", "Invalid suggestion query");
    return { suggestions: service.list(request.query) };
  }));
  for (const action of ["file", "file-and-act", "dismiss", "restore"] as const) {
    app.post<{ Params: { id: string }; Body: unknown }>(`${prefix}/backlog/suggestions/:id/${action}`, { schema: { response: { 200: BacklogSuggestionSchema, ...errors } } }, (request, reply) => run(reply, () => {
      if (action === "file" || action === "file-and-act") {
        if (!Check(action === "file" ? BacklogSuggestionFileRequestSchema : BacklogSuggestionActRequestSchema, request.body)) throw new BacklogError("invalid-request", "Invalid suggestion filing request");
        return service.file(request.params.id, action, request.body);
      }
      if (!Check(Type.Object({}, { additionalProperties: false }), request.body)) throw new BacklogError("invalid-request", "Only an empty object is accepted");
      return service.transition(request.params.id, action);
    }));
  }
}
