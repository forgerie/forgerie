import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
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
          "src/docker/piWebDockerDocs.test.ts",
        ],
      },
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
    const plan = createValidationPlan([
      "docker/internal/image/install-opensuse-base",
      "docs/site.js",
      "install.sh",
      "nix/smart-turn.nix",
      "pi-web-plugins/updates/updatesLogic.ts",
      "src/client/public/manifest.webmanifest",
      "speech/whisper_worker.py",
    ], { pathExists: () => true });

    expect(plan.tests).toEqual({
      mode: "related",
      files: [
        "pi-web-plugins/pluginPublicApi.test.ts",
        "pi-web-plugins/updates/updatesLogic.ts",
        "scripts/docs-site.test.mjs",
        "src/clientBuildContents.test.ts",
        "src/docker/piWebDockerDocs.test.ts",
        "src/docker/piWebDockerEntrypoint.test.ts",
        "src/installScript.test.ts",
        "src/server/dockerControlAssets.test.ts",
        "src/server/dockerDevDependencySync.test.ts",
        "src/server/speech/smartTurnProcess.test.ts",
        "src/server/speech/whisperProcess.test.ts",
      ],
    });
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
    "tsconfig.plugin-api.json",
    "tsconfig.plugins.json",
    "vendor/pi-processes/package.tgz",
  ])("runs the full suite for broad dependency %s", (path) => {
    expect(createValidationPlan([path], { pathExists: () => true }).tests).toEqual({
      mode: "full",
      files: [],
    });
  });

  it("runs the production client build test for Vite configuration changes", () => {
    const plan = createValidationPlan(["vite.config.ts"], { pathExists: () => true });

    expect(plan.lint).toEqual({ mode: "scoped", files: ["vite.config.ts"] });
    expect(plan.tests).toEqual({ mode: "related", files: ["src/clientBuildContents.test.ts"] });
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
