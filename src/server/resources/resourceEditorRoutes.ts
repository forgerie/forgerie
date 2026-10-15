import { BrowserFileAccessError } from "../browserFileAccess.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Check } from "typebox/value";
import { RESOURCE_EDITOR_BODY_LIMIT, ResourceEditorDeleteRequestSchema, ResourceEditorDeleteSchema, ResourceEditorSaveRequestSchema, type ResourceEditorErrorResponse } from "../../shared/resourceEditor.js";
import { ResourceEditorError } from "./resourceEditorFiles.js";
import type { ResourceEditorService } from "./resourceEditorService.js";

const ERROR_STATUS: Record<ResourceEditorErrorResponse["error"]["kind"], number> = {
  "invalid-request": 400, "not-found": 404, "read-only": 403, "conflict": 409, "over-limit": 413,
  "unsafe-git-state": 409, "commit-failed": 409, "io-error": 500, "busy": 503,
};

export function registerResourceEditorRoutes(app: FastifyInstance, service: ResourceEditorService): void {
  for (const base of ["/resources", "/sessions/:sessionId/resources"]) {
    app.get<{ Params: { sessionId?: string }; Querystring: Record<string, unknown> }>(base, (request, reply) => respond(reply, async () => {
      rejectQuery(request.query);
      return service.inventory(sessionId(request.params.sessionId));
    }));
    app.get<{ Params: { sessionId?: string; resourceId: string }; Querystring: Record<string, unknown> }>(`${base}/:resourceId`, (request, reply) => respond(reply, async () => {
      rejectQuery(request.query);
      return service.read(resourceId(request.params.resourceId), sessionId(request.params.sessionId));
    }));
    app.put<{ Params: { sessionId?: string; resourceId: string }; Querystring: Record<string, unknown>; Body: unknown }>(`${base}/:resourceId`, { bodyLimit: RESOURCE_EDITOR_BODY_LIMIT }, (request, reply) => respond(reply, async () => {
      rejectQuery(request.query);
      if (!Check(ResourceEditorSaveRequestSchema, request.body)) throw new ResourceEditorError("invalid-request", "Send text and the baseRevision from the file read. No other fields are accepted.");
      return service.save(resourceId(request.params.resourceId), request.body, sessionId(request.params.sessionId));
    }));
    app.delete<{ Params: { sessionId?: string; resourceId: string }; Querystring: Record<string, unknown>; Body: unknown }>(`${base}/:resourceId`, { bodyLimit: RESOURCE_EDITOR_BODY_LIMIT, schema: { response: { 200: ResourceEditorDeleteSchema } } }, (request, reply) => respond(reply, async () => {
      rejectQuery(request.query);
      if (!Check(ResourceEditorDeleteRequestSchema, request.body)) throw new ResourceEditorError("invalid-request", "Send only baseRevision from the prompt file read.");
      return service.delete(resourceId(request.params.resourceId), request.body, sessionId(request.params.sessionId));
    }));
  }
}
function resourceId(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new ResourceEditorError("invalid-request", "resourceId must come from this inventory.");
  return value;
}
function sessionId(value: string | undefined): string | undefined {
  if (value !== undefined && (value.length === 0 || value.length > 512)) throw new ResourceEditorError("invalid-request", "Invalid sessionId.");
  return value;
}
function rejectQuery(query: Record<string, unknown>): void {
  if (Object.keys(query).length > 0) throw new ResourceEditorError("invalid-request", "This API resolves the profile and session checkout on the server. Query parameters are not accepted.");
}
async function respond(reply: FastifyReply, operation: () => Promise<unknown>): Promise<unknown> {
  try { return await operation(); }
  catch (error) {
    const failure = error instanceof BrowserFileAccessError ? new ResourceEditorError("read-only", error.message) : error instanceof ResourceEditorError ? error : new ResourceEditorError("io-error", error instanceof Error ? error.message : String(error));
    if (failure.kind === "io-error") reply.log.error({ err: error }, "resource editor operation failed");
    if (failure.kind === "busy") reply.header("retry-after", "1");
    return reply.code(ERROR_STATUS[failure.kind]).send({ error: { kind: failure.kind, message: failure.message, savedToDisk: failure.savedToDisk } } satisfies ResourceEditorErrorResponse);
  }
}
