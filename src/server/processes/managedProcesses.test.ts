import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ManagedProcesses } from "./managedProcesses.js";
import type { ManagedProcessLauncher, ManagedProcessRecord } from "./managedProcessTypes.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), "managed-core-")); directories.push(path); return path; }
function controlledLauncher() {
  const live = new Set<string>();
  const started: ManagedProcessRecord[] = [];
  const launcher: ManagedProcessLauncher = {
    supervision: { kind: "systemd" },
    launch: (record) => { started.push(record); live.add(record.id); return Promise.resolve(); },
    inspect: (record) => Promise.resolve(live.has(record.id) ? "running" : "gone"),
    stop: (record) => { live.delete(record.id); return Promise.resolve(); },
    stopSession: () => { live.clear(); return Promise.resolve(); },
    release: () => Promise.resolve(),
  };
  return { launcher, live, started };
}

describe("managed processes", () => {
  it("gives one owner the session lease and releases it without stopping durable processes", async () => {
    const root = await directory(); const { launcher } = controlledLauncher();
    const first = new ManagedProcesses({ stateDirectory: root, sessionId: "lease", launcher });
    const second = new ManagedProcesses({ stateDirectory: root, sessionId: "lease", launcher });
    await first.initialize();
    try {
      await first.start({ id: "one", command: "cat", cwd: root });
      await expect(second.initialize()).rejects.toMatchObject({ code: "ELOCKED" });
      await first.dispose();
      expect((await second.initialize())[0]?.state.kind).toBe("running");
    } finally { await first.dispose(); await second.dispose(); }
  });
  it("keeps failed launch intent, but never retries it during recovery", async () => {
    const root = await directory(); const { launcher, started } = controlledLauncher();
    launcher.launch = () => Promise.reject(new Error("client died before receiving the launch reply"));
    const first = new ManagedProcesses({ stateDirectory: root, sessionId: "uncertain", launcher });
    await first.initialize();
    try { await expect(first.start({ id: "one", command: "do-not-repeat", cwd: root })).rejects.toMatchObject({ name: "ManagedProcessLaunchError", id: "one" }); }
    finally { await first.dispose(); }
    const second = new ManagedProcesses({ stateDirectory: root, sessionId: "uncertain", launcher });
    try {
      expect((await second.initialize())[0]?.state.kind).toBe("lost");
      expect(started).toEqual([]);
    } finally { await second.dispose(); }
  });
  it("reads a result published between first lookup and supervisor inspection", async () => {
    const root = await directory(); const { launcher } = controlledLauncher();
    const manager = new ManagedProcesses({ stateDirectory: root, sessionId: "result-race", launcher });
    try {
      await manager.initialize(); const record = await manager.start({ id: "one", command: "cat", cwd: root });
      launcher.inspect = async () => { await writeFile(join(record.directory, "result"), "signal\nkilled\nKILL\n"); return "gone"; };
      expect((await manager.status("one")).state).toEqual({ kind: "ended", result: { result: "signal", code: "killed", status: "KILL" } });
    } finally { await manager.dispose(); }
  });
  it("recovers running, ended and lost processes without ever re-running commands", async () => {
    const root = await directory();
    const { launcher, live, started } = controlledLauncher();
    const first = new ManagedProcesses({ stateDirectory: root, sessionId: "session-a", launcher });
    await first.initialize();
    const running = await first.start({ id: "running", command: "cat", cwd: root });
    const ended = await first.start({ id: "ended", command: "exit 7", cwd: root });
    await first.start({ id: "lost", command: "do-not-repeat", cwd: root });
    live.delete("ended"); live.delete("lost");
    await writeFile(join(ended.directory, "result"), "exit-code\nexited\n7\n");
    await first.dispose();
    const second = new ManagedProcesses({ stateDirectory: root, sessionId: "session-a", launcher });
    try {
      const records = await second.initialize();
      expect(records.map((record) => [record.id, record.state])).toEqual([
        ["ended", { kind: "ended", result: { result: "exit-code", code: "exited", status: "7" } }],
        ["lost", { kind: "lost" }],
        ["running", { kind: "running" }],
      ]);
      expect(started).toHaveLength(3);
      expect(records.find((record) => record.id === "running")?.directory).toBe(running.directory);
      live.add("lost");
      expect((await second.status("lost")).state.kind).toBe("lost");
      await expect(second.start({ id: "lost", command: "repeat", cwd: root })).rejects.toThrow();
    } finally { await second.dispose(); }
  });

  it("persists read acknowledgements and leaves unread output available after restart", async () => {
    const root = await directory(); const { launcher } = controlledLauncher();
    const first = new ManagedProcesses({ stateDirectory: root, sessionId: "reads", launcher });
    await first.initialize();
    const record = await first.start({ id: "one", command: "cat", cwd: root });
    await writeFile(join(record.directory, "output.log"), "first\nsecond\npartial");
    const batch = await first.readOutput("one");
    expect(batch.lines.map((line) => line.text)).toEqual(["first", "second"]);
    expect((await first.readOutput("one")).lines).toEqual(batch.lines);
    await first.acknowledgeOutput("one", batch.cursor);
    await first.dispose();
    const second = new ManagedProcesses({ stateDirectory: root, sessionId: "reads", launcher });
    try {
      await second.initialize();
      expect((await second.readOutput("one")).lines).toEqual([]);
      await writeFile(join(record.directory, "result"), "success\nexited\n0\n");
      const tail = await second.readOutput("one");
      expect(tail.lines).toEqual([{ number: 3, text: "partial", terminated: false, truncatedStart: false }]);
      await second.acknowledgeOutput("one", tail.cursor);
      expect((await second.readOutput("one")).lines).toEqual([]);
    } finally { await second.dispose(); }
  });

  it("does not classify manager inspection failures as lost", async () => {
    const root = await directory(); const { launcher } = controlledLauncher();
    const manager = new ManagedProcesses({ stateDirectory: root, sessionId: "errors", launcher });
    try {
      await manager.initialize(); await manager.start({ id: "one", command: "cat", cwd: root });
      launcher.inspect = () => Promise.reject(new Error("manager unavailable"));
      await expect(manager.status("one")).rejects.toThrow("manager unavailable");
      await expect(readFile(join(root, "managed-processes/errors/one/lost.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await manager.dispose(); }
  });

  it("rejects invalid boundaries before creating a process and filters the agent environment", async () => {
    const root = await directory(); const { launcher, started } = controlledLauncher();
    const manager = new ManagedProcesses({ stateDirectory: root, sessionId: "validation", launcher,
      environment: { PATH: "/agent/bin", PI_WEB_DATA_DIR: "/private", NODE_ENV: "production", PORT: "12", HOME: root, PI_WEB_DOCKER_HOST: "safe" } });
    try {
      await manager.initialize();
      await expect(manager.start({ id: "../escape", command: "cat", cwd: root })).rejects.toThrow();
      await expect(manager.start({ command: "cat", cwd: "relative" })).rejects.toThrow();
      await expect(manager.start({ command: "cat", cwd: root, stopTimeoutSeconds: 0 })).rejects.toThrow();
      await manager.start({ command: "echo '$HOME'", cwd: root });
      expect(started[0]?.environment).toEqual({ PATH: "/agent/bin", HOME: root, PI_WEB_DOCKER_HOST: "safe", PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", GFORTRAN_UNBUFFERED_ALL: "y", NSUnbufferedIO: "YES", NO_COLOR: "1" });
    } finally { await manager.dispose(); }
  });
});
