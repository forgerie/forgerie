import { describe, expect, it } from "vitest";
import { codemodeScriptSummary } from "./codemodeScript";

describe("codemodeScriptSummary", () => {
  it("names a script by its opening comment", () => {
    expect(codemodeScriptSummary("// List the project and read one file\nconst x = 1;")).toBe("List the project and read one file");
  });

  it("skips the options line, which configures the run rather than naming it", () => {
    expect(codemodeScriptSummary('// @options: {"timeout_ms": 60000}\n\n// Count the tests\nreturn 1;')).toBe("Count the tests");
  });

  it("reads a block comment without its markers", () => {
    expect(codemodeScriptSummary("/* Sort feedback by urgency */\nreturn 1;")).toBe("Sort feedback by urgency");
    expect(codemodeScriptSummary("/**\n * Find large files\n */")).toBe("Find large files");
  });

  it("falls back to the first statement when the script has no comment", () => {
    expect(codemodeScriptSummary("const files = await tools.bash({ command: 'ls' });\nreturn files;")).toBe("const files = await tools.bash({ command: 'ls' });");
  });

  it("collapses runs of whitespace", () => {
    expect(codemodeScriptSummary("   return    1;")).toBe("return 1;");
  });

  it("is empty for an empty script", () => {
    expect(codemodeScriptSummary("\n  \n")).toBe("");
  });
});
