import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { PromptResourceCatalogResponse } from "../../shared/promptResourceCommand.js";

export interface PromptResourceRouteService {
  catalog(cwd: string): Promise<PromptResourceCatalogResponse>;
}

export function registerPromptResourceRoutes(app: FastifyInstance, service: PromptResourceRouteService): void {
  app.get<{ Querystring: { cwd?: string } }>("/prompt-resource-catalog", async (request, reply) => {
    if (request.query.cwd === undefined || request.query.cwd === "") return reply.code(400).send({ error: "cwd query is required" });
    return await service.catalog(resolve(request.query.cwd));
  });
}
