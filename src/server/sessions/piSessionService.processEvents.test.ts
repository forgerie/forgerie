import { processWatchStateSchema } from "../processes/processWatchState.js";
import { mkdtemp, rm, readFile, writeFile, readdir, access } from "node:fs/promises";
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
  const provider = fauxProvider({ tokensPerSecond: 100000 }); models.registerNativeProvider(provider.provider); await models.refresh({ allowNetwork: false });
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
  expect(await resumed.processes(ref)).toEqual({ available: false, writeSupported: false, processes: [] });
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

it("rebinds the panel to the restored daemon dispatcher without losing names or intentional Stop state", async () => {
  const f = await fixture(); const service = f.open();
  f.provider.setResponses([
    fauxAssistantMessage([fauxToolCall("process", { action: "start", name: "panel-owned", command: "cat",
      notify: { logMatches: [{ pattern: "ready", on: "context" }] } })], { stopReason: "toolUse" }),
    fauxAssistantMessage("Done"),
  ]);
  const ref = { id: (await service.start(f.root)).id, cwd: f.root };
  await service.runCommand(ref, "/name Panel owned");
  await service.prompt(ref, "Start the managed process.");
  await vi.waitFor(async () => {
    expect(f.control.started).toHaveLength(1);
    expect((await service.status(ref)).isStreaming).toBe(false);
  }, { timeout: 5000 });
  const record = f.control.started[0];
  if (record === undefined) throw new Error("Missing process record");
  expect((await service.processes(ref)).processes[0]).toMatchObject({ id: record.id, name: "panel-owned", status: "running" });
  await service.dispose();
  await writeFile(join(record.directory, "output.log"), "ready\n");
  const resumed = f.open();
  await resumed.initializeManagedProcesses();
  expect((await resumed.processes(ref)).processes[0]).toMatchObject({ id: record.id, name: "panel-owned", status: "running" });
  expect(await resumed.processOutput(ref, record.id)).toEqual({ ok: true, lines: [{ type: "stdout", text: "ready", number: 1, terminated: true, truncatedStart: false }], cursor: { offset: 6, line: 2 }, droppedLines: 0 });
  expect(JSON.stringify(await resumed.messages(ref))).toContain("forgerie.process-events");
  expect(await resumed.killProcess(ref, record.id)).toMatchObject({ ok: true });
  const session = (await f.catalog()).find(item => item.id === ref.id);
  if (session === undefined) throw new Error("Missing session");
  const state = processWatchStateSchema.parse(JSON.parse(await readFile(join(dirname(session.path), `${ref.id}.process-watches.json`), "utf8")));
  expect(state.processes[record.id]?.stopped).toBe(true);
  expect(f.errors.filter(error => typeof error === "object" && error !== null && "text" in error
    && typeof error.text === "string" && error.text.startsWith("managed process"))).toEqual([]);
}, 15000);

it("starts the daemon after an unused session created an empty process owner", async () => {
  const f = await fixture(); const first = f.open();
  const ref = { id: (await first.start(f.root)).id, cwd: f.root };
  expect(await f.catalog()).toEqual([]);
  await first.dispose();
  const directory = join(f.root, "managed-processes", ref.id);
  expect(await readdir(directory)).toEqual([]);
  const second = f.open();
  await expect(second.initializeManagedProcesses()).resolves.toBeUndefined();
  expect(await readdir(directory)).toEqual([]);
  expect(f.control.started).toHaveLength(0);
});

it("isolates an unresolved owner and keeps its records and event evidence while restoring healthy owners", async () => {
  const f = await fixture(); const first = f.open();
  const orphan = { id: (await first.start(f.root)).id, cwd: f.root };
  const core = await first.getManagedProcesses(orphan.id);
  const record = await core.start({ command: "cat", cwd: f.root });
  await writeFile(join(record.directory, "output.log"), "retained evidence\n");
  const healthy = { id: (await first.start(f.root)).id, cwd: f.root };
  await first.prompt(healthy, "Persist this session");
  await vi.waitFor(async () => { expect(f.provider.state.callCount).toBeGreaterThan(0); expect((await first.status(healthy)).isStreaming).toBe(false); });
  const entry = (await f.catalog()).find(item => item.id === healthy.id);
  if (entry === undefined) throw new Error("Missing healthy session");
  const watchFile = join(dirname(entry.path), `${orphan.id}.process-watches.json`);
  await first.dispose();
  const evidence = JSON.stringify({ version: 1, processes: {}, pending: { summary: { id: "saved", missed: true, events: [
    { processId: record.id, name: "orphan", watchId: "watch", attention: "context", kind: "match", line: 1, count: 1, samples: [{ number: 1, text: "retained evidence" }] },
  ] }, cursors: {} } });
  await writeFile(watchFile, evidence);
  const command = await readFile(join(record.directory, "command.json"), "utf8");
  const second = f.open();
  await expect(second.initializeManagedProcesses()).resolves.toBeUndefined();
  expect(await (await second.getManagedProcesses(healthy.id)).list()).toEqual([]);
  expect(await readFile(join(record.directory, "command.json"), "utf8")).toBe(command);
  expect(await readFile(join(record.directory, "output.log"), "utf8")).toBe("retained evidence\n");
  expect(await readFile(watchFile, "utf8")).toBe(evidence);
  expect(JSON.stringify(f.errors)).toContain(orphan.id);
  expect(f.control.started).toHaveLength(1);
});

it("retries a failed archive through the production runtime with a usable dispatcher", async () => {
  const f = await fixture(); const service = f.open();
  const ref = { id: (await service.start(f.root)).id, cwd: f.root };
  await service.prompt(ref, "Persist before archive");
  await vi.waitFor(async () => { expect(f.provider.state.callCount).toBeGreaterThan(0); expect((await service.status(ref)).isStreaming).toBe(false); });
  const record = await (await service.getManagedProcesses(ref.id)).start({ command: "cat", cwd: f.root });
  const stop = f.control.launcher.stopSession.bind(f.control.launcher);
  let attempts = 0;
  f.control.launcher.stopSession = async id => {
    if (++attempts === 1) throw new Error("Injected stop failure");
    await stop(id);
  };
  await expect(service.archive(ref)).rejects.toThrow("Injected stop failure");
  expect(await f.archive.isArchived(ref.id)).toBe(false);
  await access(join(record.directory, "command.json"));
  await expect(service.archive(ref)).resolves.toBeUndefined();
  expect(await f.archive.isArchived(ref.id)).toBe(true);
  expect(attempts).toBe(2);
  await expect(access(record.directory)).rejects.toMatchObject({ code: "ENOENT" });
});
