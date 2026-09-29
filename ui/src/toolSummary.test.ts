import { describe, expect, it } from "vitest";
import { clipOutput, formatToolArgs, summarizeToolArgs } from "./toolSummary";

describe("tool argument summaries", () => {
  it("prefers the command, then the path, then edit counts", () => {
    expect(summarizeToolArgs({ command: "npm test", timeout: 20 })).toBe("npm test");
    expect(summarizeToolArgs({ path: "src/a.ts", offset: 1 })).toBe("src/a.ts");
    expect(summarizeToolArgs({ oldText: "a", newText: "b" })).toBe("edit text replacement");
    expect(summarizeToolArgs({ edits: [{}, {}] })).toBe("2 edits");
    expect(summarizeToolArgs({ edits: [{}] })).toBe("1 edit");
  });
  it("lists up to three other arguments on one short line", () => {
    expect(summarizeToolArgs({ a: 1, b: null, c: "x\n  y", d: [1], e: 5 })).toBe("a: 1, c: x y, d: [1]");
    expect(summarizeToolArgs({ query: "q".repeat(100) })).toBe(`query: ${"q".repeat(79)}…`);
    expect(summarizeToolArgs(undefined)).toBe("");
  });
  it("shows a plain command as-is and anything else as JSON", () => {
    expect(formatToolArgs({ command: "ls -la", timeout: 5 })).toBe("ls -la");
    expect(formatToolArgs({ path: "a" })).toBe('{\n  "path": "a"\n}');
    expect(formatToolArgs(undefined)).toBe("");
  });
  it("clips very large output and counts what it hid", () => {
    expect(clipOutput("abcdef", 4)).toEqual({ text: "abcd", hidden: 2 });
    expect(clipOutput("abc", 4)).toEqual({ text: "abc", hidden: 0 });
  });
});
