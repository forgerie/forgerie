import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAgentVisibleEnvKey } from "../sessiond/agentProcessEnvironment.js";
import { promisify } from "node:util";
import type { WorkspaceServicesOwner, WorkspaceServicesRecord } from "./workspaceServicesStore.js";

const execute = promisify(execFile);
const PROCESS_COMPOSE_FLAKE = "github:NixOS/nixpkgs/e72e4f299401a3689d4b3d5fc6496b11db7064eb#process-compose";
const PROCESS_COMPOSE_VERSION = "1.120.0";
export interface WorkspaceServicesLauncher {
  prepare(): Promise<WorkspaceServicesOwner | undefined>;
  launch(record: WorkspaceServicesRecord, prefix: string[], file: string, saveOwner: (owner: WorkspaceServicesOwner) => Promise<void>): Promise<void>;
  state(owner: WorkspaceServicesOwner, signal?: AbortSignal): Promise<"alive" | "exited" | "unknown">;
}

/** Independent supervision, never a child in sessiond's systemd cgroup. */
export class LocalWorkspaceServicesLauncher implements WorkspaceServicesLauncher {
  private runtime: Promise<string> | undefined;
  constructor(private readonly directory: string, private readonly executable?: string, private readonly environment: NodeJS.ProcessEnv = process.env) {}
  async prepare(): Promise<WorkspaceServicesOwner | undefined> {
    if (process.platform === "win32") throw new Error("Workspace services require a Unix-like host with Nix");
    try {
      await execute("systemctl", ["--user", "show", "--property=SystemState"], { timeout: 5000, env: this.environment });
      return { kind: "systemd", unit: `forgerie-services-${randomUUID()}.service` };
    } catch {
      const cgroup = await readFile("/proc/self/cgroup", "utf8").catch((error: unknown) => {
        if (process.platform === "linux") throw new Error("Cannot inspect the Linux supervision boundary. Expose /proc before starting workspace services.", { cause: error });
        return "";
      });
      if (this.environment["INVOCATION_ID"] !== undefined || /\.service(?:\/|$)/m.test(cgroup)) throw new Error("Independent user supervision is unavailable. Cannot keep services alive across Forgerie restarts in this deployment.");
      await execute("ps", ["-p", String(process.pid), "-o", "sess=,stat="], { timeout: 5000, maxBuffer: 16 * 1024, env: this.environment }).catch((error: unknown) => {
        throw new Error("Detached workspace services require ps with session and process-state columns", { cause: error });
      });
      return undefined;
    }
  }
  async launch(record: WorkspaceServicesRecord, prefix: string[], file: string, saveOwner: (owner: WorkspaceServicesOwner) => Promise<void>): Promise<void> {
    const binary = await this.binary();
    const args = [...prefix, binary, "up", "-t=false", "--keep-project", "--disable-dotenv", "--ordered-shutdown", "-U", "-u", record.socket, "--token-file", record.tokenFile, "-f", file, "-L", join(record.directory, "supervisor.log")];
    const command = args.shift();
    if (command === undefined) throw new Error("Workspace services command is empty");
    const env = Object.fromEntries(Object.entries(this.environment).filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && isAgentVisibleEnvKey(key) && !key.startsWith("PC_") && !key.startsWith("MEMORY_PRESSURE_") && !["INVOCATION_ID", "JOURNAL_STREAM", "SYSTEMD_EXEC_PID", "NOTIFY_SOCKET"].includes(key) && value !== undefined));
    Object.assign(env, { FORGERIE_WORKTREE_PATH: record.cwd, FORGERIE_STATE_DIR: join(record.directory, "data") });
    for (const [name, port] of Object.entries(record.ports)) env[`FORGERIE_PORT_${name.toUpperCase()}`] = String(port);
    const specification = join(record.directory, "launch.json");
    await writeFile(specification, JSON.stringify({ command, args, env, cwd: record.cwd }), { mode: 0o600 });
    const source = fileURLToPath(import.meta.url);
    const runner = join(dirname(source), `workspaceServicesRunner${extname(source)}`);
    if (record.owner?.kind === "systemd") {
      await execute("systemd-run", ["--user", "--quiet", "--collect", `--unit=${record.owner.unit}`, "--property=Type=exec", "--property=KillMode=control-group", `--property=WorkingDirectory=${record.cwd}`,
        "--", process.execPath, runner, specification], { cwd: record.cwd, env: this.environment, timeout: 30_000, maxBuffer: 64 * 1024 });
      return;
    }
    const output = await open(join(record.directory, "launcher.log"), "a", 0o600);
    try {
      const child = spawn(process.execPath, [runner, specification], { cwd: record.cwd, env, detached: true, stdio: ["ignore", output.fd, output.fd] });
      await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      if (child.pid === undefined) throw new Error("Workspace services process has no identity");
      const birth = await processBirth(child.pid);
      if (birth === undefined) throw new Error("Cannot record workspace services process identity");
      child.unref();
      // `sess` is a numeric SID on Linux and an opaque session identity on BSD-derived hosts.
      const { stdout } = await execute("ps", ["-p", String(child.pid), "-o", "sess="], { timeout: 5000, env: this.environment });
      const session = stdout.trim();
      if (session === "" || /\s/.test(session)) throw new Error("Cannot record workspace services session identity");
      await saveOwner({ kind: "process", pid: child.pid, birth, session });
    } finally { await output.close(); }
  }
  async state(owner: WorkspaceServicesOwner, signal?: AbortSignal): Promise<"alive" | "exited" | "unknown"> {
    if (owner.kind === "systemd") {
      try {
        const { stdout } = await execute("systemctl", ["--user", "show", owner.unit, "--property=ActiveState", "--property=LoadState"], { timeout: 5000, signal, env: this.environment });
        if (/ActiveState=(active|activating|deactivating)/.test(stdout)) return "alive";
        if (/ActiveState=(inactive|failed)/.test(stdout) || stdout.includes('LoadState=not-found')) return "exited";
        return "unknown";
      } catch { return "unknown"; }
    }
    try {
      const birth = await processBirth(owner.pid, signal);
      if (birth === owner.birth) return "alive";
      // Linux cannot reuse a session leader's PID while that session still exists.
      if (process.platform === "linux" && birth !== undefined) return "exited";
      const session = owner.session ?? (process.platform === "linux" ? String(owner.pid) : undefined);
      if (session === undefined) return "unknown";
      // Process Compose gives each worker its own process group within the launcher's detached Unix session.
      const { stdout } = await execute("ps", ["-axo", "sess=,stat="], { timeout: 5000, maxBuffer: 1024 * 1024, signal, env: this.environment });
      const surviving = stdout.split("\n").some((line) => {
        const [identity, state] = line.trim().split(/\s+/);
        // Container init processes do not always reap orphaned zombies. Zombies cannot keep a service running.
        return identity === session && state?.startsWith("Z") !== true;
      });
      return surviving ? "unknown" : "exited";
    } catch { return "unknown"; }
  }
  private binary(): Promise<string> {
    const provisioning = this.executable === undefined
      ? () => execute("nix", ["build", PROCESS_COMPOSE_FLAKE, "--out-link", join(this.directory, "runtime")], { timeout: 10 * 60_000, maxBuffer: 64 * 1024, env: this.environment }).then(() => join(this.directory, "runtime/bin/process-compose"))
      : () => Promise.resolve(this.executable);
    this.runtime ??= provisioning().then(async (binary) => {
      if (binary === undefined) throw new Error("Workspace services runtime is missing");
      const { stdout } = await execute(binary, ["version"], { timeout: 5000, maxBuffer: 16 * 1024, env: this.environment });
      if (/^Version:\s+v([^\s]+)\s*$/m.exec(stdout)?.[1] !== PROCESS_COMPOSE_VERSION) throw new Error(`Workspace services require Process Compose ${PROCESS_COMPOSE_VERSION}`);
      return binary;
    }).catch((error: unknown) => { this.runtime = undefined; throw error; });
    return this.runtime;
  }
}

async function processBirth(pid: number, signal?: AbortSignal): Promise<string | undefined> {
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${String(pid)}/stat`, { encoding: "utf8", signal });
      // comm can contain spaces and parentheses. Fields after its last ')' start at state, field 3.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z") return undefined;
      const started = fields[19];
      if (started === undefined || !/^\d+$/.test(started)) throw new Error("Invalid service process birth identity");
      const boot = (await readFile("/proc/sys/kernel/random/boot_id", { encoding: "utf8", signal })).trim();
      return `${boot}:${started}`;
    } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined; throw error; }
  }
  try {
    const { stdout } = await execute("ps", ["-p", String(pid), "-o", "lstart="], { timeout: 5000, signal });
    return stdout.trim() || undefined;
  } catch (error) { if (error instanceof Error && "code" in error && error.code === 1) return undefined; throw error; }
}
