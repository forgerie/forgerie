import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { ProjectGroupInputSchema, ProjectGroupUpdateSchema } from "../../shared/projectGroups.js";
import { GroupConflict, type ProjectGroups } from "./projectGroups.js";
import type { ProjectService } from "./projectService.js";
import type { ProjectWorkspaces } from "./projectWorkspaces.js";

const Prepare = Type.Object({ id: Type.String({ minLength: 1 }), cwd: Type.String({ minLength: 1 }), projectId: Type.String({ minLength: 1 }), requestId: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false });
const Ref = Type.Object({ id: Type.String({ minLength: 1 }), cwd: Type.String({ minLength: 1 }) }, { additionalProperties: false });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
export function registerProjectGroupRoutes(app: FastifyInstance, groups: ProjectGroups, projects: Pick<ProjectService, "list">, work: ProjectWorkspaces): void {
  app.get("/project-groups", async () => ({ groups: await groups.list(), projects: await projects.list() }));
  app.post<{ Body: unknown }>("/project-groups", async (request, reply) => {
    try {
      if (!Check(ProjectGroupInputSchema, request.body)) throw new Error("Invalid group request.");
      return await groups.save(request.body);
    } catch (error) { return reply.code(400).send({ error: errorText(error) }); }
  });
  app.put<{ Params: { id: string }; Body: unknown }>("/project-groups/:id", async (request, reply) => {
    try {
      if (!Check(ProjectGroupUpdateSchema, request.body)) throw new Error("Invalid group request.");
      const { revision, ...input } = request.body;
      return await groups.save(input, { id: request.params.id, revision });
    } catch (error) { return reply.code(error instanceof GroupConflict ? 409 : 400).send({ error: errorText(error) }); }
  });
  app.delete<{ Params: { id: string }; Querystring: { revision?: string } }>("/project-groups/:id", async (request, reply) => {
    try {
      await groups.remove(request.params.id, Number(request.query.revision));
      return { removed: true };
    } catch (error) { return reply.code(error instanceof GroupConflict ? 409 : 400).send({ error: errorText(error) }); }
  });
  // Recovery inventory stays reachable even if an owning chat was archived or deleted.
  app.get("/project-workspaces/all", async () => ({ related: await work.related() }));
  app.get<{ Querystring: unknown }>("/project-workspaces", async (request, reply) => {
    try {
      if (!Check(Ref, request.query)) throw new Error("Use the session id and cwd.");
      return await work.catalog(request.query);
    } catch (error) { return reply.code(400).send({ error: errorText(error) }); }
  });
  app.post<{ Body: unknown }>("/project-workspaces", async (request, reply) => {
    try {
      if (!Check(Prepare, request.body)) throw new Error("Invalid worktree request.");
      const { id, cwd, projectId, requestId } = request.body;
      return await work.prepare({ id, cwd }, projectId, requestId);
    } catch (error) { return reply.code(409).send({ error: errorText(error) }); }
  });
}
