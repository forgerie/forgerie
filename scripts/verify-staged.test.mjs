import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDependenciesReady,
  createStagedSnapshot,
  createValidationPlan,
  createValidationPlanForChanges,
  hasUnstagedWork,
  createValidationSteps,
  parseNameStatusChanges,
  parseNullDelimitedPaths,
  withoutGitHookEnvironment,
} from "./verify-staged.mjs";

describe("staged validation planning", () => {
  it("keeps hook git variables away from validation steps so test repositories stay isolated", () => {
    expect(withoutGitHookEnvironment({
      GIT_DIR: "/repo/.git/worktrees/branch",
      GIT_INDEX_FILE: "/repo/.git/worktrees/branch/index",
      GIT_PREFIX: "",
      PATH: "/bin",
      npm_execpath: "/npm-cli.js",
    })).toEqual({ PATH: "/bin", npm_execpath: "/npm-cli.js" });
  });

  it("parses NUL-delimited Git paths without breaking spaces", () => {
    expect(parseNullDelimitedPaths(Buffer.from("src/one.ts\0src/path with spaces/two.ts\0"))).toEqual([
      "src/one.ts",
      "src/path with spaces/two.ts",
    ]);
  });

  it("parses staged statuses so deletions stay deleted when the worktree recreates a path", () => {
    expect(parseNameStatusChanges(Buffer.from("D\0src/deleted.ts\0M\0src/path with spaces.ts\0"))).toEqual([
      { status: "D", path: "src/deleted.ts" },
      { status: "M", path: "src/path with spaces.ts" },
    ]);
  });

  it("creates a validation snapshot from the staged index", async () => {
    const root = await mkdtemp(join(tmpdir(), "forgerie-verify-staged-"));
    let snapshotRoot;
    try {
      git(root, "init");
      git(root, "config", "user.email", "tests@example.com");
      git(root, "config", "user.name", "Forgerie Tests");
      const file = join(root, "value.txt");
      await writeFile(file, "committed\n");
      git(root, "add", "value.txt");
      git(root, "commit", "-m", "initial");
      await writeFile(file, "staged\n");
      git(root, "add", "value.txt");
      expect(hasUnstagedWork({ cwd: root })).toBe(false);
      await writeFile(file, "unstaged\n");
      expect(hasUnstagedWork({ cwd: root })).toBe(true);

      snapshotRoot = createStagedSnapshot({ cwd: root });

      await expect(readFile(join(snapshotRoot, "value.txt"), "utf8")).resolves.toBe("staged\n");
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        snapshotRoot === undefined ? Promise.resolve() : rm(snapshotRoot, { recursive: true, force: true }),
      ]);
    }
  });

  it("scopes ESLint and Vitest to staged source files", () => {
    const plan = createValidationPlan([
      "src/client/src/components/ChatView.ts",
      "src/client/src/components/ChatView.test.ts",
      "README.md",
    ], { pathExists: () => true });

    expect(plan).toEqual({
      paths: [
        "README.md",
        "src/client/src/components/ChatView.test.ts",
        "src/client/src/components/ChatView.ts",
      ],
      lint: {
        mode: "scoped",
        files: [
          "src/client/src/components/ChatView.test.ts",
          "src/client/src/components/ChatView.ts",
        ],
      },
      tests: {
        mode: "related",
        files: [
          "src/client/src/components/ChatView.test.ts",
          "src/client/src/components/ChatView.ts",
        ],
      },
      ui: false,
    });
  });

  it("runs the full suite when a deleted source file removes dependency-graph evidence", () => {
    const plan = createValidationPlan(["src/shared/deleted.ts"], { pathExists: () => false });

    expect(plan.lint).toEqual({ mode: "skip", files: [] });
    expect(plan.tests).toEqual({ mode: "full", files: [] });
  });

  it("validates staged source content even when the worktree deletes the file", () => {
    const plan = createValidationPlanForChanges([{ status: "M", path: "src/shared/staged.ts" }]);

    expect(plan.lint).toEqual({ mode: "scoped", files: ["src/shared/staged.ts"] });
    expect(plan.tests).toEqual({ mode: "related", files: ["src/shared/staged.ts"] });
  });

  it("adds tests for repository assets that are read dynamically", () => {
    const plan = createValidationPlan(["nix/whisper-stt.nix", "speech/whisper_worker.py"], { pathExists: () => true });
    expect(plan.tests).toEqual({ mode: "related", files: ["src/server/speech/whisperProcess.test.ts"] });
  });

  it("runs only the affected full validator when its configuration changes", () => {
    const eslintPlan = createValidationPlan(["eslint.config.js"], { pathExists: () => true });
    expect(eslintPlan.lint).toEqual({ mode: "full", files: [] });
    expect(eslintPlan.tests).toEqual({ mode: "skip", files: [] });

    const vitestPlan = createValidationPlan(["vitest.config.ts"], { pathExists: () => true });
    expect(vitestPlan.lint).toEqual({ mode: "scoped", files: ["vitest.config.ts"] });
    expect(vitestPlan.tests).toEqual({ mode: "full", files: [] });

    const typescriptPlan = createValidationPlan(["tsconfig.json"], { pathExists: () => true });
    expect(typescriptPlan.lint).toEqual({ mode: "full", files: [] });
    expect(typescriptPlan.tests).toEqual({ mode: "full", files: [] });
  });

  it.each([
    "package.json",
    "package-lock.json",
    "tsconfig.build.json",
    "vendor/example/package.tgz",
  ])("runs the full suite for broad dependency %s", (path) => {
    expect(createValidationPlan([path], { pathExists: () => true }).tests).toEqual({
      mode: "full",
      files: [],
    });
  });

  it("adds the browser app's Knip analysis when a ui file is staged", () => {
    const plan = createValidationPlan(["ui/src/workflows/workflowsModel.ts"], { pathExists: () => true });
    expect(createValidationSteps(plan).map((step) => step.npmArgs).slice(0, 3)).toEqual([["run", "typecheck:cached"], ["run", "knip"], ["run", "knip:ui"]]);
    const server = createValidationPlan(["src/server/index.ts"], { pathExists: () => true });
    expect(createValidationSteps(server).map((step) => step.npmArgs)).not.toContainEqual(["run", "knip:ui"]);
  });

  it("always includes cached typechecking and Knip before scoped checks", () => {
    const plan = createValidationPlan(["./src/path with spaces/example.ts"], { pathExists: () => true });

    expect(createValidationSteps(plan).map((step) => step.npmArgs)).toEqual([
      ["run", "typecheck:cached"],
      ["run", "knip"],
      ["exec", "--", "eslint", "--", "src/path with spaces/example.ts"],
      [
        "exec",
        "--",
        "vitest",
        "related",
        "--run",
        "--config",
        "vitest.config.ts",
        "--passWithNoTests",
        "src/path with spaces/example.ts",
      ],
    ]);
  });
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}


describe("dependency environment preflight", () => {
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "forgerie-dependency-preflight-"));
    await mkdir(join(root, "ui"));
    for (const prefix of ["", "ui"]) await writeFile(join(root, prefix, "package.json"), JSON.stringify({ devDependencies: { tool: "1.0.0" } }));
    return root;
  }
  async function install(directory) {
    await mkdir(join(directory, "tool"), { recursive: true });
    await mkdir(join(directory, ".bin"));
    await writeFile(join(directory, "tool/package.json"), JSON.stringify({ bin: { tool: "cli.js" } }));
    await writeFile(join(directory, "tool/cli.js"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await symlink("../tool/cli.js", join(directory, ".bin/tool"));
  }
  it.each(["absent", "cache-only", "broken link", "nested"])("reports %s installs as one actionable environment error", async kind => {
    const root = await fixture();
    try {
      if (kind === "cache-only") await mkdir(join(root, "node_modules/.cache"), { recursive: true });
      if (kind === "broken link") await symlink(join(root, "missing"), join(root, "node_modules"));
      if (kind === "nested") await mkdir(join(root, "node_modules/node_modules"), { recursive: true });
      expect(() => assertDependenciesReady(root)).toThrow(/Dependency environment.*root:.*ui:.*npm ci/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("accepts working directory links and rejects a broken ui binary", async () => {
    const root = await fixture();
    try {
      await install(join(root, "installed"));
      await symlink(join(root, "installed"), join(root, "node_modules"));
      await install(join(root, "ui/node_modules"));
      expect(() => assertDependenciesReady(root)).not.toThrow();
      await rm(join(root, "ui/node_modules/tool/cli.js"));
      expect(() => assertDependenciesReady(root)).toThrow(/ui:.*\.bin.*tool.*npm ci/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
