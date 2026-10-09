import { resolve } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
// The catalog route keeps its bounded daemon wait independently of federation.
const PROMPT_RESOURCE_CATALOG_PROXY_TIMEOUT_MS = 15_000;
import type { PromptResourceCatalogResponse } from "../../shared/promptResourceCommand.js";
import type { ProjectService } from "../projects/projectService.js";
import type { WorkspaceService } from "../workspaces/workspaceService.js";
import { resolveWorkspaceContext } from "../workspaces/workspaceContext.js";

export interface PromptResourceRouteService {
  catalog(cwd: string): Promise<PromptResourceCatalogResponse>;
}

export interface PromptResourceCatalogProxyDaemon {
  request(method: string, path: string, body?: unknown): Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
}

export function registerPromptResourceRoutes(app: FastifyInstance, service: PromptResourceRouteService): void {
  app.get<{ Querystring: { cwd?: string } }>("/prompt-resource-catalog", async (request, reply) => {
    if (request.query.cwd === undefined || request.query.cwd === "") return reply.code(400).send({ error: "cwd query is required" });
    return await service.catalog(resolve(request.query.cwd));
  });
}

export function registerPromptResourceCatalogProxyRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, daemon: PromptResourceCatalogProxyDaemon, prefix = "/api"): void {
  app.get<{ Params: { projectId: string; workspaceId: string }; Querystring: { cwd?: string } }>(`${prefix}/projects/:projectId/workspaces/:workspaceId/prompt-resource-catalog`, async (request, reply) => {
    if (request.query.cwd !== undefined) return reply.code(400).send({ error: "Prompt-resource catalog cwd is resolved from the registered workspace" });

    let cwd: string;
    try {
      cwd = resolve((await resolveWorkspaceContext(projects, workspaces, request.params.projectId, request.params.workspaceId)).root);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }

    return await proxyPromptResourceCatalogRequest(daemon, cwd, reply);
  });
}

async function proxyPromptResourceCatalogRequest(daemon: PromptResourceCatalogProxyDaemon, cwd: string, reply: FastifyReply): Promise<FastifyReply> {
  try {
    const upstream = await requestWithDeadline(daemon, "GET", `/prompt-resource-catalog?cwd=${encodeURIComponent(cwd)}`);
    reply.code(upstream.statusCode);
    const contentType = upstream.headers["content-type"];
    if (contentType !== undefined && contentType !== "") reply.header("content-type", contentType);
    if (upstream.body === "") return await reply.send();
    return await reply.send(JSON.parse(upstream.body));
  } catch (error) {
    if (error instanceof PromptResourceCatalogProxyTimeoutError) {
      return reply.code(504).send({ error: "Prompt-resource catalog request timed out" });
    }
    return reply.code(502).send({ error: "Session daemon unavailable" });
  }
}

function requestWithDeadline(daemon: PromptResourceCatalogProxyDaemon, method: string, path: string): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolveRequest, rejectRequest) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      rejectRequest(new PromptResourceCatalogProxyTimeoutError());
    }, PROMPT_RESOURCE_CATALOG_PROXY_TIMEOUT_MS);

    daemon.request(method, path).then((response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveRequest(response);
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectRequest(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

class PromptResourceCatalogProxyTimeoutError extends Error {
  constructor() {
    super("Prompt-resource catalog proxy timeout");
  }
}
