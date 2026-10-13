import type { FastifyInstance, FastifyReply } from "fastify";
import { Check } from "typebox/value";
import { BacklogDetailResponseSchema, BacklogErrorSchema, BacklogItemQuerySchema, BacklogListQuerySchema, BacklogLaunchRequestSchema, BacklogLaunchResponseSchema, BacklogListResponseSchema, BacklogReleaseRequestSchema, BacklogReleaseResponseSchema } from "../../shared/backlog.js";
import type { BacklogErrorResponse, BacklogProviderId } from "../../shared/apiTypes.js";
import { BacklogError, backlogErrorMessage } from "./backlogError.js";
import type { BacklogService } from "./backlogService.js";

export function registerBacklogRoutes(app: FastifyInstance, backlog: BacklogService, prefix = ""): void {
  const errors = { 400: BacklogErrorSchema, 404: BacklogErrorSchema, 409: BacklogErrorSchema, 503: BacklogErrorSchema };
  app.get<{ Querystring: unknown }>(`${prefix}/backlog`, { schema: { response: { 200: BacklogListResponseSchema, ...errors } } }, async (request, reply) => {
    try { if (!Check(BacklogListQuerySchema, request.query)) throw new BacklogError("invalid-request", "Invalid backlog scope"); return await backlog.list(request.query.scope); } catch (error) { return sendError(reply, error); }
  });
  const sourcePath = `${prefix}/backlog/sources/:sourceId/items/:itemId`;
  const sourceQuery = (query: unknown) => {
    const provider = providerOf(query);
    if (provider !== undefined && provider !== "azure-devops") throw new BacklogError("not-found", "This source lists Azure DevOps items only");
    return scopeOf(query);
  };
  app.get<{ Params: { sourceId: string; itemId: string }; Querystring: unknown }>(sourcePath, { schema: { response: { 200: BacklogDetailResponseSchema, ...errors } } }, async (request, reply) => {
    try { return await backlog.detailSource(request.params.sourceId, request.params.itemId, sourceQuery(request.query)); }
    catch (error) { return sendError(reply, error); }
  });
  app.post<{ Params: { sourceId: string; itemId: string }; Querystring: unknown; Body: unknown }>(`${sourcePath}/launch`, { schema: { response: { 200: BacklogLaunchResponseSchema, ...errors } } }, async (request, reply) => {
    try {
      const scope = sourceQuery(request.query);
      if (!Check(BacklogLaunchRequestSchema, request.body)) throw new BacklogError("invalid-request", "Invalid backlog launch request");
      return await backlog.launchSource(request.params.sourceId, request.params.itemId, request.body, scope);
    } catch (error) { return sendError(reply, error); }
  });
  app.post<{ Params: { sourceId: string; itemId: string }; Querystring: unknown; Body: unknown }>(`${sourcePath}/release`, { schema: { response: { 200: BacklogReleaseResponseSchema, ...errors } } }, async (request, reply) => {
    try {
      sourceQuery(request.query);
      if (!Check(BacklogReleaseRequestSchema, request.body)) throw new BacklogError("invalid-request", "claimId is required to release a claim");
      return await backlog.releaseSource(request.params.sourceId, request.params.itemId, request.body);
    } catch (error) { return sendError(reply, error); }
  });
  // `?provider=` selects where the item comes from. Omitted means markdown, so pre-provider clients keep working.
  const itemPath = `${prefix}/backlog/:projectId/items/:itemId`;
  app.get<{ Params: { projectId: string; itemId: string }; Querystring: unknown }>(itemPath, { schema: { response: { 200: BacklogDetailResponseSchema, ...errors } } }, async (request, reply) => {
    try { return await backlog.detail(request.params.projectId, request.params.itemId, providerOf(request.query), scopeOf(request.query)); }
    catch (error) { return sendError(reply, error); }
  });
  app.post<{ Params: { projectId: string; itemId: string }; Querystring: unknown; Body: unknown }>(`${itemPath}/launch`, { schema: { response: { 200: BacklogLaunchResponseSchema, ...errors } } }, async (request, reply) => {
    try {
      const provider = providerOf(request.query);
      if (!Check(BacklogLaunchRequestSchema, request.body)) throw new BacklogError("invalid-request", "Invalid backlog launch request");
      return await backlog.launch(request.params.projectId, request.params.itemId, request.body, provider, scopeOf(request.query));
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
function scopeOf(query: unknown) {
  if (!Check(BacklogItemQuerySchema, query)) throw new BacklogError("invalid-request", "Invalid backlog scope");
  return query.scope;
}
function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  const kind = error instanceof BacklogError ? error.kind : "unavailable";
  const body: BacklogErrorResponse = { kind, error: backlogErrorMessage(error), ...(error instanceof BacklogError && error.claim !== undefined ? { claim: error.claim } : {}) };
  if (kind === "unavailable") reply.log.error({ err: error }, "backlog request failed");
  return reply.code({ "invalid-request": 400, "not-found": 404, conflict: 409, unavailable: 503 }[kind]).send(body);
}
