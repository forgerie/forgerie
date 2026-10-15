import { SessionDaemonClient, type SessionDaemonRequestClient } from "../../sessiond/sessionDaemonClient.js";
import { decisionGatewayKeyMiddleware } from "./decisionGatewayKeyRoutes.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { agentFilesMiddleware, defaultAgentDirs, type AgentDirs } from "./agentFiles.js";
import { inProcessGateway, type Gateway } from "./forgerieProfile.js";
import { defaultPrefsPaths, modelPrefsMiddleware, type ModelPrefsPaths } from "./modelPrefsFiles.js";
import { pluginMiddleware } from "./pluginRoutes.js";
import { PluginService, type PluginServices } from "./pluginService.js";

/** A Node handler that answers its own paths and passes the rest on. */
export type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

export const UI_SETTINGS_PREFIX = "/aui/";

export interface UiSettingsOptions {
  agentDirs?: (gateway: Gateway) => Promise<AgentDirs>;
  modelPrefsPaths?: (gateway: Gateway) => Promise<ModelPrefsPaths>;
  pluginServices?: PluginServices;
}

/**
 * The browser app's settings files: agents, Pi plugins, and model lists, under
 * `/aui/`. The handlers read their own request bodies with their own limits,
 * so this scope leaves the body stream unparsed.
 */
export async function registerUiSettingsRoutes(app: FastifyInstance, options: UiSettingsOptions = {}, daemon: SessionDaemonRequestClient = new SessionDaemonClient()): Promise<void> {
  const gateway = inProcessGateway(app);
  const plugins = new PluginService({ gateway, ...(options.pluginServices === undefined ? {} : { services: options.pluginServices }) });
  const handlers: Middleware[] = [
    decisionGatewayKeyMiddleware(plugins, daemon),
    agentFilesMiddleware(() => (options.agentDirs ?? defaultAgentDirs)(gateway)),
    pluginMiddleware(plugins),
    modelPrefsMiddleware(() => (options.modelPrefsPaths ?? defaultPrefsPaths)(gateway)),
  ];
  await app.register((scope, _options, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, _payload, parsed) => { parsed(null); });
    scope.all(`${UI_SETTINGS_PREFIX}*`, (request, reply) => {
      reply.hijack();
      const run = (index: number): void => {
        const handler = handlers[index];
        if (handler === undefined) {
          reply.raw.statusCode = 404;
          reply.raw.setHeader("content-type", "application/json");
          reply.raw.end(JSON.stringify({ error: "No such settings route." }));
          return;
        }
        handler(request.raw, reply.raw, () => { run(index + 1); });
      };
      run(0);
    });
    done();
  });
}
