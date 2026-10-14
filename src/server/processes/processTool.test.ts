import { appendFile, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ManagedProcesses } from "./managedProcesses.js";
import type { ManagedProcessLauncher, ManagedProcessRecord } from "./managedProcessTypes.js";
import { ManagedProcessTools } from "./processTool.js";
import type { ProcessEventSummary } from "./processWatchState.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture(attached = false) {
  const root = await mkdtemp(join(tmpdir(), "forgerie-process-tool-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const live = new Map<string, ManagedProcessRecord>();
  const launcher: ManagedProcessLauncher = {
    supervision: attached ? { kind: "attached", instance: "8bdc9320-3afc-4c7c-87c7-2a1fabc0a3b1" } : { kind: "systemd" },
    launch: (record) => { live.set(record.id, record); return Promise.resolve(); },
    inspect: (record) => Promise.resolve(live.has(record.id) ? "running" : "gone"),
    stop: (record) => { live.delete(record.id); return Promise.resolve(); },
    stopSession: () => { live.clear(); return Promise.resolve(); }, release: () => Promise.resolve(),
  };
  const summaries: ProcessEventSummary[] = [];
  let core: ManagedProcesses;
  async function open() {
    core = new ManagedProcesses({ stateDirectory: root, sessionId: "test", launcher, environment: { SECRET_TOKEN: "private-value", PATH: process.env["PATH"] } });
    await core.initialize();
    cleanups.push(() => core.dispose());
    const tool = new ManagedProcessTools({ sessionId: "test", cwd: root, stateFile: join(root, "watches.json"), getManagedProcesses: () => Promise.resolve(core) });
    await tool.initialize((summary) => { summaries.push(summary); return Promise.resolve(); });
    return tool;
  }
  const tool = await open();
  return { tool, open, summaries, live, core: () => core, root,
    log: (id: string, text: string) => appendFile(join(root, "managed-processes/test", id, "output.log"), text),
    end: (id: string) => writeFile(join(root, "managed-processes/test", id, "result"), "success\nexited\n0\n") };
}

it("projects tool actions without private records and browsing never consumes watch output", async () => {
  const f = await fixture();
  const started = await f.tool.execute({ action: "start", name: "build", command: "build", notify: { logMatches: [{ pattern: "ready" }] } });
  const id = started.process?.id;
  if (id === undefined) throw new Error("No process ID");
  await f.log(id, "ready\n");
  expect(await f.tool.execute({ action: "output", id })).toMatchObject({ lines: [{ number: 1, text: "ready" }] });
  expect((await f.core().readOutput(id)).lines).toHaveLength(1);
  await f.tool.dispatch(false);
  expect(f.summaries).toHaveLength(1);
  expect((await f.core().readOutput(id)).lines).toHaveLength(0);
  const listed = await f.tool.execute({ action: "list" });
  expect(JSON.stringify(listed)).not.toMatch(/private-value|environment|instance/);
  expect(listed.processes?.[0]).toMatchObject({ name: "build", status: "running" });
});

it("replays missed matches and exits as one summary after dispose and a new owner, with watch attention preserved", async () => {
  const f = await fixture();
  const one = await f.tool.execute({ action: "start", name: "one", command: "one", notify: { onSuccess: "context", logMatches: [{ pattern: "ready", on: "turn" }, { pattern: "quiet", on: "ignore" }] } });
  const two = await f.tool.execute({ action: "start", name: "two", command: "two", notify: { onSuccess: "ignore", logMatches: [{ pattern: "info", on: "context" }] } });
  const id = one.process?.id; const second = two.process?.id;
  if (id === undefined || second === undefined) throw new Error("No ID");
  await f.tool.dispose(); await f.core().dispose();
  await f.log(id, "ready\nquiet\n"); await f.log(second, "info\n"); await f.end(id); await f.end(second);
  const resumed = await f.open();
  expect(f.summaries).toHaveLength(1);
  expect(f.summaries[0]).toMatchObject({ missed: true });
  expect(f.summaries[0]?.events.map(event => event.attention).sort()).toEqual(["context", "context", "ignore", "ignore", "turn"]);
  await resumed.dispatch(false);
  expect(f.summaries).toHaveLength(1);
  await resumed.dispose(); await f.core().dispose(); await f.open();
  expect(f.summaries).toHaveLength(1);
});

it("reports a lost process as ended, never launches it again, and labels attached results", async () => {
  const f = await fixture(true);
  const started = await f.tool.execute({ action: "start", name: "attached", command: "cat" });
  const id = started.process?.id;
  if (id === undefined) throw new Error("No ID");
  expect(started.process?.notice).toBe("Attached process: ends when Forgerie restarts.");
  f.live.delete(id);
  const output = await f.tool.execute({ action: "output", id });
  expect(output.process).toMatchObject({ state: "ended", reason: "supervisor lost", notice: "Attached process: ends when Forgerie restarts." });
  await f.tool.dispatch(false);
  expect(f.summaries[0]?.events[0]).toMatchObject({ reason: "supervisor lost", attention: "turn" });
  expect(f.live.size).toBe(0);
});

it("validates before launch, updates watches from current output, and suppresses intentional stop events", async () => {
  const f = await fixture();
  expect((await f.tool.execute({ action: "start", name: "bad", command: "bad", notify: { logMatches: [{ pattern: " " }] } })).error).toContain("patterns");
  expect(f.live.size).toBe(0);
  const started = await f.tool.execute({ action: "start", name: "watch", command: "watch", notify: { logMatches: [{ pattern: "ready", repeat: true }] } });
  const id = started.process?.id;
  if (id === undefined) throw new Error("No ID");
  await f.log(id, "old\nready\n");
  expect(await f.tool.execute({ action: "update", id, name: "renamed", watches: { mode: "replace", items: [{ pattern: "old" }, { pattern: "new", mode: "regex", on: "context" }] } })).toMatchObject({ process: { name: "renamed" } });
  expect(f.summaries).toHaveLength(1);
  await f.log(id, "new\nnew\n"); await f.tool.dispatch(false);
  expect(f.summaries).toHaveLength(2);
  expect(f.summaries[1]?.events).toMatchObject([{ name: "renamed", count: 1, attention: "context", line: 3 }]);
  await f.tool.execute({ action: "update", id, watches: { mode: "remove", items: [{ index: 0, pattern: "new" }] } });
  expect((await f.tool.execute({ action: "list" })).processes?.[0]?.watches).toHaveLength(1);
  await f.tool.execute({ action: "update", id, watches: { mode: "clear" } });
  expect((await f.tool.execute({ action: "list", statuses: ["running"] })).processes?.[0]?.watches).toEqual([]);
  expect(await f.tool.execute({ action: "write", id })).toMatchObject({ error: "write requires input or end: true" });
  await f.tool.execute({ action: "stop", id }); await f.tool.dispatch(false);
  expect(f.summaries).toHaveLength(2);
  expect((await f.tool.execute({ action: "list", statuses: ["running"] })).processes).toEqual([]);
});

it("retains failed delivery in the fsynced outbox and merges it with later missed events on resume", async () => {
  const f = await fixture();
  const started = await f.tool.execute({ action: "start", name: "repeat", command: "repeat", notify: { logMatches: [{ pattern: "ready", repeat: true }] } });
  const id = started.process?.id;
  if (id === undefined) throw new Error("No ID");
  await f.tool.dispose();
  const failing = new ManagedProcessTools({ sessionId: "test", cwd: f.root, stateFile: join(f.root, "watches.json"), getManagedProcesses: () => Promise.resolve(f.core()) });
  let failedId: string | undefined;
  await failing.initialize(summary => { failedId = summary.id; return Promise.reject(new Error("Delivery unavailable")); });
  await f.log(id, "ready\n");
  await expect(failing.dispatch(false)).rejects.toThrow("Delivery unavailable");
  expect((await f.core().readOutput(id)).lines).toEqual([]);
  expect(await readFile(join(f.root, "watches.json"), "utf8")).toContain('"samples":[{"number":1,"text":"ready"}]');
  await failing.dispose(); await f.core().dispose();
  await f.log(id, "ready\n");
  await f.open();
  expect(f.summaries).toHaveLength(1);
  expect(f.summaries[0]?.missed).toBe(true);
  expect(f.summaries[0]?.events.map(event => event.line)).toEqual([1, 2]);
  expect(f.summaries[0]?.id).not.toBe(failedId);
  expect((await f.core().readOutput(id)).lines).toEqual([]);
});

it("preserves absolute lines across batches and bounds output without consuming repeat watches", async () => {
  const f = await fixture();
  const started = await f.tool.execute({ action: "start", name: "many", command: "many", notify: { logMatches: [{ pattern: "line", repeat: true }] } });
  const id = started.process?.id;
  if (id === undefined) throw new Error("No ID");
  await f.log(id, Array.from({ length: 2100 }, (_, index) => `line ${String(index + 1)} ${"x".repeat(50)}\n`).join(""));
  const output = await f.tool.execute({ action: "output", id, tailLines: 2000 });
  expect(output.truncated).toBe(true);
  expect(output.lines?.at(-1)?.number).toBe(2100);
  await f.tool.dispatch(false);
  expect(f.summaries[0]?.events[0]).toMatchObject({ line: 2100, count: 2100 });
  expect(f.summaries[0]?.events[0]?.samples).toHaveLength(20);
});

it("persists child ownership and keepAfterChild, lets the parent update it, and clears only ended records", async () => {
  const f = await fixture();
  const start = await f.tool.execute({ action: "start", name: "child-reader", command: "cat", keepAfterChild: true }, { child: { name: "worker", runId: "persisted-run-id" } });
  const id = start.process?.id;
  if (id === undefined) throw new Error("No ID");
  expect((await f.core().status(id)).child).toEqual({ name: "worker", runId: "persisted-run-id" });
  expect(start.process).toMatchObject({ child: { name: "worker", runId: "persisted-run-id" }, keepAfterChild: true });
  expect((await f.tool.execute({ action: "update", id, keepAfterChild: false })).process?.keepAfterChild).toBe(false);
  const parent = await f.tool.execute({ action: "start", name: "parent", command: "cat", keepAfterChild: true });
  expect(parent.process?.child).toBeUndefined();
  expect((await f.tool.execute({ action: "clear" })).cleared).toEqual([]);
  await f.end(id);
  expect((await f.tool.execute({ action: "clear" })).cleared?.map(process => process.id)).toEqual([id]);
  expect((await f.tool.execute({ action: "list" })).processes?.map(process => process.name)).toEqual(["parent"]);
});
