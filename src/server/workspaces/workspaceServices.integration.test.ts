import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LocalWorkspaceServicesLauncher } from "./workspaceServicesLauncher.js";
import { WorkspaceServices } from "./workspaceServices.js";
import { servicesFixture, servicesTestEnvironment } from "./workspaceServices.testSupport.js";
import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";

const binary = process.env["FORGERIE_TEST_PROCESS_COMPOSE"];
// Opt-in external-runtime acceptance. The normal suite exercises the same manager with a real Unix-socket contract server.
describe.skipIf(binary === undefined)("pinned Process Compose acceptance", () => {
  it("isolates two worktrees, reaches readiness, retains data and reattaches after a manager restart", async () => {
    const f = await servicesFixture();
    await f.services.dispose();
    const launcher = new LocalWorkspaceServicesLauncher(f.directory, binary, servicesTestEnvironment(f.root));
    let manager = new WorkspaceServices({ directory: f.directory, worktrees: f.store, launcher, onError: (error) => { throw error; } });
    await manager.initialize();
    const records: SessionWorktreeRecord[] = [];
    try {
      for (const id of ["one", "two"]) {
        const record = await f.add(id); records.push(record);
        await writeFile(join(record.path, "server.mjs"), "import http from 'node:http'; import fs from 'node:fs'; fs.writeFileSync(process.env.FORGERIE_STATE_DIR+'/kept', 'retained'); console.log('starting '+process.env.FORGERIE_PORT_WEB); process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),4500)); http.createServer((req,res)=>{res.end(req.url==='/crash'?'fault':'workspace');if(req.url==='/crash')setImmediate(()=>process.exit(7));}).listen(Number(process.env.FORGERIE_PORT_WEB), '127.0.0.1');");
        await writeFile(join(record.path, "worker.mjs"), "import fs from 'node:fs'; const response=await fetch('http://127.0.0.1:'+process.env.FORGERIE_PORT_WEB+'/'); if(!response.ok)throw new Error('Dependency unavailable'); fs.writeFileSync(process.env.FORGERIE_STATE_DIR+'/dependency-ready',await response.text());");
        await writeFile(join(record.path, "process-compose.yaml"), `version: '0.5'\nprocesses:\n  web:\n    command: '${process.execPath} server.mjs'\n    availability:\n      restart: on_failure\n      backoff_seconds: 1\n      max_restarts: 3\n    readiness_probe:\n      http_get:\n        host: 127.0.0.1\n        port: \${FORGERIE_PORT_WEB}\n        path: /\n      initial_delay_seconds: 0\n      period_seconds: 1\n  worker:\n    command: '${process.execPath} worker.mjs'\n    depends_on:\n      web:\n        condition: process_healthy\n`);
      }
      const [one, two] = await Promise.all(records.map((record) => manager.action(record.id, { action: "start", approve: true })));
      expect(one).toMatchObject({ kind: "running" }); expect(two).toMatchObject({ kind: "running" });
      if (one?.kind !== "running" || two?.kind !== "running") throw new Error("Missing service snapshots");
      expect(one.ports["web"]).not.toBe(two.ports["web"]);
      expect(one.stateDirectory).not.toBe(two.stateDirectory);
      for (const record of records) expect(await manager.wait(record.id, { timeoutMs: 10_000 })).toMatchObject({ kind: "ready" });
      expect(await readFile(join(one.stateDirectory, "dependency-ready"), "utf8")).toBe("workspace");
      expect((await manager.logs("one", "web", 5)).logs.join("\n")).toContain("starting");
      expect(await (await fetch(`http://127.0.0.1:${String(one.ports["web"])}/crash`)).text()).toBe("fault");
      await vi.waitFor(async () => {
        const snapshot = await manager.status("one");
        expect(snapshot.kind === "running" && snapshot.processes.some((item) => item.name === "web" && item.kind === "ready" && item.restarts > 0)).toBe(true);
      }, { timeout: 10_000 });
      const socket = join(dirname(one.stateDirectory), "pc.sock");
      await rename(socket, `${socket}.missing`);
      try {
        expect(await manager.status("one")).toMatchObject({ kind: "unavailable" });
        await expect(manager.action("one", { action: "start", approve: true })).rejects.toThrow("unverified");
        await expect(manager.beforeRemoval("one")).rejects.toThrow("Cannot confirm");
      } finally { await rename(`${socket}.missing`, socket); }
      const inventory = await readFile(join(f.directory, "instances.json"), "utf8");
      await manager.dispose();
      manager = new WorkspaceServices({ directory: f.directory, worktrees: f.store, launcher, onError: (error) => { throw error; } });
      await manager.initialize();
      expect(await manager.status("one")).toMatchObject({ kind: "running", ports: one.ports });
      expect(await readFile(join(f.directory, "instances.json"), "utf8")).toBe(inventory);
      await manager.action("one", { action: "restart", service: "web" });
      expect(await manager.wait("one", { timeoutMs: 10_000 })).toMatchObject({ kind: "ready" });
      await manager.beforeRemoval("one");
      expect(await manager.status("one")).toMatchObject({ kind: "stopped" });
      expect(await readFile(join(one.stateDirectory, "kept"), "utf8")).toBe("retained");
      expect(await manager.status("two")).toMatchObject({ kind: "running" });
    } finally {
      for (const record of records) await manager.beforeRemoval(record.id);
      await manager.dispose(); await f.dispose();
    }
  }, 60_000);
});
