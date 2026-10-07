import type { FastifyInstance, FastifyReply } from "fastify";
import { Check } from "typebox/value";
import { GitHubAppSchema, GitHubAuthErrorSchema, GitHubAuthStatusSchema } from "../../shared/github.js";
import { GitHubAuthError, type GitHubAuth } from "./githubAuth.js";

/** Login routes. Every reply is a status without tokens; the tokens stay in the session daemon. */
export function registerGitHubRoutes(app: FastifyInstance, auth: GitHubAuth): void {
  const replies = { response: { 200: GitHubAuthStatusSchema, 400: GitHubAuthErrorSchema, 502: GitHubAuthErrorSchema } };
  app.get("/github/auth", { schema: replies }, () => auth.status());
  app.put<{ Body: unknown }>("/github/app", { schema: replies }, async (request, reply) => {
    if (!Check(GitHubAppSchema, request.body)) return reply.code(400).send({ error: "Send the GitHub App's client ID, and optionally its slug from https://github.com/apps/<slug>." });
    return auth.configure(request.body);
  });
  app.post("/github/auth/login", { schema: replies }, async (_request, reply) => {
    try { return await auth.startLogin(); } catch (error) { return failed(reply, error); }
  });
  app.delete("/github/auth", { schema: replies }, () => auth.disconnect());
}

function failed(reply: FastifyReply, error: unknown): FastifyReply {
  // A refusal the user can fix is a 400; GitHub being unreachable is a bad gateway.
  const message = error instanceof Error ? error.message : String(error);
  return reply.code(error instanceof GitHubAuthError ? 400 : 502).send({ error: message });
}
