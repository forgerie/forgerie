import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";
import type { TriggerErrorResponse, TriggerRunRequest } from "../../shared/triggers.js";
import { TriggerError } from "./durableTriggers.js";
import { triggerBody, type TriggerService } from "./triggerService.js";

const empty = Type.Object({}, { additionalProperties: false });
const query = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });

export function registerTriggerRoutes(app: FastifyInstance, service: TriggerService, prefix = ""): void {
  // Parser failures must have the same error contract as domain failures.
  app.register((routes, _options, done) => {
    routes.setErrorHandler((error, _request, reply) => { void reply.code(typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500).send({ error: error instanceof Error ? error.message : String(error) }); });
    routes.get(`${prefix}/triggers`, (_request, reply) => run(reply, () => service.list()));
    routes.get<{ Querystring: unknown }>(`${prefix}/triggers/workflows`, (request, reply) => run(reply, () => service.workflows(triggerBody(query, request.query).cwd)));
    routes.get<{ Params: { id: string } }>(`${prefix}/triggers/:id`, (request, reply) => run(reply, () => service.get(request.params.id)));
    routes.post<{ Body: unknown }>(`${prefix}/triggers`, (request, reply) => run(reply, () => service.create(request.body), 201));
    routes.patch<{ Params: { id: string }; Body: unknown }>(`${prefix}/triggers/:id`, (request, reply) => run(reply, () => service.update(request.params.id, request.body)));
    for (const action of ["pause", "resume", "acknowledge"] as const) {
      routes.post<{ Params: { id: string }; Body: unknown }>(`${prefix}/triggers/:id/${action}`, (request, reply) => run(reply, () => { triggerBody(empty, request.body); return service[action](request.params.id); }));
    }
    routes.post<{ Params: { id: string }; Body: TriggerRunRequest }>(`${prefix}/triggers/:id/run`, (request, reply) => run(reply, () => service.run(request.params.id, request.body), 202));
    routes.delete<{ Params: { id: string }; Body: unknown }>(`${prefix}/triggers/:id`, (request, reply) => run(reply, async () => { if (request.body !== undefined) triggerBody(empty, request.body); await service.remove(request.params.id); return { ok: true }; }));
    done();
  });
}
async function run(reply: FastifyReply, action: () => Promise<unknown>, status = 200): Promise<unknown> {
  try { return await reply.code(status).send(await action()); }
  catch (error) {
    const response: TriggerErrorResponse = { error: error instanceof Error ? error.message : String(error), ...(error instanceof TriggerError && error.field !== undefined ? { field: error.field } : {}) };
    return reply.code(error instanceof TriggerError ? error.status : 500).send(response);
  }
}
