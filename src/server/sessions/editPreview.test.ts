import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeEditPreview } from "./editPreview.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("computeEditPreview", () => {
  it("previews an exact replacement with its first changed line", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "note.txt"), "alpha\nbeta\ngamma\n", "utf8");

    const result = await computeEditPreview("note.txt", [{ oldText: "beta", newText: "changed" }], cwd);

    expect(result).toEqual({
      diff: [" 1 alpha", "-2 beta", "+2 changed", " 3 gamma"].join("\n"),
      firstChangedLine: 2,
    });
  });

  it("normalizes BOM, line endings, typography, spaces, and trailing whitespace for a fuzzy replacement", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "note.txt"), "\uFEFFconst answer = “yes” – now\u00a0 \r\nnext   \r\n", "utf8");

    const result = await computeEditPreview(
      "note.txt",
      [{ oldText: "const answer = \"yes\" - now\nnext", newText: "const answer = \"no\"\nnext" }],
      cwd,
    );

    expect(result).toEqual({
      diff: [
        "-1 const answer = \"yes\" - now",
        "+1 const answer = \"no\"",
        " 2 next",
      ].join("\n"),
      firstChangedLine: 1,
    });
  });

  it("applies multiple disjoint edits against the original content", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "note.txt"), "one\ntwo\nthree\nfour\n", "utf8");

    const result = await computeEditPreview("note.txt", [
      { oldText: "one", newText: "ONE" },
      { oldText: "four", newText: "FOUR" },
    ], cwd);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.firstChangedLine).toBe(1);
    expect(result.diff).toContain("-1 one");
    expect(result.diff).toContain("+1 ONE");
    expect(result.diff).toContain("-4 four");
    expect(result.diff).toContain("+4 FOUR");
  });

  it("reports missing and unreadable files", async () => {
    const cwd = await tempDir();

    const result = await computeEditPreview("missing.txt", [{ oldText: "old", newText: "new" }], cwd);

    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("Could not edit file: missing.txt. Error code: ENOENT.");
  });

  it.each([
    { content: "repeat\nrepeat\n", edits: [{ oldText: "", newText: "new" }], message: "oldText must not be empty" },
    { content: "repeat\nrepeat\n", edits: [{ oldText: "missing", newText: "new" }], message: "Could not find the exact text" },
    { content: "repeat\nrepeat\n", edits: [{ oldText: "repeat", newText: "new" }], message: "Found 2 occurrences" },
    { content: "repeat\n", edits: [{ oldText: "repeat", newText: "repeat" }], message: "No changes made" },
  ])("returns a bounded error when $message", async ({ content, edits, message }) => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "note.txt"), content, "utf8");

    const result = await computeEditPreview("note.txt", edits, cwd);

    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain(message);
  });

  it("collapses long context before, between, and after replacements", async () => {
    const cwd = await tempDir();
    const lines = Array.from({ length: 18 }, (_, index) => `entry-${String(index + 1).padStart(2, "0")}`);
    await writeFile(join(cwd, "note.txt"), `${lines.join("\n")}\n`, "utf8");

    const middle = await computeEditPreview("note.txt", [
      { oldText: "entry-02", newText: "changed-02" },
      { oldText: "entry-17", newText: "changed-17" },
    ], cwd);
    const first = await computeEditPreview("note.txt", [{ oldText: "entry-01", newText: "changed-01" }], cwd);
    const last = await computeEditPreview("note.txt", [{ oldText: "entry-18", newText: "changed-18" }], cwd);

    for (const result of [middle, first, last]) {
      expect("error" in result).toBe(false);
      if ("error" in result) continue;
      expect(result.diff).toContain("...");
    }
  });

  it("rejects overlapping replacements before changing content", async () => {
    const cwd = await tempDir();
    await writeFile(join(cwd, "note.txt"), "alpha beta gamma\n", "utf8");

    const result = await computeEditPreview("note.txt", [
      { oldText: "alpha beta", newText: "first" },
      { oldText: "beta gamma", newText: "second" },
    ], cwd);

    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("overlap in note.txt");
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "forgerie-edit-preview-test-"));
  tempDirs.push(dir);
  return dir;
}
