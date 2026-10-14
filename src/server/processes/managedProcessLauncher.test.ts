import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { AttachedManagedProcessLauncher, managedProcessUnits, prepareManagedProcessLauncher } from "./managedProcessLauncher.js";
import { ManagedProcesses } from "./managedProcesses.js";
import type { ManagedProcessInputResult, ManagedProcessSnapshot } from "./managedProcessTypes.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "attached-process-")); directories.push(directory);
  const launcher = new AttachedManagedProcessLauncher();
  const manager = new ManagedProcesses({ stateDirectory: directory, sessionId: "attached", launcher, environment: { PATH: process.env["PATH"], HOME: directory } });
  await manager.initialize();
  return { directory, launcher, manager };
}
async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  for (let index = 0; index < 200; index++) { const value = await read(); if (accept(value)) return value; await delay(10); }
  throw new Error("Managed process did not reach the expected state");
}
const ended = (snapshot: ManagedProcessSnapshot) => snapshot.state.kind === "ended";
const written = (result: ManagedProcessInputResult) => result.kind === "written";

describe("attached managed process launcher", () => {
  it("selects attached supervision when the user-manager probe cannot run", async () => {
    expect((await prepareManagedProcessLauncher({ PATH: "/nonexistent" })).supervision.kind).toBe("attached");
  });
  it("uses one session slice without accidental UUID ancestor slices", () => {
    const first = managedProcessUnits("a-b-c", "one");
    const second = managedProcessUnits("a-b-c", "two");
    expect(first.slice).toBe(second.slice);
    expect(first.unit).not.toBe(second.unit);
    expect(first.slice).toMatch(/^forgerie-proc-[a-f0-9]{64}\.slice$/);
    expect(managedProcessUnits("a_b_c", "one").slice).not.toBe(first.slice);
  });
  it("keeps stdin open across writers, records exact exit and marks every record attached", async () => {
    const { manager, directory } = await setup();
    try {
      const record = await manager.start({ id: "reader", cwd: directory, command: "while IFS= read -r line; do printf '%s\\n' \"$line\"; done; printf tail; exit 7" });
      expect(record.supervision.kind).toBe("attached");
      await waitFor(() => manager.writeStdin("reader", "first\n"), written);
      await delay(30);
      expect((await manager.status("reader")).state.kind).toBe("running");
      expect(await manager.writeStdin("reader", "second\n")).toEqual({ kind: "written", bytesWritten: 7 });
      await waitFor(() => manager.closeStdin("reader"), written);
      const snapshot = await waitFor(() => manager.status("reader"), ended);
      expect(snapshot.state).toEqual({ kind: "ended", result: { result: "exit-code", code: "exited", status: "7" } });
      expect((await manager.readOutput("reader")).lines.map((line) => line.text)).toEqual(["first", "second", "tail"]);
      expect((await manager.writeStdin("reader", "no reader")).kind).toBe("stdin-closed");
      expect((await manager.closeStdin("reader")).kind).toBe("stdin-closed");
    } finally { await manager.dispose(); }
  });
  it("returns stdin-full with an exact partial byte count instead of blocking", async () => {
    const { manager, directory } = await setup();
    try {
      await manager.start({ id: "full", cwd: directory, command: "exec sleep 30" });
      const result = await waitFor(() => manager.writeStdin("full", Buffer.alloc(1024 * 1024)), (value) => value.kind !== "stdin-closed");
      expect(result.kind).toBe("stdin-full");
      expect(result.bytesWritten).toBeGreaterThan(0);
      expect(result.bytesWritten).toBeLessThan(1024 * 1024);
      expect(await manager.writeStdin("full", "x")).toEqual({ kind: "stdin-full", bytesWritten: 0 });
    } finally { await manager.dispose(); }
  });
  it("escalates a TERM-ignoring attached process and ends attached processes on disposal", async () => {
    const { manager, directory } = await setup();
    try {
      const record = await manager.start({ id: "stubborn", cwd: directory, stopTimeoutSeconds: 0.1,
        command: "trap '' TERM; printf ready; while :; do sleep 1; done" });
      await waitFor(() => readFile(join(record.directory, "output.log"), "utf8"), (value) => value === "ready");
      await manager.stop("stubborn");
      expect((await waitFor(() => manager.status("stubborn"), ended)).state).toEqual({ kind: "ended", result: { result: "signal", code: "killed", status: "KILL" } });
      const other = await manager.start({ id: "other", cwd: directory, command: "exec sleep 30" });
      await manager.dispose();
      expect(await readFile(join(other.directory, "result"), "utf8")).toContain("TERM");
    } finally { await manager.dispose(); }
  });
  it("reports records of a previous attached launcher as lost, never as running PIDs", async () => {
    const { manager, directory } = await setup();
    const record = await manager.start({ id: "old", cwd: directory, command: "exit 0" });
    await waitFor(() => manager.status("old"), ended);
    await manager.dispose();
    await rm(join(record.directory, "result"));
    const resumed = new ManagedProcesses({ stateDirectory: directory, sessionId: "attached", launcher: new AttachedManagedProcessLauncher() });
    try { expect((await resumed.initialize())[0]?.state.kind).toBe("lost"); }
    finally { await resumed.dispose(); }
  });
  it("fails closed on corrupt durable state", async () => {
    const { manager, directory } = await setup();
    try {
      const record = await manager.start({ id: "corrupt", cwd: directory, command: "exit 0" });
      await waitFor(() => manager.status("corrupt"), ended);
      await writeFile(join(record.directory, "result"), "success");
      await expect(manager.status("corrupt")).rejects.toThrow("Invalid managed process result");
    } finally { await manager.dispose(); }
  });
});
