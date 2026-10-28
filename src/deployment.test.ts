import { chmod, mkdtemp, mkdir, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { deployCommand } from "./deployment.js";
import { createTestCommandScope } from "./subprocess.testSupport.js";

const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));
const helper = fileURLToPath(new URL("../scripts/redeploy-when-idle.sh", import.meta.url));
const roots: string[] = [], servers: Server[] = [];
const commands: ReturnType<typeof createTestCommandScope>[] = [];
afterEach(async () => {
  await Promise.all(commands.map((scope) => scope.dispose()));
  commands.length = 0;
  await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve(); }); })));
  servers.length = 0;
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots.length = 0;
});
type SystemctlHealth = readonly [web: readonly [result: string, restarts: number], sessiond: readonly [result: string, restarts: number]];
interface SystemctlBehavior {
  failAction?: string;
  persistent?: boolean;
  removeNext?: boolean;
  failPrevious?: boolean;
  inactiveSessiondForNext?: boolean;
  stillActive?: boolean;
  health?: readonly SystemctlHealth[];
}

async function writeSystemctlBehavior(config: string, value: SystemctlBehavior): Promise<void> {
  const health: readonly SystemctlHealth[] = value.health ?? [[["success", 0], ["success", 0]]];
  if (health.length === 0) throw new Error("Systemctl fixture requires at least one health response");
  // Only data crosses into the shell adapter. Never source or eval behavior.
  await Promise.all([
    writeFile(join(config, "fail-action"), `${value.failAction ?? ""}\n`),
    writeFile(join(config, "flags"), [value.persistent, value.removeNext, value.failPrevious, value.inactiveSessiondForNext].map((flag) => flag === true ? "1\n" : "0\n").join("")),
    writeFile(join(config, "health-count"), `${String(health.length)}\n`),
    ...health.map((units, index) => writeFile(join(config, `health.${String(index + 1)}`), units.map(([result, restarts]) =>
      `ActiveState=${value.stillActive === true ? "active" : "inactive"}\nResult=${result}\nNRestarts=${String(restarts)}`
    ).join("\n\n") + "\n")),
  ]);
}

async function fixture() {
  const scope = createTestCommandScope(); commands.push(scope);
  const command = scope.run.bind(scope);
  const root = await mkdtemp(join(tmpdir(), "forgerie-deploy-")); roots.push(root);
  const repo = join(root, "source"), target = join(root, "target");
  await mkdir(repo); await mkdir(target);
  await command("git", ["init", "-q", repo]);
  await writeFile(join(repo, "package-lock.json"), "dependencies-v1");
  await writeFile(join(repo, ".gitignore"), "dist/\n.forgerie/\n");
  await command("git", ["-C", repo, "add", "."]);
  await command("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"]);
  await command("git", ["clone", "-q", repo, target]);
  const sha = (await command("git", ["-C", repo, "rev-parse", "HEAD"])).stdout.trim();
  const prepared = join(repo, "dist"), deployed = join(target, "dist");
  for (const [dist, marker] of [[prepared, "next"], [deployed, "previous"]]) {
    if (dist === undefined) throw new Error("Missing fixture path");
    await mkdir(join(dist, "server"), { recursive: true }); await mkdir(join(dist, "client/assets"), { recursive: true });
    for (const file of ["cli.js", "server/sessiond.js", "server/index.js", "client/index.html", `client/assets/${marker ?? ""}.js`]) await writeFile(join(dist, file), marker ?? "");
    await writeFile(join(dist, "client/build.json"), JSON.stringify({ entry: `${marker ?? ""}.js` }));
  }
  // Compatibility helper launches this prepared CLI, which delegates to the real entrypoint.
  await writeFile(join(prepared, "cli.js"), `const {spawnSync} = require('node:child_process'); const r = spawnSync(${JSON.stringify(process.execPath)}, ['--import', 'tsx', ${JSON.stringify(cli)}, ...process.argv.slice(2)], {stdio:'inherit'}); process.exit(r.status ?? 1);`);
  const bin = join(root, "bin"); await mkdir(bin);
  const config = join(root, "behavior"), calls = join(root, "calls.jsonl");
  await mkdir(config);
  await writeSystemctlBehavior(config, {});
  await writeFile(calls, "");
  // This counter belongs to the call history, not the current behavior.
  await writeFile(join(root, "show-count"), "0\n");
  await writeFile(join(bin, "systemctl"), `#!/bin/sh
set -eu
root=$FORGERIE_TEST_SYSTEMCTL_ROOT
config="$root/behavior"
# Arguments are controlled fixture tokens. Validate them before writing JSON.
line='['
separator=
quote='"'
for argument do
  case "$argument" in
    --user|show|stop|start|restart|is-active|--quiet|--property=ActiveState,Result,NRestarts|forgerie-web.service|forgerie-sessiond.service) ;;
    *) printf '%s\\n' 'Unexpected systemctl fixture argument' >&2; exit 2 ;;
  esac
  line="$line$separator$quote$argument$quote"
  separator=,
done
printf '%s]\\n' "$line" >> "$root/calls.jsonl"
action=$2
if [ "$action" = show ]; then
  IFS= read -r shows < "$root/show-count"
  shows=$((shows + 1))
  printf '%s\\n' "$shows" > "$root/show-count"
fi
IFS= read -r fail_action < "$config/fail-action"
{
  IFS= read -r persistent
  IFS= read -r remove_next
  IFS= read -r fail_previous
  IFS= read -r inactive_sessiond_for_next
} < "$config/flags"
if [ "$fail_action" = "$action" ]; then
  if [ "$persistent" = 0 ]; then printf '\\n' > "$config/fail-action"; fi
  exit 1
fi
if [ "$action" = stop ]; then
  for stage in "$root/target/.forgerie"/deploy.*; do
    [ -d "$stage" ] || continue
    if [ "$remove_next" = 1 ]; then rm -rf -- "$stage/next"; fi
    if [ "$fail_previous" = 1 ]; then mkdir -p -- "$stage/previous/conflict"; fi
  done
fi
if [ "$action" = is-active ] && [ "$inactive_sessiond_for_next" = 1 ]; then
  marker=$(cat "$root/target/dist/server/index.js")
  # Match systemctl's grouped semantics: ANY active requested unit succeeds.
  for argument do
    case "$argument" in
      *.service)
        if [ "$marker" != next ] || [ "$argument" != forgerie-sessiond.service ]; then exit 0; fi ;;
    esac
  done
  exit 3
fi
if [ "$action" = show ]; then
  IFS= read -r count < "$config/health-count"
  if [ "$shows" -gt "$count" ]; then shows=$count; fi
  # Outputs already contain systemd's property order and blank unit separator.
  while IFS= read -r line; do printf '%s\\n' "$line"; done < "$config/health.$shows"
fi
`);
  await chmod(join(bin, "systemctl"), 0o755);
  let activity: unknown = { workspaces: [{ cwd: "/other", hasSessionActivity: true }] };
  let activityStatus = 200, activityCalls = 0, badReadiness = false;
  let runtimeCalls = 0;
  let runtimeResponses: { body: unknown; status?: number }[] = [{ body: { components: { web: { available: true }, sessiond: { available: true } } } }];
  let onActivity: (() => Promise<void>) | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      if (request.url?.endsWith("/activity") === true) {
        activityCalls++;
        if (onActivity !== undefined) await onActivity();
        response.writeHead(activityStatus, { "content-type": "application/json" }); response.end(JSON.stringify(activity));
      } else if (request.url === "/api/pi-web/runtime") {
        runtimeCalls++;
        // Runtime availability is modeled separately from the served build.
        const runtime = runtimeResponses.length > 1 ? runtimeResponses.shift() : runtimeResponses[0];
        if (runtime === undefined) throw new Error("No configured runtime response");
        response.writeHead(runtime.status ?? 200, { "content-type": "application/json" });
        response.end(JSON.stringify(runtime.body));
      } else if (request.url === "/build.json") {
        const body = await readFile(join(deployed, "client/build.json"), "utf8");
        response.writeHead(200, { "content-type": "application/json" });
        response.end(badReadiness && body.includes("next.js") ? '{"entry":"wrong.js"}' : body);
      } else { response.writeHead(404); response.end(); }
    })().catch(() => { response.writeHead(503); response.end(); });
  });
  servers.push(server);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (address === null || typeof address === "string") throw new Error("No fixture listener");
  const env = { ...process.env, FORGERIE_TEST_SYSTEMCTL_ROOT: root, PATH: `${bin}:${process.env["PATH"] ?? ""}`, FORGERIE_REDEPLOY_URL: `http://127.0.0.1:${String(address.port)}`, FORGERIE_REDEPLOY_LOG: join(root, "deploy.log"), FORGERIE_DEPLOY_SHELL: "1" };
  const invoke = (...args: string[]) => command(process.execPath, ["--import", "tsx", cli, "deploy", ...args], env);
  return {
    root, repo, target, sha, prepared, deployed, invoke, env, command,
    record: () => invoke("record", prepared, sha),
    publish: (...flags: string[]) => invoke(prepared, deployed, sha, ...flags, "--readiness-seconds", "0"),
    calls: async () => (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map((line) => z.array(z.string()).parse(JSON.parse(line))),
    behavior: (value: SystemctlBehavior) => writeSystemctlBehavior(config, value),
    activity: (value: unknown, status = 200) => { activity = value; activityStatus = status; },
    activityCalls: () => activityCalls,
    badReadiness: () => { badReadiness = true; },
    runtimeResponses: (...responses: { body: unknown; status?: number }[]) => { runtimeResponses = responses; },
    runtimeCalls: () => runtimeCalls,
    onActivity: (callback: () => Promise<void>) => { onActivity = callback; },
    stages: async () => (await readdir(join(target, ".forgerie"))).filter((name) => name.startsWith("deploy.")).map((name) => join(target, ".forgerie", name)),
  };
}

it("requires a verified build receipt before it can publish", async () => {
  const f = await fixture();
  const result = await f.publish();
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("verified build receipt");
  expect(await f.calls()).toEqual([]);
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("previous");
});

it.each(["busy", "unavailable"])("publishes immediately without reading %s activity and retains the previous build", async (activity) => {
  const f = await fixture();
  if (activity === "unavailable") f.activity({}, 503);
  expect((await f.record()).code).toBe(0);
  const result = await f.publish();
  expect(result, result.stderr).toMatchObject({ code: 0 });
  expect(f.activityCalls()).toBe(0);
  expect(f.runtimeCalls()).toBe(1);
  const show = ["--user", "show", "--property=ActiveState,Result,NRestarts", "forgerie-web.service", "forgerie-sessiond.service"];
  expect(await f.calls()).toEqual([
    show,
    ["--user", "stop", "forgerie-web.service", "forgerie-sessiond.service"],
    show,
    ["--user", "start", "forgerie-sessiond.service", "forgerie-web.service"],
    ["--user", "is-active", "--quiet", "forgerie-web.service"],
    ["--user", "is-active", "--quiet", "forgerie-sessiond.service"],
    show,
  ]);
  expect(result.stdout).not.toContain("Warning:");
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("next");
  const stages = await f.stages(); expect(stages).toHaveLength(1);
  expect(await readFile(join(stages[0] ?? "", "previous/server/index.js"), "utf8")).toBe("previous");
  expect(await readFile(join(f.target, "package-lock.json"), "utf8")).toBe("dependencies-v1");
});

it("reports a stop timeout and automatic restarts in result.json without rolling back", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  await f.behavior({ health: [
    [["success", 0], ["success", 0]],
    [["success", 0], ["timeout", 0]],
    [["success", 0], ["success", 2]],
  ] });
  // The staged unit's command, as the launcher queues it.
  const stage = join(f.target, ".forgerie/publish.warnings"); await mkdir(stage, { recursive: true });
  const result = await f.command("bash", [helper, "--run-staged", join(stage, "result.json"), f.prepared, f.deployed, f.sha, "--readiness-seconds", "0"], f.env);
  expect(result, result.stderr).toMatchObject({ code: 0 });
  const warnings = ["sessiond stop timed out; SIGKILL", "sessiond restarted 2× after start (NRestarts 0 → 2)"];
  for (const warning of warnings) expect(result.stdout).toContain(`Warning: ${warning}`);
  expect(JSON.parse(await readFile(join(stage, "result.json"), "utf8"))).toEqual({ status: "passed", exitCode: 0, revision: f.sha, unit: "", warnings });
  expect(await readdir(stage)).toEqual(["result.json"]);
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("next");
  expect((await f.calls()).filter((args) => args[1] === "stop")).toHaveLength(1);
});

it("keeps only the newest two previous builds after another publication", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  // Two earlier publications' retained builds, oldest first.
  const earlier = [join(f.target, ".forgerie/deploy.earliest"), join(f.target, ".forgerie/deploy.earlier")];
  for (const [index, stage] of earlier.entries()) {
    await mkdir(join(stage, "previous/server"), { recursive: true });
    await writeFile(join(stage, "previous/server/index.js"), stage);
    const time = new Date(Date.now() - (2 - index) * 3_600_000);
    await utimes(stage, time, time);
  }
  // A rollback's retained failed build is not a previous build and stays for inspection.
  const inspected = join(f.target, ".forgerie/deploy.rolled-back");
  await mkdir(join(inspected, "failed"), { recursive: true });
  const result = await f.publish();
  expect(result, result.stderr).toMatchObject({ code: 0 });
  expect(result.stdout).toContain(`Removed 1 older previous build(s); kept the newest 2: ${earlier[0] ?? ""}`);
  const stages = (await f.stages()).filter((stage) => stage !== inspected);
  expect(stages).toHaveLength(2);
  expect(stages).toContain(earlier[1]);
  const published = stages.find((stage) => stage !== earlier[1]) ?? "";
  expect(await readFile(join(published, "previous/server/index.js"), "utf8")).toBe("previous");
  expect(await readdir(inspected)).toEqual(["failed"]);
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("next");
});

it.each([
  { name: "busy", body: { workspaces: [{ cwd: "/other", hasSessionActivity: true }] }, status: 200 },
  { name: "unavailable", body: {}, status: 503 },
  { name: "malformed", body: { workspaces: [{ cwd: "/other" }] }, status: 200 },
])("explicit idle publication fails closed for $name activity", async ({ body, status }) => {
  const f = await fixture(); f.activity(body, status); expect((await f.record()).code).toBe(0);
  const result = await f.publish("--when-idle", "/own", "--limit-minutes", "0");
  expect(result.code).toBe(1); expect(result.stderr).toContain("Nothing restarted");
  expect(await f.calls()).toEqual([]);
});

it("publishes in idle mode when only the named workspace is active", async () => {
  const f = await fixture(); f.activity({ workspaces: [{ cwd: "/own", hasSessionActivity: true }] });
  expect((await f.record()).code).toBe(0);
  expect((await f.publish("--when-idle", "/own", "--limit-minutes", "0")).code).toBe(0);
  expect(f.activityCalls()).toBe(1);
});

it.each(["missing", "short", "stale"])("rejects a %s expected revision before service changes", async (kind) => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  const sha = kind === "missing" ? "" : kind === "short" ? f.sha.slice(0, 8) : "f".repeat(40);
  expect((await f.invoke(f.prepared, f.deployed, sha)).code).toBe(1);
  expect(await f.calls()).toEqual([]);
});

it("rechecks deployed revision after waiting", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  f.activity({ workspaces: [] });
  f.onActivity(async () => {
    await f.command("git", ["-C", f.target, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "advanced"]);
  });
  const result = await f.publish("--when-idle", "/own", "--limit-minutes", "0");
  expect(result.code).toBe(1); expect(result.stderr).toContain("revision differs"); expect(await f.calls()).toEqual([]);
});

it.each(["file", "manifest", "receipt", "dependencies", "dirty"])("refuses changed or malformed %s", async (kind) => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  if (kind === "file") await writeFile(join(f.prepared, "server/index.js"), "stale");
  if (kind === "manifest") await writeFile(join(f.prepared, "client/build.json"), '{"entry":"../outside.js"}');
  if (kind === "receipt") await writeFile(join(f.prepared, ".forgerie-verified.json"), "invalid JSON");
  if (kind === "dirty") await writeFile(join(f.repo, "package-lock.json"), "different");
  if (kind === "dependencies") {
    const path = join(f.prepared, ".forgerie-verified.json");
    const receipt = z.object({ revision: z.string(), digest: z.string(), lockDigest: z.string() }).parse(JSON.parse(await readFile(path, "utf8")));
    await writeFile(path, JSON.stringify({ ...receipt, lockDigest: "f".repeat(64) }));
  }
  expect((await f.publish()).code).toBe(1); expect(await f.calls()).toEqual([]);
});

it.each(["relative", "same", "nested", "symlink", "incomplete", "missing-destination"])("refuses %s build paths", async (kind) => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  let source = f.prepared, target = f.deployed;
  if (kind === "relative") source = "dist";
  if (kind === "same") target = source;
  if (kind === "nested") { target = join(source, "child"); await mkdir(target); }
  if (kind === "symlink") { source = join(f.repo, "link"); await symlink(f.prepared, source); }
  if (kind === "incomplete") await rm(join(source, "server/sessiond.js"));
  if (kind === "missing-destination") await rm(target, { recursive: true });
  expect((await f.invoke(source, target, f.sha)).code).toBe(1); expect(await f.calls()).toEqual([]);
});

it.each([
  { name: "stop", behavior: { failAction: "stop" } },
  { name: "not stopped", behavior: { stillActive: true } },
  { name: "previous rename", behavior: { failPrevious: true } },
  { name: "next rename", behavior: { removeNext: true } },
  { name: "start", behavior: { failAction: "start" } },
  { name: "unit readiness", behavior: { failAction: "is-active" } },
])("restores the previous build after $name failure", async ({ behavior }) => {
  const f = await fixture(); expect((await f.record()).code).toBe(0); await f.behavior(behavior);
  const result = await f.publish();
  expect(result.code).toBe(1); expect(result.stderr).toContain("previous build restored");
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("previous");
  expect((await f.calls()).some((args) => args[1] === "start")).toBe(true);
});

it("rolls back when HTTP serves a different build", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0); f.badReadiness();
  const result = await f.publish(); expect(result.code).toBe(1); expect(result.stderr).toContain("previous build restored");
  const stages = await f.stages();
  expect(await readFile(join(stages[0] ?? "", "failed/server/index.js"), "utf8")).toBe("next");
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("previous");
});

it("reports rollback failure with retained recovery paths", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0); await f.behavior({ failAction: "start", persistent: true });
  const result = await f.publish(); expect(result.code).toBe(1); expect(result.stderr).toContain("rollback failed"); expect(result.stderr).toContain("deploy.");
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("previous");
});

it("refuses concurrent publishers before stopping services", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  await mkdir(join(f.target, ".forgerie/publish.lock"), { recursive: true });
  const result = await f.publish(); expect(result.code).toBe(1); expect(result.stderr).toContain("already being held"); expect(await f.calls()).toEqual([]);
});

it.each(["busy", "unavailable"])("legacy default idle restart fails closed for %s activity", async (kind) => {
  const f = await fixture(); if (kind === "unavailable") f.activity({}, 503);
  const result = await f.command("bash", [helper, "/own", "0"], f.env);
  expect(result.code).toBe(1); expect(result.stdout).toContain("Nothing restarted"); expect(await f.calls()).toEqual([]);
});

it("legacy publication refuses an absent expected SHA", async () => {
  const f = await fixture();
  const result = await f.command("bash", [helper, "/own", "0", f.prepared, f.deployed], { ...f.env, FORGERIE_REDEPLOY_REVISION: "" });
  expect(result.code).toBe(1); expect(result.stderr).toContain("FORGERIE_REDEPLOY_REVISION"); expect(await f.calls()).toEqual([]);
});

it.each(["immediate", "idle"])("legacy %s publication uses the shipped publisher", async (kind) => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  if (kind === "idle") f.activity({ workspaces: [] });
  const args = kind === "immediate" ? ["--now", f.prepared, f.deployed, f.sha] : ["/own", "0", f.prepared, f.deployed];
  const result = await f.command("bash", [helper, ...args], { ...f.env, FORGERIE_REDEPLOY_REVISION: f.sha });
  expect(result, result.stderr).toMatchObject({ code: 0 });
  expect(f.activityCalls()).toBe(kind === "immediate" ? 0 : 1);
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("next");
});

it("refuses a build whose files change while waiting", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0); f.activity({ workspaces: [] });
  f.onActivity(async () => { await writeFile(join(f.prepared, "server/index.js"), "not-verified"); });
  const result = await f.publish("--when-idle", "/own", "--limit-minutes", "0");
  expect(result.code).toBe(1); expect(result.stderr).toContain("build content"); expect(await f.calls()).toEqual([]);
});

it("does not stop services when staging cannot copy the build", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0); f.activity({ workspaces: [] });
  const assets = join(f.prepared, "client/assets");
  f.onActivity(async () => { await chmod(assets, 0); });
  try {
    const result = await f.publish("--when-idle", "/own", "--limit-minutes", "0");
    expect(result.code).toBe(1); expect(result.stderr).toContain("EACCES"); expect(await f.calls()).toEqual([]);
    expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("previous");
  } finally { await chmod(assets, 0o755); }
});

it.each(["missing entrypoint", "missing asset", "symlink"])("does not record an incomplete build: %s", async (kind) => {
  const f = await fixture();
  if (kind === "missing entrypoint") await rm(join(f.prepared, "server/index.js"));
  if (kind === "missing asset") await rm(join(f.prepared, "client/assets/next.js"));
  if (kind === "symlink") await symlink(join(f.prepared, "server"), join(f.prepared, "linked-server"));
  expect((await f.record()).code).toBe(1);
  expect(await f.calls()).toEqual([]);
  await expect(readFile(join(f.prepared, ".forgerie-verified.json"))).rejects.toThrow();
});

it("refuses incompatible deployed lockfiles without overwriting dependencies", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  await writeFile(join(f.target, "package-lock.json"), "different-dependencies");
  const result = await f.publish(); expect(result.code).toBe(1); expect(result.stderr).toContain("Dependency lockfile differs");
  expect(await f.calls()).toEqual([]);
  expect(await readFile(join(f.target, "package-lock.json"), "utf8")).toBe("different-dependencies");
});

it("refuses to attest an untracked source change", async () => {
  const f = await fixture(); await writeFile(join(f.repo, "untracked.ts"), "not committed");
  const result = await f.record(); expect(result.code).toBe(1); expect(result.stderr).toContain("must be clean");
});

it("does not treat unrelated deployed edits as activity or verified source", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  await writeFile(join(f.target, ".gitignore"), "unrelated edit");
  const result = await f.publish(); expect(result, result.stderr).toMatchObject({ code: 0 });
  expect(await readFile(join(f.target, ".gitignore"), "utf8")).toBe("unrelated edit");
  expect(f.activityCalls()).toBe(0);
});

it.each([
  ["--unexpected"], ["--when-idle"], ["--when-idle", "/own", "--limit-minutes", "-1"],
  ["--readiness-seconds"], ["--readiness-seconds", ""], ["--readiness-seconds", "601"],
])("refuses malformed deploy options %j before service changes", async (...flags) => {
  await expect(deployCommand(["/unopened/source", "/unopened/target", "a".repeat(40), ...flags])).rejects.toThrow();
});

it("rolls back a dead sessiond even when web and the expected HTTP build are healthy", async () => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  await f.behavior({ inactiveSessiondForNext: true });
  const result = await f.publish();
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("previous build restored");
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("previous");
  const stages = await f.stages();
  expect(await readFile(join(stages[0] ?? "", "failed/server/index.js"), "utf8")).toBe("next");
});

it.each([
  { name: "unavailable daemon", body: { components: { web: { available: true }, sessiond: { available: false, error: "ECONNREFUSED sessiond.sock" } } } },
  { name: "unavailable web", body: { components: { web: { available: false }, sessiond: { available: true } } } },
  { name: "malformed runtime", body: { components: { web: { available: true } } } },
  { name: "runtime HTTP failure", body: { error: "unavailable" }, status: 503 },
])("rolls back $name despite active units and the correct HTTP build", async (unready) => {
  const f = await fixture(); expect((await f.record()).code).toBe(0);
  f.runtimeResponses(unready, { body: { components: { web: { available: true }, sessiond: { available: true } } } });
  const result = await f.publish();
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("previous build restored");
  expect(f.runtimeCalls()).toBe(2);
  expect(await readFile(join(f.deployed, "server/index.js"), "utf8")).toBe("previous");
  const stages = await f.stages();
  expect(await readFile(join(stages[0] ?? "", "failed/server/index.js"), "utf8")).toBe("next");
});
