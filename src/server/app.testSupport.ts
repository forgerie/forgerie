import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach } from "vitest";
import { buildApp } from "./app.js";
import { createUnavailableSpeechService } from "./speech/speechRoutes.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectStore } from "./storage/projectStore.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import type { PiPackageService } from "./piPackageService.js";
import type { SessionProxyDaemon } from "./sessiond/sessionProxyRoutes.js";
import type { ActiveAgentProfileDescriptor, PiPackageInfo, PiWebConfigResponse, PiWebConfigValues } from "../shared/apiTypes.js";
import type { SessionDaemonAgentProfileResult } from "../sessiond/sessionDaemonClient.js";

interface AppTestContext {
  readonly app: FastifyInstance;
  readonly tempDir: string;
  readonly projectDir: string;
  readonly sessionDaemonRequests: CapturedSessionDaemonRequest[];
  readonly piPackageRequests: CapturedPiPackageRequest[];
  piWebConfig: PiWebConfigValues;
  agentProfileResult: SessionDaemonAgentProfileResult;
}

let app: FastifyInstance | undefined;
let tempDir: string | undefined;
let projectDir: string | undefined;
let sessionDaemonRequests: CapturedSessionDaemonRequest[] = [];
let piPackageRequests: CapturedPiPackageRequest[] = [];
let piWebConfig: PiWebConfigValues = {};
let agentProfileResult: SessionDaemonAgentProfileResult = { status: "invalid", error: "App test harness was not initialized" };

export const appTestContext: AppTestContext = {
  get app() {
    if (app === undefined) throw new Error("App test harness was not initialized");
    return app;
  },
  get tempDir() {
    if (tempDir === undefined) throw new Error("App test tempDir was not initialized");
    return tempDir;
  },
  get projectDir() {
    if (projectDir === undefined) throw new Error("App test projectDir was not initialized");
    return projectDir;
  },
  get sessionDaemonRequests() {
    return sessionDaemonRequests;
  },
  get piPackageRequests() {
    return piPackageRequests;
  },
  get piWebConfig() {
    return piWebConfig;
  },
  set piWebConfig(config) {
    piWebConfig = config;
  },
  get agentProfileResult() {
    return agentProfileResult;
  },
  set agentProfileResult(result) {
    agentProfileResult = result;
  },
};

export function registerAppTestHooks(options: { clientDist?: boolean } = {}): void {
  beforeEach(async () => {
    tempDir = await realpath(await mkdtemp(join(tmpdir(), "pi-web-app-test-")));
    projectDir = join(tempDir, "project");
    sessionDaemonRequests = [];
    piPackageRequests = [];
    piWebConfig = {};
    agentProfileResult = { status: "available", profile: appTestAgentProfile(join(tempDir, "agent")) };
    const clientDist = options.clientDist === true ? join(tempDir, "client") : false;
    if (clientDist !== false) {
      await mkdir(clientDist);
      await writeFile(join(clientDist, "index.html"), "<!doctype html><title>Forgerie test shell</title>");
    }
    app = await buildApp({
      projects: new ProjectService(new ProjectStore(join(tempDir, "projects.json"))),
      workspaces: new WorkspaceService(),
      sessionDaemon: fakeSessionDaemon(),
      agentProfileProvider: { getActiveAgentProfile: () => Promise.resolve(agentProfileResult) },
      config: fakeConfigService(),
      speech: createUnavailableSpeechService(),
      piPackages: fakePiPackageService(),
      clientDist,
      logger: false,
    });
  });

  afterEach(async () => {
    const appToClose = app;
    const tempDirToRemove = tempDir;
    app = undefined;
    tempDir = undefined;
    projectDir = undefined;
    sessionDaemonRequests = [];
    piPackageRequests = [];
    piWebConfig = {};
    agentProfileResult = { status: "invalid", error: "App test harness was not initialized" };

    if (appToClose !== undefined) await appToClose.close();
    if (tempDirToRemove !== undefined) await rm(tempDirToRemove, { recursive: true, force: true });
  });
}

export interface CapturedSessionDaemonRequest {
  method: string;
  path: string;
  body?: unknown;
}

interface CapturedPiPackageRequest {
  action: "list" | "install" | "remove" | "update";
  source?: string;
  scope?: "user" | "project";
}

function fakeConfigService() {
  return {
    read: () => piWebConfigResponse(piWebConfig),
    write: (config: PiWebConfigValues) => {
      piWebConfig = config;
      return piWebConfigResponse(config);
    },
  };
}

function appTestAgentProfile(dir: string): ActiveAgentProfileDescriptor {
  return {
    schemaVersion: 1,
    revision: `sha256:${"a".repeat(64)}`,
    command: "pi",
    dir,
    sessionDirEnvKeys: ["PI_WEB_AGENT_SESSION_DIR", "PI_CODING_AGENT_SESSION_DIR"],
  };
}

export function piWebConfigResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: join(appTestContext.tempDir, "config.json"),
    exists: false,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, spawnSessions: false, askUser: false, codemode: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}

function fakePiPackageService(): PiPackageService {
  const packages: PiPackageInfo[] = [{ source: "npm:@acme/tools", scope: "user", filtered: false, installedPath: "/tmp/pi-tools" }];
  return {
    list: () => {
      piPackageRequests.push({ action: "list" });
      return Promise.resolve({ packages });
    },
    install: (source) => {
      piPackageRequests.push({ action: "install", source });
      return Promise.resolve({ action: "install", source, packages });
    },
    remove: (source, scope = "user") => {
      piPackageRequests.push({ action: "remove", source, scope });
      return Promise.resolve({ action: "remove", source, scope, removed: true, packages });
    },
    update: (source) => {
      piPackageRequests.push({ action: "update", ...(source === undefined ? {} : { source }) });
      return Promise.resolve({ action: "update", ...(source === undefined ? {} : { source }), packages });
    },
  };
}

function fakeSessionDaemon(): SessionProxyDaemon {
  return {
    request: (method, path, body) => {
      const captured = { method, path, ...(body === undefined ? {} : { body }) } satisfies CapturedSessionDaemonRequest;
      sessionDaemonRequests.push(captured);
      return Promise.resolve({
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(path === "/runtime" ? {
          component: "sessiond", label: "Session daemon", runtimeVersion: "test-runtime", capabilities: [],
          available: agentProfileResult.status === "available",
          ...(agentProfileResult.status === "available" ? { activeAgentProfile: agentProfileResult.profile } : { error: "Agent profile unavailable" }),
        } : captured),
      });
    },
    connectWebSocket: () => { throw new Error("WebSocket not configured for test"); },
  };
}
