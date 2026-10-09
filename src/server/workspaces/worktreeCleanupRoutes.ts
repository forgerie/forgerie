import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { WorktreeCleanupJob } from "./worktreeCleanupJob.js";

const body = Type.Object({}, { additionalProperties: false });

export function registerWorktreeCleanupRoutes(app: FastifyInstance, job: Pick<WorktreeCleanupJob, "snapshot" | "run">, prefix = ""): void {
  const path = `${prefix}/sessions/worktrees/cleanup`;
  app.get(path, () => job.snapshot());
  app.post<{ Body: unknown }>(path, async (request, reply) => {
    if (!Check(body, request.body === undefined ? {} : request.body)) return reply.code(400).send({ error: "Cleanup accepts only an empty object" });
    try { return await job.run(); }
    catch (error) { return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
}
