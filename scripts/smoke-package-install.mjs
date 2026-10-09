import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const NPM_VERSION = "12.0.1";
const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const npmExecPath = process.env["npm_execpath"];
if (npmExecPath === undefined || npmExecPath === "") {
  throw new Error("npm_execpath is required; run this check through `npm run smoke:package-install`");
}

const root = await mkdtemp(join(tmpdir(), "forgerie-package-install-"));
try {
  const packDir = join(root, "pack");
  const npmToolDir = join(root, "npm-tool");
  const globalPrefix = join(root, "global");
  await Promise.all([
    mkdir(packDir, { recursive: true }),
    mkdir(join(globalPrefix, "lib"), { recursive: true }),
    mkdir(npmToolDir, { recursive: true }),
    writeFile(join(npmToolDir, "package.json"), '{"private":true}\n'),
  ]);

  const packOutput = await runNpm(npmExecPath, ["pack", "--ignore-scripts", "--json", "--pack-destination", packDir], repoRoot);
  const tarballPath = join(packDir, packageTarballFilename(packOutput));

  await runNpm(npmExecPath, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--no-save",
    `npm@${NPM_VERSION}`,
  ], npmToolDir);
  const npm12ExecPath = join(npmToolDir, "node_modules", "npm", "bin", "npm-cli.js");

  await runNpm(npm12ExecPath, [
    "install",
    "--global",
    tarballPath,
    "--prefix",
    globalPrefix,
    "--no-audit",
    "--no-fund",
  ], root);

  const packageRoot = join(globalPrefix, "lib", "node_modules", "forgerie");
  await smokeInstalledManagedProcesses(packageRoot);
  await smokeInstalledSubagents(packageRoot);
  const cli = join(globalPrefix, "bin", "forgerie");
  const agentDir = join(root, "profile");
  const cliOptions = {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, PI_OFFLINE: "1", PI_CODING_AGENT_DIR: agentDir },
  };
  const version = await execFileAsync(process.execPath, [cli, "--version"], cliOptions);
  const expected = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).version;
  if (version.stdout.trim() !== expected) throw new Error("Installed CLI reports the wrong package version");
  const help = await execFileAsync(process.execPath, [cli, "--help"], cliOptions);
  if (!help.stdout.includes("Services must already exist")) throw new Error("Installed CLI does not describe existing-unit controls");
  await execFileAsync(process.execPath, [
    join(repoRoot, "scripts", "smoke-installed-model-runtime.mjs"), packageRoot, agentDir,
  ], cliOptions);
  console.log(`Installed-package checks passed with npm ${NPM_VERSION}: patched process sources, pinned subagent version, CLI, offline model runtime, and retired-file exclusion. No delegated agent was launched.`);
} finally {
  await rm(root, { recursive: true, force: true });
}

async function runNpm(npmCliPath, args, cwd) {
  const result = await execFileAsync(process.execPath, [npmCliPath, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 180_000,
  });
  return result.stdout;
}

function packageTarballFilename(output) {
  const json = output.match(/(?:^|\n)(\[[\s\S]*\])\s*$/)?.[1];
  if (json === undefined) throw new Error("npm pack did not return JSON");
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0]?.filename !== "string") {
    throw new Error("npm pack returned an unexpected result");
  }
  const retiredPaths = [
    "dist/docker/", "dist/nativeServices/", "dist/plugin-api", "dist/server/machines/",
    "dist/server/terminals/", "dist/server/terminalProxyRoutes", "dist/server/piWebPluginService",
    "dist/server/sessions/authService", "dist/server/sessions/authRoutes",
    "dist/server/sessions/oauthLoginFlowService", "dist/server/sessions/spawnSubsessionTool",
    "dist/server/sessions/subsessionTranscript", "dist/server/speech/smartTurnProcess",
    "pi-web-plugins/", "plugin-api/", "docker/", "nix/smart-turn.nix", "speech/smart_turn_worker.py",
  ];
  if (!Array.isArray(parsed[0].files)) throw new Error("npm pack did not return its file inventory");
  for (const file of parsed[0].files) {
    if (typeof file?.path !== "string") throw new Error("npm pack returned an invalid file inventory");
    if (retiredPaths.some((path) => file.path.startsWith(path))) throw new Error(`Packed retired file: ${file.path}`);
  }
  return parsed[0].filename;
}

async function smokeInstalledManagedProcesses(packageRoot) {
  const packageRootPath = join(packageRoot, "node_modules", "@aliou", "pi-processes");
  const [executor, channels] = await Promise.all([
    readFile(join(packageRootPath, "src", "utils", "command-executor.ts"), "utf8"),
    readFile(join(packageRootPath, "src", "protocol", "channels.ts"), "utf8"),
  ]);
  if (!executor.includes('spawn(shellExecutable, ["-c", command]') || executor.includes('spawn(shellExecutable, ["-lc", command]')) {
    throw new Error("Installed package does not contain Forgerie's non-login managed-process spawn patch");
  }
  if (!channels.includes('COMMAND_WRITE: "processes:command:write"')) {
    throw new Error("Installed package does not contain Forgerie's managed-process stdin protocol patch");
  }
}

async function smokeInstalledSubagents(packageRoot) {
  const manifest = JSON.parse(await readFile(join(packageRoot, "node_modules", "pi-subagents", "package.json"), "utf8"));
  const expected = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")).dependencies["pi-subagents"];
  if (manifest.version !== expected) {
    throw new Error(`Installed package bundles pi-subagents ${String(manifest.version)}, expected ${expected}`);
  }
}
