import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceServicesLauncher } from "./workspaceServicesLauncher.js";
import type { WorkspaceServicesOwner, WorkspaceServicesRecord } from "./workspaceServicesStore.js";
import { SessionWorktreeStore } from "./sessionWorktreeStore.js";
import type { SessionWorktreeRecord } from "../../shared/sessionWorktree.js";
import { WorkspaceServices } from "./workspaceServices.js";

/** Configurable implementation of the real Unix-socket REST contract, not a global network interception. */
export class ConfiguredServicesLauncher implements WorkspaceServicesLauncher {
  launches = 0;
  reachable = true;
  alive: "alive" | "exited" | "unknown" = "alive";
  ready = true;
  hasProbe = true;
  status = "Running";
  statusDelayMs = 0;
  processReads = 0;
  pendingProcesses = 0;
  exitCode = 0;
  restarts = 0;
  invalidResponse = false;
  logCharacters = 40 * 1024;
  logCharacter = "x";
  failShutdown = false;
  private readonly servers = new Map<string, ReturnType<typeof createServer>>();
  prepare(): Promise<WorkspaceServicesOwner> { return Promise.resolve({ kind: "process", pid: process.pid, birth: "configured" }); }
  async launch(record: WorkspaceServicesRecord): Promise<void> {
    this.launches++; this.alive = "alive";
    const token = (await readFile(record.tokenFile, "utf8")).trim();
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (!this.reachable || req.headers["x-pc-token-key"] !== token) { res.writeHead(401).end('{}'); return; }
      if (req.url === "/processes") {
        this.processReads++;
        const respond = () => { res.end(JSON.stringify(this.invalidResponse ? {} : { data: [{ name: "web", status: this.status, is_ready: this.ready ? "Ready" : "Not Ready", has_ready_probe: this.hasProbe, restarts: this.restarts, exit_code: this.exitCode }] })); };
        if (this.statusDelayMs === 0) respond();
        else { this.pendingProcesses++; const timer = setTimeout(respond, this.statusDelayMs); res.once("close", () => { clearTimeout(timer); this.pendingProcesses--; }); }
        return;
      }
      if (req.url?.startsWith("/process/logs/") === true) { res.end(JSON.stringify({ logs: [this.logCharacter.repeat(this.logCharacters), "last line"] })); return; }
      if (req.url === "/project/stop") {
        res.end('{}');
        if (!this.failShutdown) server.close(() => { this.alive = "exited"; });
        return;
      }
      res.end('{}');
    });
    this.servers.set(record.worktreeId, server);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(record.socket, resolve); });
  }
  state(): Promise<"alive" | "exited" | "unknown"> { return Promise.resolve(this.alive); }
  async dispose(): Promise<void> { await Promise.all([...this.servers.values()].map((server) => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }))); }
}

export function servicesTestEnvironment(root: string): NodeJS.ProcessEnv {
  return { PATH: process.env["PATH"], HOME: root, XDG_RUNTIME_DIR: process.env["XDG_RUNTIME_DIR"], DBUS_SESSION_BUS_ADDRESS: process.env["DBUS_SESSION_BUS_ADDRESS"], PI_CODING_AGENT_DIR: join(root, "agent") };
}

export async function servicesFixture(launcher?: WorkspaceServicesLauncher) {
  const root = await mkdtemp(join(tmpdir(), "fgs-"));
  const store = new SessionWorktreeStore();
  const events: unknown[] = [];
  const errors: unknown[] = [];
  const directory = join(root, "services");
  const services = new WorkspaceServices({ directory, worktrees: store, ...(launcher === undefined ? {} : { launcher }), publish: (snapshot) => { events.push(snapshot); }, onError: (error) => { errors.push(error); } });
  const records: SessionWorktreeRecord[] = [];
  const add = async (id: string) => {
    const cwd = join(root, id);
    await mkdir(join(cwd, ".forgerie"), { recursive: true });
    await writeFile(join(cwd, ".forgerie/config.json"), JSON.stringify({ version: 2, env: "none", services: { file: "process-compose.yaml", ports: ["web"] } }));
    const timestamp = new Date().toISOString();
    const record: SessionWorktreeRecord = { id, path: cwd, repo: root, branch: id, defaultBranch: "main", renamed: false, setup: { phase: "done", log: "" }, state: { kind: "active" }, cleanup: { kind: "pending" }, transcripts: [], createdAt: timestamp, updatedAt: timestamp };
    await store.add(record); records.push(record);
    await writeFile(join(cwd, "process-compose.yaml"), "version: '0.5'\nprocesses: {}\n");
    return record;
  };
  await services.initialize();
  return { root, directory, store, services, events, errors, add, async dispose() {
    for (const record of records) await services.action(record.id, { action: "stop" }).catch(() => undefined);
    await services.dispose();
    if (launcher instanceof ConfiguredServicesLauncher) await launcher.dispose();
    await rm(root, { recursive: true, force: true });
  } };
}
