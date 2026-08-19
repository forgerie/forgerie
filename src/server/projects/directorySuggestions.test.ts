import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandUserPath, listDirectorySuggestions } from "./directorySuggestions";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("directory suggestions", () => {
  it("expands empty, home, absolute, and relative paths", () => {
    expect(expandUserPath("")).toBe(expandUserPath("~"));
    expect(expandUserPath("/tmp/../tmp")).toBe("/tmp");
    expect(expandUserPath("relative")).toBe(resolve(process.cwd(), "relative"));
  });

  it("lists matching directories and directory symlinks in sorted order", async () => {
    const root = await tempDirectory();
    await mkdir(join(root, "alpha"));
    await mkdir(join(root, "alpine"));
    await mkdir(join(root, "beta"));
    await writeFile(join(root, "also-file"), "file");
    await symlink(join(root, "alpha"), join(root, "alias"));
    await symlink(join(root, "missing"), join(root, "albroken"));

    const suggestions = await listDirectorySuggestions(join(root, "al"));

    expect(suggestions.map((entry) => entry.path)).toEqual([
      `${join(root, "alias")}/`,
      `${join(root, "alpha")}/`,
      `${join(root, "alpine")}/`,
    ]);
    expect(suggestions.every((entry) => entry.kind === "other")).toBe(true);
  });

  it("treats a trailing separator as a request for all child directories", async () => {
    const root = await tempDirectory();
    await mkdir(join(root, "one"));
    await mkdir(join(root, "two"));

    const suggestions = await listDirectorySuggestions(`${root}/`);

    expect(suggestions.map((entry) => entry.path)).toEqual([`${join(root, "one")}/`, `${join(root, "two")}/`]);
  });
});

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "forgerie-directory-suggestions-"));
  cleanup.push(path);
  return path;
}
