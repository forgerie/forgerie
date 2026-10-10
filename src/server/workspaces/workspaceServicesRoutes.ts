import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { WorkspaceServiceActionSchema, WorkspaceServicesWaitSchema } from "../../shared/workspaceServices.js";
import type { WorkspaceServices } from "./workspaceServices.js";

const logsQuery = Type.Object({ service: Type.String({ minLength: 1, maxLength: 256 }), lines: Type.Integer({ minimum: 1, maximum: 200 }) }, { additionalProperties: false });
export function registerWorkspaceServicesRoutes(app: FastifyInstance, services: WorkspaceServices): void {
  const path = "/sessions/worktrees/:worktreeId/services";
  app.get<{ Params: { worktreeId: string } }>(path, async (request, reply) => {
    try { return await services.status(request.params.worktreeId); }
    catch (error) { return reply.code(409).send({ error: message(error) }); }
  });
  app.post<{ Params: { worktreeId: string }; Body: unknown }>(path, async (request, reply) => {
    if (!Check(WorkspaceServiceActionSchema, request.body)) return reply.code(400).send({ error: "Invalid workspace service action" });
    try { return await services.action(request.params.worktreeId, request.body); }
    catch (error) { return reply.code(409).send({ error: message(error) }); }
  });
  app.get<{ Params: { worktreeId: string }; Querystring: { service?: string; lines?: string } }>(`${path}/logs`, async (request, reply) => {
    const input = { ...request.query, lines: request.query.lines === undefined ? 50 : Number(request.query.lines) };
    if (!Check(logsQuery, input)) return reply.code(400).send({ error: "A service and lines from 1 to 200 are required" });
    try { return await services.logs(request.params.worktreeId, input.service, input.lines); }
    catch (error) { return reply.code(409).send({ error: message(error) }); }
  });
  app.post<{ Params: { worktreeId: string }; Body: unknown }>(`${path}/wait`, async (request, reply) => {
    if (!Check(WorkspaceServicesWaitSchema, request.body)) return reply.code(400).send({ error: "A readiness deadline from 1 to 120000 ms is required" });
    const controller = new AbortController();
    const abort = () => { controller.abort(); };
    // Response close, unlike request close, distinguishes a disconnected client from a consumed request body.
    reply.raw.once("close", abort);
    try { return await services.wait(request.params.worktreeId, request.body, controller.signal); }
    catch (error) { return await reply.code(409).send({ error: message(error) }); }
    finally { reply.raw.off("close", abort); }
  });
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
