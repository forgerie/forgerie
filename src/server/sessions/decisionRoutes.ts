import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { DecisionOverturnSchema, type Decision } from "../../shared/decisions.js";
import type { SessionRouteRef } from "./sessionService.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import { WorkflowError } from "../resources/workflowLibrary.js";

export interface DecisionRouteService {
  decisions(ref: SessionRouteRef): Promise<Decision[]>;
  overturnDecision(ref: SessionRouteRef, id: string, note: string): Promise<Decision>;
}
const query = Type.Object({ cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });
export function registerDecisionRoutes(app: FastifyInstance, service: DecisionRouteService, prefix = ""): void {
  app.get<{ Params: { sessionId: string }; Querystring: unknown }>(`${prefix}/sessions/:sessionId/decisions`, (request, reply) => run(reply, () => {
    if (!Check(query, request.query)) throw new WorkflowError(400, "Only a nonempty cwd query is accepted");
    return service.decisions({ id: request.params.sessionId, cwd: normalizeRequestCwd(request.query.cwd) });
  }));
  app.post<{ Params: { sessionId: string; decisionId: string }; Body: unknown }>(`${prefix}/sessions/:sessionId/decisions/:decisionId/overturn`, (request, reply) => run(reply, () => {
    if (!Check(DecisionOverturnSchema, request.body) || request.body.note.trim() === "") throw new WorkflowError(400, "A nonblank correction and cwd are required");
    return service.overturnDecision({ id: request.params.sessionId, cwd: normalizeRequestCwd(request.body.cwd) }, request.params.decisionId, request.body.note);
  }));
}
async function run(reply: FastifyReply, action: () => Promise<unknown>): Promise<unknown> {
  try { return await action(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof WorkflowError ? error.status : /session not found|does not host/i.test(message) ? 404
      : /read.only|preparing|navigation|durableChildren/i.test(message) ? 409 : 500;
    return reply.code(status).send({ error: message });
  }
}
