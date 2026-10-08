import { Type } from "typebox";
import { Check } from "typebox/value";
import type { FastifyInstance, FastifyReply } from "fastify";
import { PullErrorSchema, PullLinkSchema, SessionPullResponseSchema, SessionPullsResponseSchema } from "../../shared/pullRequests.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { PullRequestService } from "./pullRequestService.js";

const NumberSchema = Type.Integer({ minimum: 1 });
const Cwd = Type.String({ minLength: 1, maxLength: 32768 });
const LinkBody = Type.Object({ cwd: Cwd, number: NumberSchema }, { additionalProperties: false });
const CwdBody = Type.Object({ cwd: Cwd }, { additionalProperties: false });
const MergeBody = Type.Object({ repo: Type.String({ minLength: 3, maxLength: 512 }), cwd: Cwd, headSha: Type.String({ pattern: "^[a-f0-9]{40}$" }), method: Type.Union([Type.Literal("rebase"), Type.Literal("squash"), Type.Literal("merge")]) }, { additionalProperties: false });
interface Params { sessionId: string }
interface PullParams extends Params { number: string }
interface Query { cwd?: string }

/**
 * A session can link several pull requests. The collection lives at
 * `/sessions/:id/pull-requests`; one pull request at `.../pull-requests/:number`.
 */
export function registerPullRequestRoutes(app: FastifyInstance, pulls: PullRequestService): void {
  const errors = { 400: PullErrorSchema, 502: PullErrorSchema };
  const ref = (id: string, cwd: string | undefined) => {
    if (id.length === 0 || id.length > 512 || cwd === undefined || cwd.length === 0 || cwd.length > 32768) throw new Error("A full session id and cwd are required.");
    return { id, cwd: normalizeRequestCwd(cwd) };
  };
  const numberOf = (value: string) => {
    if (!/^[1-9]\d{0,9}$/.test(value)) throw new Error("Use a positive PR number.");
    return Number(value);
  };
  const failed = (reply: FastifyReply, error: unknown) => reply.code(400).send({ kind: "pull_request_error", error: error instanceof Error ? error.message : String(error) });
  const base = "/sessions/:sessionId/pull-requests";
  app.get("/github/pulls", { schema: { response: { 200: Type.Object({ links: Type.Array(PullLinkSchema) }) } } }, () => pulls.catalog());
  app.get<{ Params: Params; Querystring: Query }>(base, { schema: { response: { 200: SessionPullsResponseSchema, ...errors } } }, async (request, reply) => {
    try { return await pulls.list(ref(request.params.sessionId, request.query.cwd)); } catch (error) { return failed(reply, error); }
  });
  app.put<{ Params: Params; Body: unknown }>(base, { schema: { response: { 200: SessionPullResponseSchema, ...errors } } }, async (request, reply) => {
    try {
      if (!Check(LinkBody, request.body)) throw new Error("Send cwd and a positive PR number.");
      return await pulls.link(ref(request.params.sessionId, request.body.cwd), request.body.number);
    } catch (error) { return failed(reply, error); }
  });
  app.get<{ Params: PullParams; Querystring: Query }>(`${base}/:number`, { schema: { response: { 200: SessionPullResponseSchema, ...errors } } }, async (request, reply) => {
    try { return await pulls.read(ref(request.params.sessionId, request.query.cwd), numberOf(request.params.number)); } catch (error) { return failed(reply, error); }
  });
  app.delete<{ Params: PullParams; Querystring: Query }>(`${base}/:number`, { schema: { response: { 200: PullLinkSchema, ...errors } } }, async (request, reply) => {
    try { return await pulls.unlink(ref(request.params.sessionId, request.query.cwd), numberOf(request.params.number)); } catch (error) { return failed(reply, error); }
  });
  app.post<{ Params: PullParams; Body: unknown }>(`${base}/:number/watch`, { schema: { response: { 200: PullLinkSchema, ...errors } } }, async (request, reply) => {
    try {
      if (!Check(CwdBody, request.body)) throw new Error("Send cwd.");
      return await pulls.watch(ref(request.params.sessionId, request.body.cwd), numberOf(request.params.number));
    } catch (error) { return failed(reply, error); }
  });
  app.delete<{ Params: PullParams; Querystring: Query }>(`${base}/:number/watch`, { schema: { response: { 200: PullLinkSchema, ...errors } } }, async (request, reply) => {
    try {
      const stopped = await pulls.stopRef(ref(request.params.sessionId, request.query.cwd), numberOf(request.params.number));
      if (stopped === undefined || Array.isArray(stopped)) throw new Error("No such pull request link.");
      return stopped;
    } catch (error) { return failed(reply, error); }
  });
  app.post<{ Params: PullParams; Body: unknown }>(`${base}/:number/merge`, { schema: { response: { 200: Type.Object({ text: Type.String(), url: Type.Optional(Type.String()) }), ...errors } } }, async (request, reply) => {
    try {
      if (!Check(MergeBody, request.body)) throw new Error("Send cwd, the confirmed repo, 40-character headSha, and method.");
      const number = numberOf(request.params.number);
      return await pulls.merge(ref(request.params.sessionId, request.body.cwd), request.body.headSha, request.body.method, { repo: request.body.repo, number });
    } catch (error) { return failed(reply, error); }
  });
}
