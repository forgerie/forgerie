import type { FastifyInstance, FastifyReply } from "fastify";
import { Type, type TSchema } from "typebox";
import { TriggerTargetsSchema, TriggerSchema, TriggerListResponseSchema, TriggerWorkflowsResponseSchema, TriggerRunResponseSchema, TriggerErrorResponseSchema, type TriggerErrorResponse, type TriggerRunRequest } from "../../shared/triggers.js";
import { TriggerFileDocumentSchema, TriggerFileVersionsResponseSchema, TriggerFileVersionTextSchema } from "../../shared/triggerFiles.js";
import { Check } from "typebox/value";
import { TriggerError } from "./durableTriggers.js";
import { triggerBody, type TriggerService } from "./triggerService.js";

const deleted = Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false });
const empty = Type.Object({}, { additionalProperties: false });
const query = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });

type TriggerRouteService = { [K in "list" | "get" | "workflows" | "commonWorkflows" | "create" | "update" | "pause" | "resume" | "acknowledge" | "run" | "remove" | "file" | "saveFile" | "versions" | "version"]: (...args: Parameters<TriggerService[K]>) => Promise<unknown> };

export function registerTriggerRoutes(app: FastifyInstance, service: TriggerRouteService, prefix = ""): void {
  // Parser failures must have the same error contract as domain failures.
  app.register((routes, _options, done) => {
    routes.setErrorHandler((error, _request, reply) => { void sendError(reply, typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500, { error: error instanceof Error ? error.message : String(error) }); });
    routes.get(`${prefix}/triggers`, (_request, reply) => run(reply, TriggerListResponseSchema, () => service.list()));
    routes.get<{ Querystring: unknown }>(`${prefix}/triggers/workflows`, (request, reply) => run(reply, TriggerWorkflowsResponseSchema, () => service.workflows(triggerBody(query, request.query).cwd)));
    routes.post<{ Body: unknown }>(`${prefix}/triggers/workflows/common`, (request, reply) => run(reply, TriggerWorkflowsResponseSchema, () => service.commonWorkflows(triggerBody(TriggerTargetsSchema, request.body))));
    routes.get<{ Params: { id: string } }>(`${prefix}/triggers/:id`, (request, reply) => run(reply, TriggerSchema, () => service.get(request.params.id)));
    routes.get<{ Params: { id: string } }>(`${prefix}/triggers/:id/file`, (request, reply) => run(reply, TriggerFileDocumentSchema, () => service.file(request.params.id)));
    routes.put<{ Params: { id: string }; Body: unknown }>(`${prefix}/triggers/:id/file`, (request, reply) => run(reply, TriggerFileDocumentSchema, () => service.saveFile(request.params.id, request.body)));
    routes.get<{ Params: { id: string } }>(`${prefix}/triggers/:id/versions`, (request, reply) => run(reply, TriggerFileVersionsResponseSchema, () => service.versions(request.params.id)));
    routes.get<{ Params: { id: string; versionId: string } }>(`${prefix}/triggers/:id/versions/:versionId`, (request, reply) => run(reply, TriggerFileVersionTextSchema, () => service.version(request.params.id, request.params.versionId)));
    routes.post<{ Body: unknown }>(`${prefix}/triggers`, (request, reply) => run(reply, TriggerSchema, () => service.create(request.body), 201));
    routes.patch<{ Params: { id: string }; Body: unknown }>(`${prefix}/triggers/:id`, (request, reply) => run(reply, TriggerSchema, () => service.update(request.params.id, request.body)));
    for (const action of ["pause", "resume", "acknowledge"] as const) {
      routes.post<{ Params: { id: string }; Body: unknown }>(`${prefix}/triggers/:id/${action}`, (request, reply) => run(reply, TriggerSchema, () => { triggerBody(empty, request.body); return service[action](request.params.id); }));
    }
    routes.post<{ Params: { id: string }; Body: TriggerRunRequest }>(`${prefix}/triggers/:id/run`, (request, reply) => run(reply, TriggerRunResponseSchema, () => service.run(request.params.id, request.body), 202));
    routes.delete<{ Params: { id: string }; Body: unknown }>(`${prefix}/triggers/:id`, (request, reply) => run(reply, deleted, async () => { if (request.body !== undefined) triggerBody(empty, request.body); await service.remove(request.params.id); return { ok: true }; }));
    done();
  });
}
async function run(reply: FastifyReply, schema: TSchema, action: () => Promise<unknown>, status = 200): Promise<unknown> {
  try {
    const value = await action();
    if (!Check(schema, value)) throw new Error("Invalid trigger route response");
    return await reply.code(status).send(value);
  }
  catch (error) {
    const response: TriggerErrorResponse = { error: error instanceof Error ? error.message : String(error), ...(error instanceof TriggerError && error.field !== undefined ? { field: error.field } : {}), ...(error instanceof TriggerError && error.line !== undefined ? { line: error.line } : {}) };
    return sendError(reply, error instanceof TriggerError ? error.status : 500, response);
  }
}

function sendError(reply: FastifyReply, status: number, value: unknown): FastifyReply {
  if (!Check(TriggerErrorResponseSchema, value)) { status = 500; value = { error: "Invalid trigger error response" }; }
  if (!Check(TriggerErrorResponseSchema, value)) throw new Error("Invalid trigger error response");
  return reply.code(status).send(value);
}
