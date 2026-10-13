import type { FastifyInstance } from "fastify";
import { Check } from "typebox/value";
import { BacklogGitHubLoginRequestSchema, BacklogSettingsDeleteSchema, BacklogSettingsResponseSchema, BacklogSettingsSaveSchema, type BacklogSettingsResponse } from "../../shared/backlogSettings.js";
import { BacklogSourceCreateSchema, BacklogSourceSaveSchema, BacklogSourceDeleteSchema, BacklogSourceSchema, sourceWarnings, type BacklogSourceInput, type BacklogSourceSettings } from "../../shared/backlogSources.js";
import { BacklogErrorSchema } from "../../shared/backlog.js";
import type { ProjectService } from "../projects/projectService.js";
import { canonicalBacklogRoot } from "./backlogScanner.js";
import { resolveBacklogConfig } from "./backlogConfig.js";
import { BacklogSettingsConflict, BacklogSettingsUnavailable, type BacklogSettingsStore } from "./backlogSettingsStore.js";
export function registerBacklogSettingsRoutes(app: FastifyInstance, store: BacklogSettingsStore, projects: Pick<ProjectService, "list" | "requireProject">): void {
  const list = async (): Promise<BacklogSettingsResponse> => {
    const file = await store.read();
    const snapshot = { read: () => Promise.resolve(file) };
    return { sources: Object.values(file.sources).map((source): BacklogSourceSettings => ({ ...source, warnings: sourceWarnings(source, Object.values(file.sources)) })), ...(file.githubLogin === undefined ? {} : { githubLogin: file.githubLogin }), projects: await Promise.all((await projects.list()).map(async (project) => {
      try { return await resolveBacklogConfig(project, () => canonicalBacklogRoot(project.path), snapshot); }
      catch { return { projectId: project.id, error: "Cannot read this project's backlog settings. Check its project folder and .forgerie/config.json, then reload." }; }
    })) };
  };
  app.get("/backlog/settings", { schema: { response: { 200: BacklogSettingsResponseSchema, 503: BacklogErrorSchema } } }, async (_request, reply) => {
    try { return await list(); }
    catch (error) {
      if (error instanceof BacklogSettingsUnavailable) return reply.code(503).send({ kind: "unavailable", error: error.message });
      throw error;
    }
  });
  const destination = async (input: BacklogSourceInput) => {
    if (input.destinationProjectId !== undefined) {
      if (!(await projects.list()).some((project) => project.id === input.destinationProjectId)) throw new Error("Destination project is not registered.");
    }
  };
  const sourceError = (error: unknown) => ({ kind: error instanceof BacklogSettingsConflict ? "conflict" : error instanceof BacklogSettingsUnavailable ? "unavailable" : "invalid-request", error: error instanceof Error ? error.message : "Could not save backlog source." });
  const sourceStatus = (error: unknown) => error instanceof BacklogSettingsConflict ? 409 : error instanceof BacklogSettingsUnavailable ? 503 : 400;
  app.post<{ Body: unknown }>("/backlog/settings/sources", { schema: { response: { 200: BacklogSourceSchema, 400: BacklogErrorSchema, 409: BacklogErrorSchema, 503: BacklogErrorSchema } } }, async (request, reply) => {
    try {
      if (!Check(BacklogSourceCreateSchema, request.body)) throw new Error("Invalid Azure DevOps source settings.");
      await destination(request.body); return await store.createSource(request.body);
    } catch (error) { return reply.code(sourceStatus(error)).send(sourceError(error)); }
  });
  app.put<{ Params: { id: string }; Body: unknown }>("/backlog/settings/sources/:id", { schema: { response: { 200: BacklogSourceSchema, 400: BacklogErrorSchema, 409: BacklogErrorSchema, 503: BacklogErrorSchema } } }, async (request, reply) => {
    try {
      if (!Check(BacklogSourceSaveSchema, request.body)) throw new Error("Invalid Azure DevOps source settings.");
      const { baseRevision, ...input } = request.body;
      await destination(input); return await store.saveSource(request.params.id, input, baseRevision);
    } catch (error) { return reply.code(sourceStatus(error)).send(sourceError(error)); }
  });
  app.delete<{ Params: { id: string }; Body: unknown }>("/backlog/settings/sources/:id", async (request, reply) => {
    try {
      if (!Check(BacklogSourceDeleteSchema, request.body)) throw new Error("Invalid source deletion request.");
      await store.removeSource(request.params.id, request.body.baseRevision); return { removed: true };
    } catch (error) { return reply.code(sourceStatus(error)).send(sourceError(error)); }
  });
  app.put<{ Params: { projectId: string }; Body: unknown }>("/backlog/settings/projects/:projectId", async (request, reply) => {
    try {
      if (!Check(BacklogSettingsSaveSchema, request.body)) throw new Error("Invalid backlog settings request.");
      await projects.requireProject(request.params.projectId);
      await store.save(request.params.projectId, request.body.backlog, request.body.baseRevision);
      return { saved: true };
    } catch (error) { return reply.code(error instanceof BacklogSettingsConflict ? 409 : error instanceof BacklogSettingsUnavailable ? 503 : 400).send({ error: error instanceof Error ? error.message : "Could not save backlog settings." }); }
  });
  app.delete<{ Params: { projectId: string }; Body: unknown }>("/backlog/settings/projects/:projectId", async (request, reply) => {
    try {
      if (!Check(BacklogSettingsDeleteSchema, request.body)) throw new Error("Invalid backlog settings request.");
      await projects.requireProject(request.params.projectId);
      await store.remove(request.params.projectId, request.body.baseRevision); return { removed: true };
    } catch (error) { return reply.code(error instanceof BacklogSettingsConflict ? 409 : error instanceof BacklogSettingsUnavailable ? 503 : 400).send({ error: error instanceof Error ? error.message : "Could not remove backlog settings." }); }
  });
  app.put<{ Body: unknown }>("/backlog/settings/github-login", async (request, reply) => {
    try { if (!Check(BacklogGitHubLoginRequestSchema, request.body)) throw new Error("Invalid GitHub username."); await store.setGitHubLogin(request.body.githubLogin); return { saved: true }; }
    catch (error) { return reply.code(error instanceof BacklogSettingsUnavailable ? 503 : 400).send({ error: error instanceof BacklogSettingsUnavailable ? error.message : "Invalid GitHub username." }); }
  });
}
