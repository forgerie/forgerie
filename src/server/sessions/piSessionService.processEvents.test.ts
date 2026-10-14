import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { SessionArchiveStore } from "./sessionArchiveStore.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import { CapturingSessionEventHub } from "./piSessionService.testSupport.js";
import { controlledManagedProcessLauncher } from "../processes/managedProcesses.testSupport.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-process-recovery-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const models = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json") });
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider);
  provider.setResponses(Array.from({ length: 30 }, () => fauxAssistantMessage("Done")));
  const control = controlledManagedProcessLauncher();
  const archive = new SessionArchiveStore(join(root, "archive.json"));
  const hub = new CapturingSessionEventHub();
  const open = () => {
    const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] });
    const service = new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway,
      archiveStore: archive, heartbeatIntervalMs: 60000,
      managedProcesses: { stateDirectory: root, prepareLauncher: () => Promise.resolve(control.launcher) } });
    cleanups.push(() => service.dispose());
    return service;
  };
  return { root, archive, control, provider, hub, open };
}

it("reads archived session status through the production factory without opening a managed process owner", async () => {
  const f = await fixture(); const service = f.open();
  const ref = { id: (await service.start(f.root)).id, cwd: f.root };
  await service.runCommand(ref, "/name Archived process owner");
  await service.prompt(ref, "Finish this session.");
  await vi.waitFor(async () => { expect((await service.status(ref)).isStreaming).toBe(false); expect(f.provider.state.callCount).toBeGreaterThan(0); });
  await service.archive(ref);
  expect(await f.archive.isArchived(ref.id)).toBe(true);
  await service.dispose();
  const resumed = f.open();
  expect((await resumed.status(ref)).isStreaming).toBe(false);
  await expect(resumed.getManagedProcesses(ref.id)).rejects.toThrow("Archived sessions cannot start");
  await expect(resumed.prompt(ref, "Start a process")).rejects.toThrow("read-only");
  expect(f.control.started).toHaveLength(0);
});
