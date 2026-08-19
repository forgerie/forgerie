import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseNullDelimitedPaths, readChangedPaths, readChangedState } from "./test-changed.mjs";

const tempRoots = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("changed test input discovery", () => {
  it("parses NUL-delimited paths without breaking spaces", () => {
    expect(parseNullDelimitedPaths(Buffer.from("src/one.ts\0src/path with spaces/two.ts\0"))).toEqual([
      "src/one.ts",
      "src/path with spaces/two.ts",
    ]);
  });

  it("includes tracked and untracked worktree changes", async () => {
    const root = await createRepository();
    await writeFile(join(root, "src", "tracked.ts"), "export const value = 2;\n");
    await writeFile(join(root, "src", "path with spaces.ts"), "export const added = true;\n");

    expect(readChangedPaths(undefined, { cwd: root })).toEqual([
      "src/path with spaces.ts",
      "src/tracked.ts",
    ]);
  });

  it("includes committed branch changes after the merge base", async () => {
    const root = await createRepository();
    const base = git(root, "rev-parse", "HEAD").trim();
    await writeFile(join(root, "src", "tracked.ts"), "export const value = 2;\n");
    git(root, "add", "src/tracked.ts");
    git(root, "commit", "-m", "change tracked source");
    await writeFile(join(root, "src", "untracked.ts"), "export const pending = true;\n");

    expect(readChangedPaths(base, { cwd: root })).toEqual([
      "src/tracked.ts",
      "src/untracked.ts",
    ]);
  });

  it("keeps staged changes when an unstaged edit restores the HEAD content", async () => {
    const root = await createRepository();
    await writeFile(join(root, "src", "tracked.ts"), "export const value = 2;\n");
    git(root, "add", "src/tracked.ts");
    await writeFile(join(root, "src", "tracked.ts"), "export const value = 1;\n");

    expect(readChangedPaths(undefined, { cwd: root })).toEqual(["src/tracked.ts"]);
  });

  it("keeps committed changes when an uncommitted edit restores the base content", async () => {
    const root = await createRepository();
    const base = git(root, "rev-parse", "HEAD").trim();
    await writeFile(join(root, "src", "tracked.ts"), "export const value = 2;\n");
    git(root, "add", "src/tracked.ts");
    git(root, "commit", "-m", "change tracked source");
    await writeFile(join(root, "src", "tracked.ts"), "export const value = 1;\n");

    expect(readChangedPaths(base, { cwd: root })).toEqual(["src/tracked.ts"]);
  });

  it("preserves deletion status when a committed deletion is recreated locally", async () => {
    const root = await createRepository();
    const base = git(root, "rev-parse", "HEAD").trim();
    git(root, "rm", "src/tracked.ts");
    git(root, "commit", "-m", "delete tracked source");
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "tracked.ts"), "export const restored = true;\n");

    expect(readChangedState(base, { cwd: root })).toEqual({
      paths: ["src/tracked.ts"],
      deletedPaths: ["src/tracked.ts"],
    });
  });

  it("reports both sides of a rename so the deleted path forces a full run", async () => {
    const root = await createRepository();
    await rename(join(root, "src", "tracked.ts"), join(root, "src", "renamed.ts"));

    expect(readChangedState(undefined, { cwd: root })).toEqual({
      paths: ["src/renamed.ts", "src/tracked.ts"],
      deletedPaths: ["src/tracked.ts"],
    });
  });
});

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "forgerie-test-changed-"));
  tempRoots.push(root);
  await mkdir(join(root, "src"));
  git(root, "init");
  git(root, "config", "user.email", "tests@example.com");
  git(root, "config", "user.name", "Forgerie Tests");
  await writeFile(join(root, "src", "tracked.ts"), "export const value = 1;\n");
  git(root, "add", "src/tracked.ts");
  git(root, "commit", "-m", "initial");
  return root;
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
