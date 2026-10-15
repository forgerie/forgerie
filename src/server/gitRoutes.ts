import type { FastifyInstance } from "fastify";
import { resolveWorkspaceContext, type WorkspaceContextProjectService, type WorkspaceContextWorkspaceService } from "./workspaces/workspaceContext.js";
import { gitDiff, gitStatus } from "./git/gitService.js";

export function registerGitRoutes(app: FastifyInstance, projects: WorkspaceContextProjectService, workspaces: WorkspaceContextWorkspaceService, prefix = "/api"): void {
  app.get<{ Params: { projectId: string; workspaceId: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/git/status`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await gitStatus(context.root);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { path?: string; staged?: string; context?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/git/diff`, async (request, reply) => {
    try {
      const context = await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId);
      return await gitDiff(context.root, { ...(request.query.path === undefined ? {} : { path: request.query.path }), staged: request.query.staged === "true", fullContext: request.query.context === "full" });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
