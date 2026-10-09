import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fastifyCompress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { ProjectStore } from "./storage/projectStore.js";
import { ProjectService } from "./projects/projectService.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import { loadEffectiveProjectUploadsConfig } from "./workspaces/projectPiWebConfig.js";
import { listDirectorySuggestions } from "./projects/directorySuggestions.js";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.js";
import { registerSessionProxyRoutes, type SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import { registerWorkspaceExplorerRoutes } from "./workspaceExplorerRoutes.js";
import { registerPromptResourceCatalogProxyRoutes } from "./resources/promptResourceRoutes.js";
import { registerGitRoutes } from "./gitRoutes.js";
import { createUnavailableSpeechService, registerSpeechRoutes } from "./speech/speechRoutes.js";
import type { SpeechService } from "./speech/speechService.js";
import type { SpeechRuntimePolicy } from "../shared/speechPolicy.js";
import { createFilePiWebConfigService, registerConfigRoutes, type PiWebConfigService } from "./configRoutes.js";
import { createActiveProfilePiPackageService, type PiPackageService } from "./piPackageService.js";
import { registerPiPackageRoutes } from "./piPackageRoutes.js";
import { getPiWebRuntime, getPiWebVersionStatus } from "./piWebStatus.js";
import { SessionDaemonActiveAgentProfileProvider, type ActiveAgentProfileProvider } from "./activeAgentProfileProvider.js";
import { registerUiSettingsRoutes, type UiSettingsOptions } from "./uiSettings/routes.js";
import type { Project, Workspace, WorkspaceEffectiveConfig } from "./types.js";

export interface AppDependencies {
  uiSettings?: UiSettingsOptions;
  projects?: ProjectService;
  workspaces?: WorkspaceService;
  sessionDaemon?: SessionProxyDaemon;
  agentProfileProvider?: ActiveAgentProfileProvider;
  piPackages?: PiPackageService;
  config?: PiWebConfigService;
  speech?: SpeechService;
  speechPolicy?: SpeechRuntimePolicy;
  speechAllowedHosts?: readonly string[];
  clientDist?: string | false;
  logger?: FastifyServerOptions["logger"];
  /** Maximum accepted HTTP request body size in bytes. */
  bodyLimit?: number;
}

interface LocalProjectRouteOptions {
  config?: Pick<PiWebConfigService, "read">;
}

function registerLocalProjectRoutes(app: FastifyInstance, projects: ProjectService, workspaces: WorkspaceService, prefix: string, options: LocalProjectRouteOptions = {}): void {
  app.get(`${prefix}/projects`, async () => projects.list());

  app.post<{ Body: { name?: string; path: string; create?: boolean } }>(`${prefix}/projects`, async (request, reply) => {
    try {
      return await projects.add(request.body);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete<{ Params: { projectId: string } }>(`${prefix}/projects/:projectId`, async (request, reply) => {
    try {
      await projects.close(request.params.projectId);
      return { closed: true };
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Querystring: { q?: string } }>(`${prefix}/project-directories`, async (request, reply) => {
    try {
      return await listDirectorySuggestions(request.query.q ?? "");
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { projectId: string } }>(`${prefix}/projects/:projectId/workspaces`, async (request, reply) => {
    try {
      const project = await projects.requireProject(request.params.projectId);
      return await listWorkspacesWithEffectiveConfig(project, workspaces, options.config);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function listWorkspacesWithEffectiveConfig(project: Project, workspaces: WorkspaceService, config?: Pick<PiWebConfigService, "read">): Promise<Workspace[]> {
  const [workspaceList, effectiveConfig] = await Promise.all([
    workspaces.list(project),
    workspaceEffectiveConfig(project.path, config),
  ]);
  return workspaceList.map((workspace) => ({ ...workspace, effectiveConfig }));
}

async function workspaceEffectiveConfig(projectPath: string, config?: Pick<PiWebConfigService, "read">): Promise<WorkspaceEffectiveConfig> {
  const globalConfig = config === undefined ? {} : (await config.read()).effectiveConfig;
  return { uploads: await loadEffectiveProjectUploadsConfig(projectPath, globalConfig) };
}

export async function buildApp(deps: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? true, ...(deps.bodyLimit === undefined ? {} : { bodyLimit: deps.bodyLimit }) });
  // Vite and the production browser share this HTTP edge.
  await app.register(fastifyCompress, {
    globalCompression: true,
    globalDecompression: false,
    threshold: 1024,
  });
  await app.register(fastifyWebsocket);

  const projects = deps.projects ?? new ProjectService(new ProjectStore());
  const workspaces = deps.workspaces ?? new WorkspaceService();
  const configService = deps.config ?? createFilePiWebConfigService();
  const sessionDaemon = deps.sessionDaemon ?? new SessionDaemonClient();
  const agentProfileProvider = deps.agentProfileProvider ?? new SessionDaemonActiveAgentProfileProvider(sessionDaemon);

  const piPackages = deps.piPackages ?? createActiveProfilePiPackageService(agentProfileProvider);
  // Local runtime diagnostics never query a release registry or execute installers.
  app.get("/api/pi-web/status", async () => getPiWebVersionStatus(sessionDaemon));
  app.get("/api/pi-web/version", async () => getPiWebVersionStatus(sessionDaemon));
  app.get("/api/pi-web/runtime", async () => getPiWebRuntime(sessionDaemon));
  registerPiPackageRoutes(app, piPackages);
  registerConfigRoutes(app, configService);

  registerSpeechRoutes(app, deps.speech ?? createUnavailableSpeechService(), { ...(deps.speechPolicy === undefined ? {} : { policy: deps.speechPolicy }), ...(deps.speechAllowedHosts === undefined ? {} : { speechAllowedHosts: deps.speechAllowedHosts }) });

  registerLocalProjectRoutes(app, projects, workspaces, "/api", { config: configService });
  // The current browser still uses this local-only URL. No machine registry or remote proxy exists.
  registerLocalProjectRoutes(app, projects, workspaces, "/api/machines/local", { config: configService });

  registerSessionProxyRoutes(app, sessionDaemon);
  registerSessionProxyRoutes(app, sessionDaemon, "/api/machines/local");
  registerWorkspaceExplorerRoutes(app, projects, workspaces, "/api", { config: configService });
  registerWorkspaceExplorerRoutes(app, projects, workspaces, "/api/machines/local", { config: configService });
  registerPromptResourceCatalogProxyRoutes(app, projects, workspaces, sessionDaemon, "/api");
  registerPromptResourceCatalogProxyRoutes(app, projects, workspaces, sessionDaemon, "/api/machines/local");
  registerGitRoutes(app, projects, workspaces);
  registerGitRoutes(app, projects, workspaces, "/api/machines/local");
  await registerUiSettingsRoutes(app, deps.uiSettings);

  const packagedClientDist = join(dirname(fileURLToPath(import.meta.url)), "..", "client");
  const clientDist = deps.clientDist ?? (existsSync(packagedClientDist) ? packagedClientDist : join(process.cwd(), "dist", "client"));
  if (clientDist !== false && existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/pi-web-plugins/")) return reply.code(404).send({ error: "Route not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
