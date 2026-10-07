import type { FastifyInstance, FastifyReply } from "fastify";
import { Check } from "typebox/value";
import { GitHubAppStatusSchema, GitHubCreatedRequestSchema, GitHubErrorSchema, GitHubSetupRequestSchema, GitHubSetupStartSchema } from "../../shared/github.js";
import { GitHubAppError, type GitHubApp } from "./githubApp.js";

/** Setup routes for Forgerie's GitHub App. No reply carries the app's key or a token. */
export function registerGitHubRoutes(app: FastifyInstance, github: GitHubApp): void {
  const errors = { 400: GitHubErrorSchema, 502: GitHubErrorSchema };
  app.get("/github/app", { schema: { response: { 200: GitHubAppStatusSchema } } }, () => github.status());
  app.post<{ Body: unknown }>("/github/app/setup", { schema: { response: { 200: GitHubSetupStartSchema, ...errors } } }, (request, reply) => {
    if (!Check(GitHubSetupRequestSchema, request.body)) return reply.code(400).send({ error: "Send the page's origin, such as https://forgerie.example.ts.net." });
    try { return github.startSetup(request.body.origin); } catch (error) { return failed(reply, error); }
  });
  app.post<{ Body: unknown }>("/github/app/created", { schema: { response: { 200: GitHubAppStatusSchema, ...errors } } }, async (request, reply) => {
    if (!Check(GitHubCreatedRequestSchema, request.body)) return reply.code(400).send({ error: "This is not a GitHub setup reply. Start the setup again." });
    try { return await github.finishSetup(request.body); } catch (error) { return failed(reply, error); }
  });
  app.delete("/github/app", { schema: { response: { 200: GitHubAppStatusSchema } } }, () => github.remove());
}

function failed(reply: FastifyReply, error: unknown): FastifyReply {
  // A setup the person must restart is a 400; GitHub being unreachable is a bad gateway.
  return reply.code(error instanceof GitHubAppError ? 400 : 502).send({ error: error instanceof Error ? error.message : String(error) });
}
