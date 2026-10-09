import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createTestPlan,
  normalizeRepoPaths,
  parseNameStatusChanges,
  parseNullDelimitedPaths,
  vitestArgsForTestPlan,
} from "./test-selection.mjs";

export { parseNameStatusChanges, parseNullDelimitedPaths } from "./test-selection.mjs";

const FULL_LINT_TRIGGERS = new Set([
  "eslint.config.js",
  "tsconfig.json",
]);

const LINTABLE_ROOT_FILES = new Set([
  "vitest.config.ts",
]);

const LINTABLE_DIRECTORIES = [
  "extensions/",
  "src/",
];

export function createValidationPlan(stagedPaths, options = {}) {
  const pathExists = options.pathExists ?? existsSync;
  const paths = normalizeRepoPaths(stagedPaths);

  const lint = paths.some((path) => FULL_LINT_TRIGGERS.has(path))
    ? { mode: "full", files: [] }
    : scopedValidation(paths.filter((path) => isLintablePath(path) && pathExists(path)), "scoped");

  return { paths, lint, tests: createTestPlan(paths, { pathExists }) };
}

export function createValidationPlanForChanges(changes) {
  const existingPaths = new Set(normalizeRepoPaths(
    changes.filter((change) => change.status !== "D").map((change) => change.path),
  ));
  return createValidationPlan(changes.map((change) => change.path), {
    pathExists: (path) => existingPaths.has(path),
  });
}

export function hasUnstagedWork(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const tracked = execFileSync("git", ["diff", "--name-only", "-z"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return tracked.length > 0 || untracked.length > 0;
}

export function createStagedSnapshot(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const snapshotRoot = mkdtempSync(join(tmpdir(), "forgerie-staged-"));
  const prefix = `${snapshotRoot.replaceAll("\\", "/")}/`;
  try {
    execFileSync("git", ["checkout-index", "--all", `--prefix=${prefix}`], {
      cwd,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const nodeModulesPath = join(cwd, "node_modules");
    if (existsSync(nodeModulesPath)) {
      symlinkSync(nodeModulesPath, join(snapshotRoot, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    }
    return snapshotRoot;
  } catch (error) {
    rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }
}

export function createValidationSteps(plan) {
  const steps = [
    {
      label: "cached whole-project typecheck",
      npmArgs: ["run", "typecheck:cached"],
    },
    {
      label: "whole-project Knip analysis",
      npmArgs: ["run", "knip"],
    },
  ];

  if (plan.lint.mode === "full") {
    steps.push({ label: "full ESLint validation (configuration changed)", npmArgs: ["run", "lint"] });
  } else if (plan.lint.mode === "scoped") {
    steps.push({
      label: `ESLint validation for ${String(plan.lint.files.length)} staged file(s)`,
      npmArgs: ["exec", "--", "eslint", "--", ...plan.lint.files],
    });
  }

  if (plan.tests.mode === "full") {
    steps.push({ label: "full Vitest validation (broad dependency changed)", npmArgs: ["test"] });
  } else if (plan.tests.mode === "related") {
    steps.push({
      label: `Vitest validation related to ${String(plan.tests.files.length)} staged input(s)`,
      npmArgs: ["exec", "--", "vitest", ...vitestArgsForTestPlan(plan.tests)],
    });
  }

  return steps;
}

function readStagedChanges() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-status", "--no-renames", "--diff-filter=ACMRDT", "-z"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return parseNameStatusChanges(output);
}

function isLintablePath(path) {
  if (LINTABLE_ROOT_FILES.has(path)) return true;
  return path.endsWith(".ts") && LINTABLE_DIRECTORIES.some((directory) => path.startsWith(directory));
}

function scopedValidation(files, mode) {
  return files.length > 0 ? { mode, files } : { mode: "skip", files: [] };
}

/**
 * Git exports GIT_DIR, GIT_INDEX_FILE, and similar variables to hooks. A test
 * that runs `git init` or `git commit` in a temp directory would otherwise
 * write to this repository: commits on the branch, `core.bare = true`, and a
 * test identity in its config. Only this script's own git calls need them.
 */
export function withoutGitHookEnvironment(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
}

function runNpmStep(step, cwd) {
  console.log(`\n[pre-commit] ${step.label}`);
  const invocation = npmInvocation(step.npmArgs);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    env: withoutGitHookEnvironment(process.env),
    stdio: "inherit",
  });
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
  const changes = readStagedChanges();
  const plan = createValidationPlanForChanges(changes);
  console.log(`[pre-commit] Planning validation for ${String(plan.paths.length)} staged file(s).`);

  const useSnapshot = hasUnstagedWork();
  const validationRoot = useSnapshot ? createStagedSnapshot() : process.cwd();
  try {
    for (const step of createValidationSteps(plan)) {
      const status = runNpmStep(step, validationRoot);
      if (status !== 0) return status;
    }

    if (plan.lint.mode === "skip") console.log("\n[pre-commit] No staged files require ESLint.");
    if (plan.tests.mode === "skip") console.log("[pre-commit] No staged files have related Vitest coverage.");
    return 0;
  } finally {
    if (useSnapshot) rmSync(validationRoot, { recursive: true, force: true });
  }
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
    console.error(`[pre-commit] ${message}`);
    process.exitCode = 1;
  }
}
