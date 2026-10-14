import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { taskActivitySchema, type TaskActivity } from "../../shared/durableTaskActivity.js";
import { normalizeRequestCwd } from "../workingDirectory.js";
import type { SessionRouteRef } from "./sessionService.js";

const querySchema = z.strictObject({ cwd: z.string().min(1).refine(value => !value.includes("\u0000")) });
export function registerDurableTaskRoutes(app: FastifyInstance, service: { durableTasks(ref: SessionRouteRef): Promise<TaskActivity> }, prefix = ""): void {
  app.get<{ Params: { sessionId: string }; Querystring: unknown }>(`${prefix}/sessions/:sessionId/tasks`, async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "cwd query parameter is required; unexpected query fields are not allowed" });
    let cwd: string;
    try { cwd = normalizeRequestCwd(query.data.cwd); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
    try {
      return taskActivitySchema.parse(await service.durableTasks({ id: request.params.sessionId, cwd }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, "Could not read Durable tasks");
      return reply.code(/session not found/i.test(message) ? 404 : 500).send({ error: /session not found/i.test(message) ? "Session not found" : "Could not read tasks" });
    }
  });
}
