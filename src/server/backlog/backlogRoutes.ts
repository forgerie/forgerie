import type { FastifyInstance, FastifyReply } from "fastify";
import { Check } from "typebox/value";
import { BacklogDetailResponseSchema, BacklogErrorSchema, BacklogItemQuerySchema, BacklogLaunchRequestSchema, BacklogLaunchResponseSchema, BacklogListResponseSchema, BacklogReleaseRequestSchema, BacklogReleaseResponseSchema } from "../../shared/backlog.js";
import type { BacklogErrorResponse, BacklogProviderId } from "../../shared/apiTypes.js";
import { BacklogError, backlogErrorMessage } from "./backlogError.js";
import type { BacklogService } from "./backlogService.js";

export function registerBacklogRoutes(app: FastifyInstance, backlog: BacklogService, prefix = ""): void {
  const errors = { 400: BacklogErrorSchema, 404: BacklogErrorSchema, 409: BacklogErrorSchema, 503: BacklogErrorSchema };
  app.get(`${prefix}/backlog`, { schema: { response: { 200: BacklogListResponseSchema, ...errors } } }, async (_request, reply) => {
    try { return await backlog.list(); } catch (error) { return sendError(reply, error); }
  });
  // `?provider=` selects where the item comes from. Omitted means markdown, so pre-provider clients keep working.
  const itemPath = `${prefix}/backlog/:projectId/items/:itemId`;
  app.get<{ Params: { projectId: string; itemId: string }; Querystring: unknown }>(itemPath, { schema: { response: { 200: BacklogDetailResponseSchema, ...errors } } }, async (request, reply) => {
    try { return await backlog.detail(request.params.projectId, request.params.itemId, providerOf(request.query)); }
    catch (error) { return sendError(reply, error); }
  });
  app.post<{ Params: { projectId: string; itemId: string }; Querystring: unknown; Body: unknown }>(`${itemPath}/launch`, { schema: { response: { 200: BacklogLaunchResponseSchema, ...errors } } }, async (request, reply) => {
    try {
      const provider = providerOf(request.query);
      if (!Check(BacklogLaunchRequestSchema, request.body)) throw new BacklogError("invalid-request", "Invalid backlog launch request");
      return await backlog.launch(request.params.projectId, request.params.itemId, request.body, provider);
    } catch (error) { return sendError(reply, error); }
  });
  app.post<{ Params: { projectId: string; itemId: string }; Querystring: unknown; Body: unknown }>(`${itemPath}/release`, { schema: { response: { 200: BacklogReleaseResponseSchema, ...errors } } }, async (request, reply) => {
    try {
      const provider = providerOf(request.query);
      if (!Check(BacklogReleaseRequestSchema, request.body)) throw new BacklogError("invalid-request", "claimId is required to release a claim");
      return await backlog.release(request.params.projectId, request.params.itemId, request.body, provider);
    } catch (error) { return sendError(reply, error); }
  });
}
function providerOf(query: unknown): BacklogProviderId | undefined {
  if (!Check(BacklogItemQuerySchema, query)) throw new BacklogError("invalid-request", "Malformed backlog provider name");
  return query.provider;
}
function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  const kind = error instanceof BacklogError ? error.kind : "unavailable";
  const body: BacklogErrorResponse = { kind, error: backlogErrorMessage(error), ...(error instanceof BacklogError && error.claim !== undefined ? { claim: error.claim } : {}) };
  if (kind === "unavailable") reply.log.error({ err: error }, "backlog request failed");
  return reply.code({ "invalid-request": 400, "not-found": 404, conflict: 409, unavailable: 503 }[kind]).send(body);
}
