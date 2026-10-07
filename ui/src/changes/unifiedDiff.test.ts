import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./unifiedDiff";

const diff = [
  "diff --git a/src/retry.ts b/src/retry.ts",
  "index 1111111..2222222 100644",
  "--- a/src/retry.ts",
  "+++ b/src/retry.ts",
  "@@ -7,3 +7,3 @@ export function retry() {",
  " import x from \"x\";",
  "-const retries = 3;",
  "+const retries = 0;",
  " ",
  "@@ -40,2 +40,3 @@",
  " a",
  "+--- not a header",
  " b",
  "\\ No newline at end of file",
  "",
].join("\n");

describe("unified diff rows", () => {
  it("numbers code rows on their own sides and keeps headers as display rows", () => {
    const { rows, binary } = parseUnifiedDiff(diff);
    expect(binary).toBe(false);
    expect(rows.map((row) => row.kind)).toEqual(["meta", "meta", "meta", "meta", "hunk", "context", "remove", "add", "context",
      "hunk", "context", "add", "context", "marker"]);
    expect(rows[5]).toEqual({ kind: "context", text: "import x from \"x\";", oldLineNumber: 7, newLineNumber: 7 });
    expect(rows[6]).toEqual({ kind: "remove", text: "const retries = 3;", oldLineNumber: 8 });
    expect(rows[7]).toEqual({ kind: "add", text: "const retries = 0;", newLineNumber: 8 });
    expect(rows[8]).toEqual({ kind: "context", text: "", oldLineNumber: 9, newLineNumber: 9 });
  });

  it("reads a removed or added line that looks like a file header as code, using the hunk's counts", () => {
    const { rows } = parseUnifiedDiff(diff);
    expect(rows[11]).toEqual({ kind: "add", text: "--- not a header", newLineNumber: 41 });
    expect(rows[12]).toEqual({ kind: "context", text: "b", oldLineNumber: 41, newLineNumber: 42 });
  });

  it("ends a hunk at its counts, so the next file's header is not code", () => {
    const two = "@@ -1 +1 @@\n-a\n+b\ndiff --git a/c b/c\n--- a/c\n+++ b/c\n@@ -0,0 +1 @@\n+new\n";
    const { rows } = parseUnifiedDiff(two);
    expect(rows.map((row) => row.kind)).toEqual(["hunk", "remove", "add", "meta", "meta", "meta", "hunk", "add"]);
    expect(rows.at(-1)).toEqual({ kind: "add", text: "new", newLineNumber: 1 });
  });

  it("drops a carriage return at a line end and marks binary files", () => {
    expect(parseUnifiedDiff("@@ -1 +1 @@\r\n-a\r\n+b\r\n").rows[2]).toEqual({ kind: "add", text: "b", newLineNumber: 1 });
    expect(parseUnifiedDiff("diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n").binary).toBe(true);
    expect(parseUnifiedDiff("").rows).toEqual([]);
  });
});
