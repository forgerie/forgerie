import { mkdtemp, rm, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ManagedProcesses } from "../processes/managedProcesses.js";
import { ManagedProcessTools } from "../processes/processTool.js";
import { controlledManagedProcessLauncher } from "../processes/managedProcesses.testSupport.js";
import { AttachedManagedProcessLauncher } from "../processes/managedProcessLauncher.js";
import { ManagedProcessPanel } from "./managedProcessPanel.js";
import type { SessionUiEvent } from "../../shared/apiTypes.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(attached = false) {
  const root = await mkdtemp(join(tmpdir(), "process-panel-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const control = controlledManagedProcessLauncher();
  const core = new ManagedProcesses({ stateDirectory: root, sessionId: "panel", launcher: attached ? new AttachedManagedProcessLauncher() : control.launcher,
    environment: { PATH: process.env["PATH"], SECRET: "never-send-this" } });
  await core.initialize(); cleanup.push(() => core.dispose());
  const tools = new ManagedProcessTools({ sessionId: "panel", cwd: root, stateFile: join(root, "watches.json"), getManagedProcesses: () => Promise.resolve(core) });
  await tools.initialize(() => Promise.resolve()); cleanup.push(() => tools.dispose());
  const events: SessionUiEvent[] = [];
  const panel = new ManagedProcessPanel(() => Promise.resolve(core), tools, event => events.push(event), error => { throw error; });
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
