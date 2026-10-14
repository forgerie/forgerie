import { processWatchStateSchema } from "../processes/processWatchState.js";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
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
  const errors: unknown[] = [];
  const open = () => {
    const gateway = createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] });
    const service = new PiSessionService(hub, { agentDir, modelRuntime: models, sessionManager: gateway,
      archiveStore: archive, heartbeatIntervalMs: 60000, logger: { info: (data, text) => { errors.push({ data, text }); } },
      managedProcesses: { stateDirectory: root, prepareLauncher: () => Promise.resolve(control.launcher) } });
    cleanups.push(() => service.dispose());
    return service;
  };
  const catalog = () => createPiSessionManagerGateway({ agentDir, env: { HOME: root }, sessionDirEnvKeys: [] }).listAll();
  return { root, archive, control, provider, hub, open, catalog, errors };
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


it.each(["offline", "after-startup"] as const)("restores idle-session watches for an %s exit, opening only the one turn session", async (when) => {
  const f = await fixture(); const service = f.open();
  let wakes = 0;
  let afterRestart = false;
  f.provider.setResponses(Array.from({ length: 40 }, () => request => {
    const last = request.messages.at(-1);
    const text = last?.role === "user" ? JSON.stringify(last.content) : "";
    if (afterRestart) { wakes++; expect(JSON.stringify(request.messages)).toMatch(/Missed events|Managed process events/); }
    const attention = text.includes("START-turn") ? "turn" : text.includes("START-context") ? "context" : text.includes("START-ignore") ? "ignore" : undefined;
    if (attention !== undefined) return fauxAssistantMessage([fauxToolCall("process", {
      action: "start", name: "watched", command: "cat", notify: { onKilled: attention, logMatches: [{ pattern: "ready", on: attention }] },
    })], { stopReason: "toolUse" });
    return fauxAssistantMessage("Done");
  }));
  const refs = [];
  for (const attention of ["turn", "context", "ignore"] as const) {
    const ref = { id: (await service.start(f.root)).id, cwd: f.root };
    refs.push({ ...ref, attention });
    await service.runCommand(ref, `/name Watch ${attention}`);
    await service.prompt(ref, `START-${attention}`);
    await vi.waitFor(async () => { expect(f.control.started.some(record => record.sessionId === ref.id)).toBe(true); expect((await service.status(ref)).isStreaming).toBe(false); });
  }
  const catalog = await f.catalog();
  await service.dispose();
  const endProcesses = async () => {
    for (const record of f.control.started) {
      await writeFile(join(record.directory, "output.log"), "ready\n");
      await writeFile(join(record.directory, "result"), "signal\nkilled\nKILL\n");
      f.control.live.delete(`${record.sessionId}/${record.id}`);
    }
  };
  if (when === "offline") await endProcesses();
  f.hub.globalEvents.length = 0;
  afterRestart = true;
  const resumed = f.open();
  expect(await resumed.resumeDurableSessions()).toEqual({ resumed: [], failed: [] });
  await resumed.initializeManagedProcesses();
  if (when === "after-startup") {
    expect(f.hub.globalEvents.filter(event => event.type === "session.startup")).toEqual([]);
    await endProcesses();
  }
  await vi.waitFor(() => { expect(wakes).toBe(1); }, { timeout: 5000 });
  const turn = refs.find(ref => ref.attention === "turn");
  expect([...new Set(f.hub.globalEvents.filter(event => event.type === "session.startup").map(event => event.activity.sessionId))]).toEqual([turn?.id]);
  for (const ref of refs.filter(ref => ref.attention !== "turn")) {
    const file = catalog.find(item => item.id === ref.id)?.path;
    if (file === undefined) throw new Error("Missing session file");
    const outbox = await readFile(join(dirname(file), `${ref.id}.process-watches.json`), "utf8");
    expect(processWatchStateSchema.parse(JSON.parse(outbox)).pending?.summary.events.map(event => event.kind)).toEqual(["match", "exit"]);
    await resumed.status(ref);
    expect(JSON.stringify(await resumed.messages(ref))).toContain("forgerie.process-events");
  }
  expect(wakes).toBe(1);
  if (turn === undefined) throw new Error("Missing turn session");
  await vi.waitFor(async () => { expect((await resumed.status(turn)).isStreaming).toBe(false); });
  const messages = (await resumed.messages(turn)).messages;
  expect(messages.filter(message => typeof message === "object" && message !== null && "customType" in message && message.customType === "forgerie.process-events")).toHaveLength(1);
  await resumed.dispose();
  f.hub.globalEvents.length = 0;
  const again = f.open();
  expect(await again.resumeDurableSessions()).toEqual({ resumed: [], failed: [] });
  await again.initializeManagedProcesses();
  expect(f.hub.globalEvents.filter(event => event.type === "session.startup")).toEqual([]);
  expect(wakes).toBe(1);
  expect(f.errors.filter(error => typeof error === "object" && error !== null && "text" in error && error.text === "managed process maintenance failed")).toEqual([]);
}, 15000);
