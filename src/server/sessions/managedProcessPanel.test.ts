import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ManagedProcesses } from "../processes/managedProcesses.js";
import { ManagedProcessTools } from "../processes/processTool.js";
import { controlledManagedProcessLauncher } from "../processes/managedProcesses.testSupport.js";
import { AttachedManagedProcessLauncher } from "../processes/managedProcessLauncher.js";
import { ManagedProcessPanel } from "./managedProcessPanel.js";
import type { SessionUiEvent } from "../../shared/apiTypes.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  try { for (const close of cleanup.splice(0).reverse()) await close(); }
  finally { vi.useRealTimers(); }
});
async function fixture(attached = false, intervals: { activeIntervalMs?: number; idleIntervalMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "process-panel-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const control = controlledManagedProcessLauncher();
  const core = new ManagedProcesses({ stateDirectory: root, sessionId: "panel", launcher: attached ? new AttachedManagedProcessLauncher() : control.launcher,
    environment: { PATH: process.env["PATH"], SECRET: "never-send-this" } });
  await core.initialize(); cleanup.push(() => core.dispose());
  const tools = new ManagedProcessTools({ sessionId: "panel", cwd: root, stateFile: join(root, "watches.json"), getManagedProcesses: () => Promise.resolve(core) });
  await tools.initialize(() => Promise.resolve()); cleanup.push(() => tools.dispose());
  const events: SessionUiEvent[] = [];
  const panel = new ManagedProcessPanel(() => Promise.resolve(core), tools, event => events.push(event), error => { throw error; }, intervals);
  cleanup.push(() => { panel.dispose(); return Promise.resolve(); });
  return { root, core, tools, panel, control, events };
}
it("projects names and lost reasons without private records, and browses without consuming watches", async () => {
  const f = await fixture();
  const started = await f.tools.execute({ action: "start", name: "builder", command: "cat" });
  const id = started.process?.id;
  if (id === undefined) throw new Error("Process did not start");
  const record = await f.core.status(id);
  expect((await f.panel.snapshot()).processes[0]?.lastLogLine).toBeNull();
  await appendFile(join(record.directory, "output.log"), "one\ntwo\n");
  expect((await f.panel.snapshot()).processes[0]?.lastLogLine).toEqual({ text: "two", truncatedStart: false });
  await f.panel.refresh();
  expect(await f.panel.output(id, 1)).toEqual({ ok: true, lines: [{ type: "stdout", text: "two" }] });
  expect((await f.core.readOutput(id)).lines.map(line => line.text)).toEqual(["one", "two"]);
  expect(f.events).toContainEqual({ type: "processes.output", id, lines: [{ type: "stdout", text: "one" }, { type: "stdout", text: "two" }], droppedLines: 0 });
  const wire = JSON.stringify(f.events);
  expect(wire).not.toContain("never-send-this"); expect(wire).not.toContain("environment"); expect(wire).not.toContain(record.directory);
  f.control.live.clear();
  expect((await f.panel.snapshot()).processes[0]).toMatchObject({ name: "builder", endReason: "lost", errorMessage: "supervisor lost" });
  expect(await f.panel.kill("absent")).toEqual({ ok: false, reason: "not_found" });
  expect(await f.panel.output("absent")).toEqual({ ok: false, reason: "not_found" });
});
it("labels attached processes, writes real stdin, closes it explicitly, and stops from the panel", async () => {
  const f = await fixture(true);
  const started = await f.tools.execute({ action: "start", name: "echo", command: "cat" });
  const id = started.process?.id;
  if (id === undefined) throw new Error("Process did not start");
  expect((await f.panel.snapshot()).processes[0]?.notice).toContain("ends when Forgerie restarts");
  await expect.poll(async () => f.panel.write(id, "hello\n")).toEqual({ ok: true, bytesWritten: 6 });
  await expect.poll(async () => f.panel.output(id)).toMatchObject({ ok: true, lines: [{ text: "hello" }] });
  expect(await f.panel.write(id, "", true)).toEqual({ ok: true, bytesWritten: 0 });
  await expect.poll(async () => (await f.core.status(id)).state.kind).toBe("ended");
  expect(await f.panel.write(id, "again")).toEqual({ ok: false, reason: "process_exited" });
  const other = await f.tools.execute({ action: "start", name: "stop", command: "sleep 60" });
  const otherId = other.process?.id;
  if (otherId === undefined) throw new Error("Process did not start");
  expect(await f.panel.kill(otherId)).toMatchObject({ ok: true });
  await expect.poll(async () => (await f.core.status(otherId)).state.kind).toBe("ended");
});

it("bounds output frames and serializes concurrent refreshes without duplicate deltas", async () => {
  const f = await fixture();
  const started = await f.tools.execute({ action: "start", name: "noisy", command: "cat" });
  const id = started.process?.id;
  if (id === undefined) throw new Error("Process did not start");
  const record = await f.core.status(id);
  await appendFile(join(record.directory, "output.log"), `${"x".repeat(4096)}\n`.repeat(100));
  await Promise.all([f.panel.refresh(), f.panel.refresh()]);
  const frames = f.events.filter(event => event.type === "processes.output");
  expect(frames).toHaveLength(1);
  for (const frame of frames) {
    expect(Buffer.byteLength(frame.lines.map(line => line.text).join(""))).toBeLessThanOrEqual(32 * 1024);
    expect(frame.droppedLines).toBe(92);
  }
  expect((await f.core.readOutput(id)).lines).toHaveLength(100);
});

it("omits a listed process confirmed removed before its tail is read", async () => {
  const f = await fixture();
  await f.tools.execute({ action: "start", name: "finished", command: "cat" });
  f.control.live.clear();
  const read = f.core.lastOutput.bind(f.core);
  f.core.lastOutput = async id => { await f.core.clearFinished(); return read(id); };
  expect((await f.panel.snapshot()).processes).toEqual([]);
});
it("preserves missing-output errors when the listed record still exists", async () => {
  const f = await fixture();
  const started = await f.tools.execute({ action: "start", name: "broken", command: "cat" });
  const id = started.process?.id;
  if (id === undefined) throw new Error("Process did not start");
  const record = await f.core.status(id);
  await rm(join(record.directory, "output.log"));
  await expect(f.panel.snapshot()).rejects.toMatchObject({ code: "ENOENT" });
});
it("updates list snapshots on live partial output, without consuming event output", async () => {
  const f = await fixture();
  const started = await f.tools.execute({ action: "start", name: "live", command: "cat" });
  const id = started.process?.id;
  if (id === undefined) throw new Error("Process did not start");
  const record = await f.core.status(id);
  await f.panel.refresh();
  f.events.length = 0;
  await appendFile(join(record.directory, "output.log"), "partial");
  await f.panel.refresh();
  const update = f.events.find(event => event.type === "processes.update");
  if (update?.type !== "processes.update") throw new Error("Expected a process snapshot update");
  expect(update.snapshot.processes[0]).toMatchObject({ id, lastLogLine: { text: "partial", truncatedStart: false } });
  expect((await f.core.readOutput(id)).lines).toEqual([]);
  await appendFile(join(record.directory, "output.log"), " complete\n");
  expect((await f.panel.snapshot()).processes[0]?.lastLogLine).toEqual({ text: "partial complete", truncatedStart: false });
  expect((await f.core.readOutput(id)).lines.map(line => line.text)).toEqual(["partial complete"]);
});

it("does not list empty sessions again during five active intervals", async () => {
  const f = await fixture(false, { activeIntervalMs: 1000, idleIntervalMs: 10_000 });
  const list = vi.spyOn(f.core, "list");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  f.panel.watch();
  await f.panel.refresh();
  try {
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(list).toHaveBeenCalledTimes(1);
    const refresh = vi.spyOn(f.panel, "refresh");
    await vi.advanceTimersByTimeAsync(5000);
    const tick = refresh.mock.results[0];
    if (tick?.type !== "return") throw new Error("Expected an idle refresh");
    await tick.value;
    expect(list).toHaveBeenCalledTimes(2);
  } finally {
    f.panel.dispose();
    await f.panel.refresh();
  }
});

it("refreshes immediately on a tool start while the idle timer is pending", async () => {
  const f = await fixture(false, { activeIntervalMs: 10, idleIntervalMs: 100 });
  const list = vi.spyOn(f.core, "list");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  f.panel.watch();
  await f.panel.refresh();
  try {
    const started = await f.tools.execute({ action: "start", name: "instant", command: "cat" });
    const update = f.events.filter(event => event.type === "processes.update").at(-1);
    expect(update?.snapshot.processes).toMatchObject([{ id: started.process?.id, name: "instant", status: "running" }]);
    expect(list).toHaveBeenCalledTimes(2);
    const refresh = vi.spyOn(f.panel, "refresh");
    await vi.advanceTimersByTimeAsync(10);
    const tick = refresh.mock.results[0];
    if (tick?.type !== "return") throw new Error("Expected an active refresh");
    await tick.value;
    expect(list).toHaveBeenCalledTimes(3);
  } finally {
    f.panel.dispose();
    await f.panel.refresh();
  }
});

it("refreshes stop and clear immediately, then returns to idle polling and detaches on disposal", async () => {
  const f = await fixture(false, { activeIntervalMs: 10, idleIntervalMs: 100 });
  const list = vi.spyOn(f.core, "list");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  f.panel.watch();
  await f.panel.refresh();
  try {
    const started = await f.tools.execute({ action: "start", name: "short", command: "cat" });
    const id = started.process?.id;
    if (id === undefined) throw new Error("Process did not start");
    await f.tools.execute({ action: "stop", id });
    expect(f.panel.runningCount).toBe(0);
    const afterStop = list.mock.calls.length;
    await vi.advanceTimersByTimeAsync(50);
    expect(list).toHaveBeenCalledTimes(afterStop);
    await f.tools.execute({ action: "clear" });
    expect(f.events.at(-1)).toEqual({ type: "processes.update", snapshot: { available: true, writeSupported: true, processes: [] } });
    f.panel.dispose();
    const afterDispose = list.mock.calls.length;
    await f.tools.execute({ action: "start", name: "detached", command: "cat" });
    await vi.advanceTimersByTimeAsync(100);
    expect(list).toHaveBeenCalledTimes(afterDispose);
  } finally {
    f.panel.dispose();
    await f.panel.refresh();
  }
});

it("keeps the active cadence for terminating processes and publishes new output on each tick", async () => {
  const f = await fixture(false, { activeIntervalMs: 10, idleIntervalMs: 100 });
  const list = vi.spyOn(f.core, "list");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  f.panel.watch();
  await f.panel.refresh();
  try {
    const started = await f.tools.execute({ action: "start", name: "stopping", command: "cat" });
    const id = started.process?.id;
    if (id === undefined) throw new Error("Process did not start");
    f.control.launcher.stop = () => Promise.resolve();
    await f.tools.execute({ action: "stop", id });
    expect(f.events.at(-1)).toMatchObject({ type: "processes.update", snapshot: { processes: [{ status: "terminating" }] } });
    expect(f.panel.runningCount).toBe(1);
    const record = await f.core.status(id);
    await appendFile(join(record.directory, "output.log"), "stopping\n");
    const beforeTick = list.mock.calls.length;
    const refresh = vi.spyOn(f.panel, "refresh");
    await vi.advanceTimersByTimeAsync(10);
    const tick = refresh.mock.results[0];
    if (tick?.type !== "return") throw new Error("Expected a terminating refresh");
    await tick.value;
    expect(list).toHaveBeenCalledTimes(beforeTick + 1);
    expect(f.events).toContainEqual({ type: "processes.output", id, lines: [{ type: "stdout", text: "stopping" }], droppedLines: 0 });
  } finally {
    f.panel.dispose();
    await f.panel.refresh();
  }
});

it("refreshes again when a start overlaps an older snapshot", async () => {
  const f = await fixture();
  await f.tools.execute({ action: "start", name: "existing", command: "cat" });
  const reading = deferred();
  const resume = deferred();
  const mutated = deferred();
  const tail = f.core.lastOutput.bind(f.core);
  let paused = false;
  f.core.lastOutput = async id => {
    if (!paused) { paused = true; reading.resolve(); await resume.promise; }
    return tail(id);
  };
  const start = f.core.start.bind(f.core);
  f.core.start = async options => {
    const result = await start(options);
    mutated.resolve();
    return result;
  };
  f.panel.watch();
  try {
    await reading.promise;
    const starting = f.tools.execute({ action: "start", name: "new", command: "cat" });
    await mutated.promise;
    resume.resolve();
    await starting;
    const update = f.events.filter(event => event.type === "processes.update").at(-1);
    expect(update?.snapshot.processes.map(process => process.name).sort()).toEqual(["existing", "new"]);
  } finally {
    resume.resolve();
    f.panel.dispose();
    await f.panel.refresh();
  }
});

it("refreshes panel output immediately after writing stdin through the HTTP panel path", async () => {
  const f = await fixture(true);
  const started = await f.tools.execute({ action: "start", name: "input", command: "cat" });
  const id = started.process?.id;
  if (id === undefined) throw new Error("Process did not start");
  const record = await f.core.status(id);
  await f.panel.refresh();
  f.events.length = 0;
  await appendFile(join(record.directory, "output.log"), "pending\n");
  await expect.poll(() => f.panel.write(id, "", true)).toEqual({ ok: true, bytesWritten: 0 });
  expect(f.events).toContainEqual({ type: "processes.output", id, lines: [{ type: "stdout", text: "pending" }], droppedLines: 0 });
});
