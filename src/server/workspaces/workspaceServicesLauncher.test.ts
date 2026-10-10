import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { LocalWorkspaceServicesLauncher } from "./workspaceServicesLauncher.js";
import { ProcessComposeClient } from "./processComposeClient.js";
import { servicesTestEnvironment } from "./workspaceServices.testSupport.js";
import type { WorkspaceServicesOwner, WorkspaceServicesRecord } from "./workspaceServicesStore.js";

const roots: string[] = [];
function killGroup(group: number): void {
  try { process.kill(-group, "SIGKILL"); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(version = "1.120.0") {
  const root = await mkdtemp(join(tmpdir(), "fg-launch-")); roots.push(root);
  await mkdir(join(root, "data"));
  const binary = join(root, "configured-runtime");
  // A controlled executable exercises the production launcher, runner and actual process ownership. Real Process Compose acceptance runs separately.
  await writeFile(binary, `#!${process.execPath}\nimport http from 'node:http'; import fs from 'node:fs';\nif(process.argv[2]==='version') { console.log('Version: v${version}'); } else {\n const socket=process.argv[process.argv.indexOf('-u')+1]; const token=fs.readFileSync(process.argv[process.argv.indexOf('--token-file')+1], 'utf8').trim();\n const server=http.createServer((req,res)=>{ res.setHeader('content-type','application/json'); if(req.headers['x-pc-token-key']!==token) {res.writeHead(401).end('{}');return;} if(req.url==='/project/stop') {res.end('{}');server.close();return;} res.end(JSON.stringify({data: [{name:'web',status:'Running',is_ready:'Ready',has_ready_probe:true,restarts:0,exit_code:0}]})); }); server.listen(socket);\n}\n`, { mode: 0o700 });
  const record: WorkspaceServicesRecord = { worktreeId: "one", cwd: root, directory: root, socket: join(root, "pc.sock"), tokenFile: join(root, "token"), ports: { web: 23456 }, phase: "launching" };
  await writeFile(record.tokenFile, "private-token", { mode: 0o600 });
  const environment = servicesTestEnvironment(root);
  return { root, record, environment, launcher: new LocalWorkspaceServicesLauncher(root, binary, environment) };
}

it("launches a detached process group, records its birth identity and keeps environment values out of argv", async () => {
  const f = await fixture(); const client = new ProcessComposeClient();
  let owner: WorkspaceServicesOwner | undefined;
  f.environment["FORGERIE_ACCEPTANCE_SECRET"] = "not-a-command-argument";
  f.environment["PI_WEB_DATA_DIR"] = "/must-not-inherit";
  f.environment["PORT"] = "wrong-port";
  try {
    await f.launcher.launch(f.record, [], join(f.root, "pc.yaml"), (value) => { owner = value; f.record.owner = value; return Promise.resolve(); });
    expect(owner?.kind).toBe("process");
    if (owner?.kind !== "process") throw new Error("Missing process ownership");
    expect(await f.launcher.state(owner)).toBe("alive");
    expect((await readFile(join(f.root, "launch.json"), "utf8"))).toContain("not-a-command-argument");
    expect((await readFile(join(f.root, "launch.json"), "utf8"))).not.toContain("must-not-inherit");
    if (process.platform === "linux") expect(await readFile(`/proc/${String(owner.pid)}/cmdline`, "utf8")).not.toContain("not-a-command-argument");
    await vi.waitFor(async () => { expect(await client.processes(f.record)).toMatchObject([{ name: "web", kind: "ready" }]); });
    await client.stop(f.record);
    await vi.waitFor(async () => { if (owner === undefined) throw new Error("Missing owner"); expect(await f.launcher.state(owner)).toBe("exited"); });
  } finally {
    if (owner?.kind === "process" && await f.launcher.state(owner) !== "exited") process.kill(-owner.pid, "SIGKILL");
  }
});

it("does not print private environment values when the launch specification contains invalid JSON", async () => {
  const f = await fixture(); const specification = join(f.root, "invalid-launch.json");
  const secret = "acceptance-only-private-value";
  await writeFile(specification, `{"env":{"KEY":"${secret}"} broken}`, { mode: 0o600 });
  const stderr = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("./workspaceServicesRunner.ts", import.meta.url)), specification], { env: f.environment }).then(
    () => { throw new Error("Runner accepted an invalid specification"); },
    (error: unknown) => { if (!(error instanceof Error && "stderr" in error && typeof error.stderr === "string")) throw error; return error.stderr; },
  );
  expect(stderr).toContain("invalid JSON"); expect(stderr).not.toContain(secret);
});

it("rejects a runtime version outside the pinned contract before spawning a service", async () => {
  const f = await fixture("0.0.0");
  await expect(f.launcher.launch(f.record, [], "pc.yaml", () => Promise.resolve())).rejects.toThrow("require Process Compose 1.120.0");
});

it("fails closed inside a service when independent user supervision is unavailable", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "systemctl"), `#!${process.execPath}\nprocess.exit(1);\n`, { mode: 0o700 });
  f.environment["PATH"] = `${f.root}:${f.environment["PATH"] ?? ""}`;
  f.environment["INVOCATION_ID"] = "acceptance-only";
  await expect(f.launcher.prepare()).rejects.toThrow("Independent user supervision is unavailable");
});

it.skipIf(process.platform !== "linux" || process.env["FORGERIE_TEST_PROCESS_COMPOSE"] === undefined)("keeps an orphaned Process Compose service unverified after its supervisor group exits", async () => {
  const f = await fixture();
  const binary = process.env["FORGERIE_TEST_PROCESS_COMPOSE"];
  if (binary === undefined) throw new Error("Missing acceptance runtime");
  await writeFile(f.record.tokenFile, "f".repeat(64), { mode: 0o600 });
  await writeFile(join(f.root, "worker.mjs"), "import fs from 'node:fs'; fs.writeFileSync(process.env.FORGERIE_STATE_DIR+'/worker-pid',String(process.pid)); setInterval(()=>{},1000);");
  const config = join(f.root, "process-compose.yaml");
  await writeFile(config, `version: '0.5'\nprocesses:\n  worker:\n    command: '${process.execPath} worker.mjs'\n`);
  const launcher = new LocalWorkspaceServicesLauncher(f.root, binary, f.environment);
  let owner: WorkspaceServicesOwner | undefined;
  let workerGroup: number | undefined;
  try {
    await launcher.launch(f.record, [], config, (value) => { owner = value; return Promise.resolve(); });
    if (owner?.kind !== "process") throw new Error("Missing owner");
    const leader = owner.pid;
    let workerPid = 0;
    try {
      await vi.waitFor(async () => { workerPid = Number(await readFile(join(f.root, "data/worker-pid"), "utf8")); expect(workerPid).toBeGreaterThan(0); }, { timeout: 5000 });
    } catch (error) {
      const output = (await readFile(join(f.root, "launcher.log"), "utf8")).replaceAll("f".repeat(64), "<REDACTED>");
      throw new Error(`Acceptance worker did not start: ${output}`, { cause: error });
    }
    const stat = await readFile(`/proc/${String(workerPid)}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    workerGroup = Number(fields[2]);
    expect(workerGroup).not.toBe(leader); expect(Number(fields[3])).toBe(leader);
    process.kill(-leader, "SIGKILL");
    await vi.waitFor(async () => { if (owner === undefined) throw new Error("Missing owner"); expect(await launcher.state(owner)).not.toBe("alive"); });
    expect(await launcher.state(owner)).toBe("unknown");
  } finally {
    for (const group of [workerGroup, owner?.kind === "process" ? owner.pid : undefined]) {
      if (group === undefined) continue;
      killGroup(group);
    }
  }
});

it("does not treat a surviving process group as stopped after its supervisor exits", async () => {
  const f = await fixture();
  const binary = join(f.root, "group-child");
  await writeFile(binary, `#!${process.execPath}\nimport fs from 'node:fs'; if(process.argv[2]==='version'){console.log('Version: v1.120.0');}else{fs.writeFileSync(process.env.FORGERIE_STATE_DIR+'/child-ready','ready');setInterval(()=>{},1000);}\n`, { mode: 0o700 });
  const launcher = new LocalWorkspaceServicesLauncher(f.root, binary, f.environment);
  let owner: WorkspaceServicesOwner | undefined;
  try {
    await launcher.launch(f.record, [], "pc.yaml", (value) => { owner = value; return Promise.resolve(); });
    if (owner?.kind !== "process") throw new Error("Missing owner");
    // Wait for the runner to start its child before killing only the group leader.
    await vi.waitFor(async () => { expect(await readFile(join(f.root, "data/child-ready"), "utf8")).toBe("ready"); });
    process.kill(owner.pid, "SIGKILL");
    await vi.waitFor(async () => { if (owner === undefined) throw new Error("Missing owner"); expect(await launcher.state(owner)).toBe("unknown"); });
  } finally { if (owner?.kind === "process") process.kill(-owner.pid, "SIGKILL"); }
});
