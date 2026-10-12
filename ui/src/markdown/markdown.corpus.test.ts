// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import { diffLines } from "diff";
import { afterAll, expect, test } from "vitest";
import { isMarkdownPath, joinFrontMatter, markdownExtensions, richEditability, splitFrontMatter } from "./markdown";

const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const paths = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split("\0").filter(isMarkdownPath);
const counts = { editable: 0, lossy: 0, "too-large": 0 };
const causes = new Map<string, number>();

test("the corpus includes the repository's tracked Markdown", () => {
  expect(paths).toContain("README.md");
  expect(paths).toContain("AGENTS.md");
});

test.each(paths)("%s never throws, and round-trips byte for byte if editable", (path) => {
  const text = readFileSync(join(repo, path), "utf8");
  const result = richEditability(text);
  counts[result.kind]++;
  if (result.kind === "too-large") return;
  const parts = splitFrontMatter(text);
  const editor = new Editor({ element: null, extensions: markdownExtensions(), content: parts.body, contentType: "markdown" });
  try {
    const markdown = editor.getMarkdown();
    if (result.kind === "editable") {
      expect(joinFrontMatter({ ...parts, body: markdown })).toBe(text);
      return;
    }
    expect(markdown).not.toBe(parts.body);
    const diff = diffLines(parts.body, markdown);
    expect(result.changes).toBe(diff.reduce((sum, part) => sum + (part.added || part.removed ? part.count : 0), 0));
    // Diagnostic categories can overlap. Counts are files affected, not changed lines.
    const changedLines = diff.filter((part) => part.added || part.removed).flatMap((part) => part.value.split("\n"));
    const found = new Set<string>();
    if (parts.body.endsWith("\n") && !markdown.endsWith("\n")) found.add("final newline removed");
    if (changedLines.some((line) => /^\s*([-+*] |\d+[.)] )/.test(line))) found.add("list formatting or list content");
    if (changedLines.some((line) => /^\s*\|/.test(line))) found.add("table formatting or table content");
    if (changedLines.some((line) => /^\s*$/.test(line)) && diff.some((part) => (part.added || part.removed) && /\n\n/.test(part.value))) found.add("blank-line normalization");
    if (changedLines.some((line) => /\\[*_`[\]~]/.test(line))) found.add("literal-text escaping");
    if (changedLines.some((line) => /^\s*#{1,6} |^\s*[=-]{2,}\s*$/.test(line))) found.add("heading formatting or heading content");
    if (!found.size) found.add("other Markdown normalization");
    for (const cause of found) causes.set(cause, (causes.get(cause) ?? 0) + 1);
  } finally {
    editor.destroy();
  }
}, 30_000);

afterAll(() => {
  expect(counts.editable + counts.lossy + counts["too-large"]).toBe(paths.length);
  console.info("Markdown corpus:", JSON.stringify({ files: paths.length, ...counts, causes: [...causes].sort((a, b) => b[1] - a[1]) }));
});
