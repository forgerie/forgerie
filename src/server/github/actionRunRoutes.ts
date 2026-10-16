import { Type } from "typebox";
import { Check } from "typebox/value";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ActionRunErrorSchema, ActionRunLinkSchema, SessionActionRunResponseSchema, SessionActionRunsResponseSchema } from "../../shared/actionRuns.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { ActionRunService } from "./actionRunService.js";

const NumberSchema = Type.Integer({ minimum: 1 });
const Cwd = Type.String({ minLength: 1, maxLength: 32768 });
const LinkBody = Type.Object({ cwd: Cwd, run: Type.Union([NumberSchema, Type.String({ minLength: 1, maxLength: 2048 })]) }, { additionalProperties: false });
const CwdBody = Type.Object({ cwd: Cwd }, { additionalProperties: false });
interface Params { sessionId: string }
interface RunParams extends Params { runId: string }
interface Query { cwd?: string }

/**
 * A session can link several runs. The collection lives at
 * `/sessions/:id/action-runs`; one run at `.../action-runs/:runId`.
 */
export function registerActionRunRoutes(app: FastifyInstance, runs: ActionRunService): void {
  const errors = { 400: ActionRunErrorSchema, 502: ActionRunErrorSchema };
  const ref = (id: string, cwd: string | undefined) => {
    if (id.length === 0 || id.length > 512 || cwd === undefined || cwd.length === 0 || cwd.length > 32768) throw new Error("A full session id and cwd are required.");
    return { id, cwd: normalizeRequestCwd(cwd) };
  };
  const runIdOf = (value: string) => {
    if (!/^[1-9]\d*$/.test(value)) throw new Error("Use a positive run ID.");
    if (!Number.isSafeInteger(Number(value))) throw new Error("Use a safe integer run ID.");
    return Number(value);
  };
  const failed = (reply: FastifyReply, error: unknown) => reply.code(400).send({ kind: "action_run_error", error: error instanceof Error ? error.message : String(error) });
  const base = "/sessions/:sessionId/action-runs";
  app.get("/github/action-runs", { schema: { response: { 200: Type.Object({ links: Type.Array(ActionRunLinkSchema) }) } } }, () => runs.catalog());
  app.get<{ Params: Params; Querystring: Query }>(base, { schema: { response: { 200: SessionActionRunsResponseSchema, ...errors } } }, async (request, reply) => {
    try { return await runs.list(ref(request.params.sessionId, request.query.cwd)); } catch (error) { return failed(reply, error); }
  });
  app.put<{ Params: Params; Body: unknown }>(base, { schema: { response: { 200: SessionActionRunResponseSchema, ...errors } } }, async (request, reply) => {
    try {
      if (!Check(LinkBody, request.body)) throw new Error("Send cwd and a positive run ID.");
      return await runs.link(ref(request.params.sessionId, request.body.cwd), request.body.run);
    } catch (error) { return failed(reply, error); }
  });
  app.get<{ Params: RunParams; Querystring: Query }>(`${base}/:runId`, { schema: { response: { 200: SessionActionRunResponseSchema, ...errors } } }, async (request, reply) => {
    try { return await runs.read(ref(request.params.sessionId, request.query.cwd), runIdOf(request.params.runId)); } catch (error) { return failed(reply, error); }
  });
  app.delete<{ Params: RunParams; Querystring: Query }>(`${base}/:runId`, { schema: { response: { 200: ActionRunLinkSchema, ...errors } } }, async (request, reply) => {
    try { return await runs.unlink(ref(request.params.sessionId, request.query.cwd), runIdOf(request.params.runId)); } catch (error) { return failed(reply, error); }
  });
  app.post<{ Params: RunParams; Body: unknown }>(`${base}/:runId/watch`, { schema: { response: { 200: ActionRunLinkSchema, ...errors } } }, async (request, reply) => {
    try {
      if (!Check(CwdBody, request.body)) throw new Error("Send cwd.");
      return await runs.watch(ref(request.params.sessionId, request.body.cwd), runIdOf(request.params.runId));
    } catch (error) { return failed(reply, error); }
  });
  app.delete<{ Params: RunParams; Querystring: Query }>(`${base}/:runId/watch`, { schema: { response: { 200: ActionRunLinkSchema, ...errors } } }, async (request, reply) => {
    try {
      const stopped = await runs.stopRef(ref(request.params.sessionId, request.query.cwd), runIdOf(request.params.runId));
      if (stopped === undefined || Array.isArray(stopped)) throw new Error("No such run link.");
      return stopped;
    } catch (error) { return failed(reply, error); }
  });
}
