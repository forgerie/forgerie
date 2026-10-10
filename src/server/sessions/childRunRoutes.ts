import type { FastifyInstance } from "fastify";
import { Check } from "typebox/value";
import { CHILD_RUN_RETENTION_DAYS, ChildRunFilterSchema, ChildRunListSchema } from "../../shared/childRuns.js";
import type { ChildRunStore } from "./childRunStore.js";

/** Read-only history; it does not open sessions, replay tools, or enable task scheduling. */
export function registerChildRunRoutes(app: FastifyInstance, store: Pick<ChildRunStore, "list">, prefix = ""): void {
  app.get<{ Querystring: unknown }>(`${prefix}/sessions/children/runs`, { schema: { response: { 200: ChildRunListSchema } } }, async (request, reply) => {
    if (!Check(ChildRunFilterSchema, request.query)) return reply.code(400).send({ error: "Invalid child run filter" });
    try { return { retentionDays: CHILD_RUN_RETENTION_DAYS, records: await store.list(request.query) }; }
    catch (error) { return reply.code(500).send({ error: error instanceof Error ? error.message : String(error) }); }
  });
}
