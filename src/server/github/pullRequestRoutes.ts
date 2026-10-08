import { Type } from "typebox";
import { Check } from "typebox/value";
import type { FastifyInstance, FastifyReply } from "fastify";
import { PullErrorSchema, PullLinkSchema, SessionPullResponseSchema } from "../../shared/pullRequests.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { PullRequestService } from "./pullRequestService.js";

const NumberSchema = Type.Integer({ minimum: 1 });
const LinkBody = Type.Object({ cwd: Type.String({ minLength: 1, maxLength: 32768 }), number: NumberSchema }, { additionalProperties: false });
const WatchBody = Type.Object({ cwd: Type.String({ minLength: 1, maxLength: 32768 }), number: Type.Optional(NumberSchema) }, { additionalProperties: false });
const MergeBody = Type.Object({ repo: Type.String({ minLength: 3, maxLength: 512 }), number: NumberSchema, cwd: Type.String({ minLength: 1, maxLength: 32768 }), headSha: Type.String({ pattern: "^[a-f0-9]{40}$" }), method: Type.Union([Type.Literal("rebase"), Type.Literal("squash"), Type.Literal("merge")]) }, { additionalProperties: false });
interface Params { sessionId: string }
interface Query { cwd?: string }

export function registerPullRequestRoutes(app: FastifyInstance, pulls: PullRequestService): void {
  const errors = { 400: PullErrorSchema, 502: PullErrorSchema };
  const ref = (id: string, cwd: string | undefined) => {
    if (id.length === 0 || id.length > 512 || cwd === undefined || cwd.length === 0 || cwd.length > 32768) throw new Error("A full session id and cwd are required.");
    return { id, cwd: normalizeRequestCwd(cwd) };
  };
  const failed = (reply: FastifyReply, error: unknown) => reply.code(400).send({ kind: "pull_request_error", error: error instanceof Error ? error.message : String(error) });
  app.get("/github/pulls", { schema: { response: { 200: Type.Object({ links: Type.Array(PullLinkSchema) }) } } }, () => pulls.catalog());
  app.get<{ Params: Params; Querystring: Query }>("/sessions/:sessionId/pull-request", { schema: { response: { 200: SessionPullResponseSchema, ...errors } } }, async (request, reply) => {
    try { return await pulls.read(ref(request.params.sessionId, request.query.cwd)); } catch (error) { return failed(reply, error); }
  });
  app.put<{ Params: Params; Body: unknown }>("/sessions/:sessionId/pull-request", { schema: { response: { 200: SessionPullResponseSchema, ...errors } } }, async (request, reply) => {
    try {
      if (!Check(LinkBody, request.body)) throw new Error("Send cwd and a positive PR number.");
      return await pulls.link(ref(request.params.sessionId, request.body.cwd), request.body.number);
    } catch (error) { return failed(reply, error); }
  });
  app.post<{ Params: Params; Body: unknown }>("/sessions/:sessionId/pull-request/watch", { schema: { response: { 200: PullLinkSchema, ...errors } } }, async (request, reply) => {
    try {
      if (!Check(WatchBody, request.body)) throw new Error("Send cwd and an optional PR number.");
      return await pulls.watch(ref(request.params.sessionId, request.body.cwd), request.body.number);
    } catch (error) { return failed(reply, error); }
  });
  app.delete<{ Params: Params; Querystring: Query }>("/sessions/:sessionId/pull-request/watch", { schema: { response: { 200: Type.Union([PullLinkSchema, Type.Null()]), ...errors } } }, async (request, reply) => {
    try { return await pulls.stopRef(ref(request.params.sessionId, request.query.cwd)) ?? null; } catch (error) { return failed(reply, error); }
  });
  app.post<{ Params: Params; Body: unknown }>("/sessions/:sessionId/pull-request/merge", { schema: { response: { 200: Type.Object({ text: Type.String(), url: Type.Optional(Type.String()) }), ...errors } } }, async (request, reply) => {
    try {
      if (!Check(MergeBody, request.body)) throw new Error("Send cwd, the confirmed repo, number, 40-character headSha, and method.");
      return await pulls.merge(ref(request.params.sessionId, request.body.cwd), request.body.headSha, request.body.method, { repo: request.body.repo, number: request.body.number });
    } catch (error) { return failed(reply, error); }
  });
}
