import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createTestPlan,
  normalizeRepoPaths,
  parseNameStatusChanges,
  parseNullDelimitedPaths,
  vitestArgsForTestPlan,
} from "./test-selection.mjs";

export { parseNullDelimitedPaths } from "./test-selection.mjs";

export function readChangedState(base, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const committed = base === undefined
    ? []
    : readDiffChanges([mergeBase(base, cwd), "HEAD"], cwd);
  const staged = readDiffChanges(["HEAD"], cwd, { cached: true });
  const unstaged = readDiffChanges([], cwd);
  const untracked = parseNullDelimitedPaths(execGit([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ], cwd)).map((path) => ({ status: "A", path }));
  const changes = [...committed, ...staged, ...unstaged, ...untracked];
  return {
    paths: normalizeRepoPaths(changes.map((change) => change.path)),
    deletedPaths: normalizeRepoPaths(
      changes.filter((change) => change.status === "D").map((change) => change.path),
    ),
  };
}

export function readChangedPaths(base, options = {}) {
  return readChangedState(base, options).paths;
}

function readDiffChanges(references, cwd, options = {}) {
  const args = ["diff"];
  if (options.cached === true) args.push("--cached");
  args.push(
    "--name-status",
    "--no-renames",
    "--diff-filter=ACMRDT",
    "-z",
    ...references,
    "--",
  );
  return parseNameStatusChanges(execGit(args, cwd));
}

function mergeBase(base, cwd) {
  return execGit(["merge-base", "HEAD", base], cwd).trim();
}

function execGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function runTestPlan(plan) {
  const npmArgs = plan.mode === "full"
    ? ["test"]
    : ["exec", "--", "vitest", ...vitestArgsForTestPlan(plan)];
  const invocation = npmInvocation(npmArgs);
  const result = spawnSync(invocation.command, invocation.args, { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  return result.status ?? 1;
}

function npmInvocation(npmArgs) {
  const npmExecPath = process.env["npm_execpath"];
  if (npmExecPath !== undefined && npmExecPath.length > 0) {
    return { command: process.execPath, args: [npmExecPath, ...npmArgs] };
  }
  return {
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: npmArgs,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error("Usage: npm run test:changed -- [base-branch-or-commit]");
  const base = args[0] ?? "main";
  const state = readChangedState(base);
  const deletedPaths = new Set(state.deletedPaths);
  const plan = createTestPlan(state.paths, {
    pathExists: (path) => !deletedPaths.has(path) && existsSync(path),
  });

  console.log(`[test:changed] Found ${String(state.paths.length)} changed path(s) since ${base}.`);
  if (plan.mode === "skip") {
    console.log("[test:changed] No changed paths require Vitest.");
    return 0;
  }
  if (plan.mode === "full") {
    console.log("[test:changed] A broad dependency changed. Running the full suite.");
  } else {
    console.log(`[test:changed] Running tests related to ${String(plan.files.length)} input(s).`);
  }
  return runTestPlan(plan);
}

function isDirectExecution() {
  const entryPath = process.argv[1];
  if (entryPath === undefined) return false;
  return pathToFileURL(resolve(entryPath)).href === import.meta.url;
}

if (isDirectExecution()) {
  try {
    process.exitCode = main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[test:changed] ${message}`);
    process.exitCode = 1;
  }
}
