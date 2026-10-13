import type { FastifyInstance } from "fastify";
import { Check } from "typebox/value";
import { BacklogGitHubLoginRequestSchema, BacklogSettingsDeleteSchema, BacklogSettingsResponseSchema, BacklogSettingsSaveSchema, type BacklogSettingsResponse } from "../../shared/backlogSettings.js";
import type { ProjectService } from "../projects/projectService.js";
import { canonicalBacklogRoot } from "./backlogScanner.js";
import { resolveBacklogConfig } from "./backlogConfig.js";
import { BacklogSettingsConflict, type BacklogSettingsStore } from "./backlogSettingsStore.js";
export function registerBacklogSettingsRoutes(app: FastifyInstance, store: BacklogSettingsStore, projects: Pick<ProjectService, "list" | "requireProject">): void {
  const list = async (): Promise<BacklogSettingsResponse> => {
    const file = await store.read();
    return { ...(file.githubLogin === undefined ? {} : { githubLogin: file.githubLogin }), projects: await Promise.all((await projects.list()).map(async (project) => resolveBacklogConfig(project, await canonicalBacklogRoot(project.path), store))) };
  };
  app.get("/backlog/settings", { schema: { response: { 200: BacklogSettingsResponseSchema } } }, list);
  app.put<{ Params: { projectId: string }; Body: unknown }>("/backlog/settings/projects/:projectId", async (request, reply) => {
    try {
      if (!Check(BacklogSettingsSaveSchema, request.body)) throw new Error("Invalid backlog settings request.");
      await projects.requireProject(request.params.projectId);
      await store.save(request.params.projectId, request.body.backlog, request.body.baseRevision);
      return { saved: true };
    } catch (error) { return reply.code(error instanceof BacklogSettingsConflict ? 409 : 400).send({ error: error instanceof Error ? error.message : "Could not save backlog settings." }); }
  });
  app.delete<{ Params: { projectId: string }; Body: unknown }>("/backlog/settings/projects/:projectId", async (request, reply) => {
    try {
      if (!Check(BacklogSettingsDeleteSchema, request.body)) throw new Error("Invalid backlog settings request.");
      await projects.requireProject(request.params.projectId);
      await store.remove(request.params.projectId, request.body.baseRevision); return { removed: true };
    } catch (error) { return reply.code(error instanceof BacklogSettingsConflict ? 409 : 400).send({ error: error instanceof Error ? error.message : "Could not remove backlog settings." }); }
  });
  app.put<{ Body: unknown }>("/backlog/settings/github-login", async (request, reply) => {
    try { if (!Check(BacklogGitHubLoginRequestSchema, request.body)) throw new Error("Invalid GitHub username."); await store.setGitHubLogin(request.body.githubLogin); return { saved: true }; }
    catch { return reply.code(400).send({ error: "Invalid GitHub username." }); }
  });
}
