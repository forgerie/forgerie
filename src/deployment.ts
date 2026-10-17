import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { FORGERIE_SERVICE_UNITS } from "./shared/localServices.js";

const execute = promisify(execFile);
const receiptName = ".forgerie-verified.json";
const revisionSchema = z.string().regex(/^[a-f0-9]{40}$/, "Expected a full 40-character commit SHA");
const manifestSchema = z.object({ entry: z.string().regex(/^[\w.-]+\.js$/) });
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const receiptSchema = z.object({ revision: revisionSchema, digest: digestSchema, lockDigest: digestSchema });
const activitySchema = z.object({ workspaces: z.array(z.object({ cwd: z.string(), hasSessionActivity: z.boolean() })) });
const readyRuntimeSchema = z.object({ components: z.object({
  web: z.object({ available: z.literal(true) }),
  sessiond: z.object({ available: z.literal(true) }),
}) });

type WaitPolicy = { kind: "immediate" } | { kind: "idle"; workspace: string; limitMinutes: number };
interface Publication {
  prepared: string;
  deployed: string;
  revision: string;
  wait: WaitPolicy;
  url: string;
  readinessSeconds: number;
}

async function git(root: string, ...args: string[]): Promise<string> {
  return (await execute("git", ["-C", root, ...args], { timeout: 10_000 })).stdout.trim();
}
async function checkout(dist: string, revision: string, clean: boolean): Promise<string> {
  const root = dirname(dist);
  if (await realpath(await git(root, "rev-parse", "--show-toplevel")) !== root) throw new Error("Build must be a direct child of its checkout root");
  if (await git(root, "rev-parse", "HEAD") !== revision) throw new Error(`Checkout revision differs from expected SHA: ${root}`);
  if (clean && await git(root, "status", "--porcelain", "--untracked-files=all") !== "") throw new Error(`Verified source checkout must be clean: ${root}`);
  return root;
}
async function canonicalDist(path: string): Promise<string> {
  if (!isAbsolute(path) || resolve(path) === sep || basename(path) === ".forgerie") throw new Error("Build paths must be absolute, non-root dist directories");
  const canonical = join(await realpath(dirname(path)), basename(path));
  if (await realpath(path) !== canonical || !(await lstat(path)).isDirectory()) throw new Error("Build paths must be real directories, not symlinks");
  return canonical;
}
async function manifest(dist: string): Promise<z.infer<typeof manifestSchema>> {
  const result = manifestSchema.parse(JSON.parse(await readFile(join(dist, "client/build.json"), "utf8")));
  for (const file of ["cli.js", "server/sessiond.js", "server/index.js", "client/index.html", `client/assets/${result.entry}`]) {
    const stat = await lstat(join(dist, file));
    if (!stat.isFile() || stat.size === 0) throw new Error(`Incomplete build: ${file}`);
  }
  return result;
}
async function digest(dist: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const rel = relative(dist, path);
      if (rel === receiptName) continue;
      const stat = await lstat(path);
      if (stat.isDirectory()) { hash.update(`directory:${rel}\0`); await walk(path); }
      else if (stat.isFile()) hash.update(`file:${rel}\0${String(stat.size)}\0`).update(await readFile(path));
      else throw new Error(`Build contains a symlink or special file: ${rel}`);
    }
  }
  await walk(dist);
  return hash.digest("hex");
}
async function lockDigest(root: string): Promise<string> {
  return createHash("sha256").update(await readFile(join(root, "package-lock.json"))).digest("hex");
}
async function verifyReceipt(dist: string, revision: string): Promise<z.infer<typeof receiptSchema>> {
  let receipt;
  try {
    const path = join(dist, receiptName);
    if (!(await lstat(path)).isFile()) throw new Error("Receipt must be a regular file");
    receipt = receiptSchema.parse(JSON.parse(await readFile(path, "utf8")));
  }
  catch (cause) { throw new Error("Missing or malformed verified build receipt. Run forgerie deploy record after verification.", { cause }); }
  await manifest(dist);
  if (receipt.revision !== revision || receipt.digest !== await digest(dist)) throw new Error("Verified build receipt differs from expected SHA or build content");
  return receipt;
}

/** Explicit operator attestation, not a substitute for running checks on this build. */
async function recordVerifiedBuild(path: string, revision: string): Promise<void> {
  const dist = await canonicalDist(path);
  const root = await checkout(dist, revision, true);
  await manifest(dist);
  const receipt = { revision, digest: await digest(dist), lockDigest: await lockDigest(root) };
  await writeFile(join(dist, receiptName), `${JSON.stringify(receipt)}\n`, { flag: "wx" });
  console.log(`Recorded verified build ${revision}: ${dist}`);
}

async function request(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}: ${url}`);
  return response.json();
}
async function waitForIdle(options: Publication): Promise<void> {
  if (options.wait.kind === "immediate") return;
  const { workspace, limitMinutes } = options.wait;
  const deadline = Date.now() + limitMinutes * 60_000;
  console.log(`Waiting for other sessions to go idle (ignoring ${workspace}, limit ${String(limitMinutes)}m)`);
  for (;;) {
    try {
      const activity = activitySchema.parse(await request(`${options.url}/api/machines/local/activity`));
      if (activity.workspaces.every((item) => !item.hasSessionActivity || item.cwd === workspace)) return;
    } catch { /* Unavailable or invalid activity is busy, never permission to stop services. */ }
    if (Date.now() >= deadline) throw new Error("Busy or activity unavailable. Nothing restarted.");
    await delay(Math.min(30_000, deadline - Date.now()));
  }
}
async function units(action: "stop" | "start" | "is-active"): Promise<void> {
  const ordered = action === "start" ? [...FORGERIE_SERVICE_UNITS].reverse() : [...FORGERIE_SERVICE_UNITS];
  if (action === "is-active") {
    // systemctl succeeds for a group when ANY requested unit is active.
    for (const unit of ordered) await execute("systemctl", ["--user", action, "--quiet", unit], { timeout: 30_000 });
  } else await execute("systemctl", ["--user", action, ...ordered], { timeout: 30_000 });
}
async function stopUnits(): Promise<void> {
  await units("stop");
  const status = await execute("systemctl", ["--user", "show", "--property=ActiveState", "--value", ...FORGERIE_SERVICE_UNITS], { timeout: 10_000 });
  const states = status.stdout.trim().split(/\s+/);
  if (states.length !== 2 || states.some((state) => state !== "inactive" && state !== "failed")) throw new Error("Both units must be stopped before the swap");
}
function reason(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function ready(options: Publication, expected: z.infer<typeof manifestSchema>): Promise<void> {
  const deadline = Date.now() + options.readinessSeconds * 1_000;
  for (;;) {
    try {
      await units("is-active");
      const running = manifestSchema.parse(await request(`${options.url}/build.json`));
      if (running.entry !== expected.entry) throw new Error("HTTP build identity differs");
      readyRuntimeSchema.parse(await request(`${options.url}/api/pi-web/runtime`));
      return;
    } catch (cause) {
      if (Date.now() >= deadline) throw new Error("Services, expected HTTP build, or daemon runtime did not become ready", { cause });
      await delay(Math.min(2_000, deadline - Date.now()));
    }
  }
}
async function publish(options: Publication): Promise<void> {
  // The operator must use an independent launcher (see docs/deployment.md).
  // Running inside sessiond's cgroup would kill the publisher during stop.
  const prepared = await canonicalDist(options.prepared);
  const deployed = await canonicalDist(options.deployed);
  if (prepared === deployed || prepared.startsWith(`${deployed}/`) || deployed.startsWith(`${prepared}/`)) throw new Error("Build paths must not overlap");
  const sourceRoot = await checkout(prepared, options.revision, true);
  const targetRoot = await checkout(deployed, options.revision, false);
  if (sourceRoot === targetRoot) throw new Error("Build and deployed checkouts must be isolated");
  const receipt = await verifyReceipt(prepared, options.revision);
  if (receipt.lockDigest !== await lockDigest(sourceRoot) || receipt.lockDigest !== await lockDigest(targetRoot)) throw new Error("Dependency lockfile differs from verified build; reconcile dependencies separately before deployment");
  const previousManifest = await manifest(deployed);
  const stateDir = join(targetRoot, ".forgerie");
  await mkdir(stateDir, { recursive: true });
  if (await realpath(stateDir) !== stateDir) throw new Error("Deployment state directory must not be a symlink");
  let compromised: Error | undefined;
  const release = await lockfile.lock(targetRoot, { lockfilePath: join(stateDir, "publish.lock"), stale: 120_000, onCompromised: (error) => { compromised = error; } });
  let stage: string | undefined;
  const guard = async (): Promise<void> => {
    if (compromised !== undefined) throw compromised;
    await checkout(prepared, options.revision, true);
    await checkout(deployed, options.revision, false);
    if (receipt.lockDigest !== await lockDigest(targetRoot)) throw new Error("Deployed lockfile changed during publication");
  };
  try {
    await waitForIdle(options);
    await guard();
    stage = await mkdtemp(join(stateDir, "deploy."));
    const next = join(stage, "next"), previous = join(stage, "previous");
    await cp(prepared, next, { recursive: true, errorOnExist: true, force: false });
    await verifyReceipt(next, options.revision);
    await guard();
    let movedPrevious = false, installedNext = false, stopAttempted = false;
    try {
      stopAttempted = true;
      await stopUnits();
      await guard();
      await rename(deployed, previous); movedPrevious = true;
      await rename(next, deployed); installedNext = true;
      await units("start");
      await ready(options, await manifest(deployed));
      console.log(`Published ${options.revision}; previous build retained at ${previous}`);
    } catch (cause) {
      try {
        if (installedNext) {
          await stopUnits();
          await rename(deployed, join(stage, "failed"));
        }
        if (movedPrevious) await rename(previous, deployed);
        if (stopAttempted) { await units("start"); await ready(options, previousManifest); }
      } catch (rollbackCause) { throw new AggregateError([cause, rollbackCause], `Publication failed (${reason(cause)}) and rollback failed (${reason(rollbackCause)}). Inspect ${stage} and both units before recovery.`, { cause: rollbackCause }); }
      throw new Error(`Publication failed (${reason(cause)}); previous build restored. Retained files: ${stage}`, { cause });
    }
  } finally {
    // Keep failed/previous builds for operator inspection. Only remove an unpublished copy.
    try { if (stage !== undefined) await rm(join(stage, "next"), { recursive: true, force: true }); }
    finally { await release(); }
  }
}

export async function deployCommand(args: string[]): Promise<void> {
  if (process.platform !== "linux") throw new Error("Deployment requires Linux and existing systemd user units");
  if (args[0] === "record") {
    if (args.length !== 3) throw new Error("Usage: forgerie deploy record BUILT_DIST EXPECTED_SHA");
    const [ , path = "", revision = ""] = args;
    await recordVerifiedBuild(path, revisionSchema.parse(revision));
    return;
  }
  const [prepared = "", deployed = "", revision = "", ...flags] = args;
  revisionSchema.parse(revision);
  let wait: WaitPolicy = { kind: "immediate" };
  let readinessSeconds = 60;
  if (flags[0] === "--when-idle") {
    flags.shift();
    const workspace = flags.shift();
    if (workspace === undefined || !isAbsolute(workspace)) throw new Error("--when-idle requires an absolute workspace path");
    let limitMinutes = 60;
    if (flags.at(0) === "--limit-minutes") { flags.shift(); limitMinutes = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(10_080)).parse(flags.shift()); }
    wait = { kind: "idle", workspace, limitMinutes };
  }
  if (flags[0] === "--readiness-seconds") { flags.shift(); readinessSeconds = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(600)).parse(flags.shift()); }
  if (flags.length > 0) throw new Error(`Unexpected deploy argument: ${flags[0] ?? ""}`);
  const url = process.env["FORGERIE_REDEPLOY_URL"] ?? "http://127.0.0.1:8504";
  const parsedUrl = new URL(url);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Deployment URL must use HTTP or HTTPS");
  await publish({ prepared, deployed, revision, wait, url: url.replace(/\/$/, ""), readinessSeconds });
}
