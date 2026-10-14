import { join } from "node:path";
import { ModelRuntime, SessionManager, createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { WorkspaceServices } from "../workspaces/workspaceServices.js";
import { createWorkspaceServicesTool, createWorkspaceServicesObserver } from "./workspaceServicesTool.js";
import { DurableAgentSession } from "./durableAgentSession.js";
import { DurableSessionRuntime, type DurableRuntimeOptions } from "./durableSessionRuntime.js";

/** Actual SDK and Durable wiring with a configured local provider and an isolated profile. */
export async function servicesToolRuntime(cwd: string, root: string, services: WorkspaceServices) {
  const modelRuntime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: join(root, "models.json") });
  const provider = fauxProvider(); modelRuntime.registerNativeProvider(provider.provider); await modelRuntime.refresh({ allowNetwork: false });
  const model = modelRuntime.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("Missing configured provider model");
  const errors: string[] = [];
  const create = async (options: DurableRuntimeOptions) => {
    const workspaceServicesObserver = createWorkspaceServicesObserver(options.cwd, services);
    const sdk = await createAgentSessionServices({ cwd: options.cwd, agentDir: options.agentDir, modelRuntime,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true, extensionFactories: [workspaceServicesObserver.extension] } });
    sdk.settingsManager.applyOverrides({ compaction: { enabled: false } });
    const runtimeServices = Object.assign(sdk, { workspaceServicesObserver });
    const session = await DurableAgentSession.open({ services: sdk, sessionManager: options.sessionManager, initialModel: model,
      customTools: [createWorkspaceServicesTool(options.cwd, services)], ...(options.sessionStartEvent === undefined ? {} : { sessionStartEvent: options.sessionStartEvent }) });
    await session.bindExtensions({ onError: (error) => { errors.push(error.error); } });
    return { session, services: runtimeServices };
  };
  const manager = SessionManager.create(cwd, join(root, "sessions"));
  const runtime = await DurableSessionRuntime.open(create, { cwd, agentDir: join(root, "agent"), sessionManager: manager });
  return { runtime, manager, provider, errors };
}
