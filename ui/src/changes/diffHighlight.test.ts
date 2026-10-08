import { describe, expect, it } from "vitest";
import { diffDocument } from "./diffDocument";
import { diffTokens, parserFor } from "./diffHighlight";
import { parseUnifiedDiff } from "./unifiedDiff";

const document = (lines: string[]) => diffDocument(parseUnifiedDiff(lines.join("\n")).rows);
const coloured = (text: string, tokens: ReturnType<typeof diffTokens>, className: string) =>
  tokens.filter((token) => token.className === className).map((token) => text.slice(token.from, token.to));

describe("parserFor", () => {
  it("finds a parser by file name and none for an unknown type", async () => {
    expect(await parserFor("src/app/main.ts")).toBeDefined();
    expect(await parserFor("notes/readme.unknownext")).toBeUndefined();
  });
});

describe("diffTokens", () => {
  it("colours each side as its own file, so a removed line keeps its colour", async () => {
    const parser = await parserFor("a.ts");
    if (!parser) throw new Error("No TypeScript parser");
    // The added line opens a block comment. Read as one text, the removed line after it would be comment too.
    const result = document(["@@ -1,2 +1,3 @@", " const a = 1;", "+/* start", "+end */", "-return a;"]);
    const tokens = diffTokens(result, parser);
    expect(coloured(result.text, tokens, "tok-comment")).toEqual(["/* start", "end */"]);
    expect(coloured(result.text, tokens, "tok-keyword")).toEqual(["const", "return"]);
    expect(coloured(result.text, tokens, "tok-number")).toEqual(["1"]);
  });

  it("returns tokens in document order, none crossing a line", async () => {
    const parser = await parserFor("a.js");
    if (!parser) throw new Error("No JavaScript parser");
    const result = document(["@@ -1,2 +1,2 @@", "-let x = `a", "+let y = `a", " b`;"]);
    const tokens = diffTokens(result, parser);
    expect(tokens.map((token) => token.from)).toEqual([...tokens.map((token) => token.from)].sort((a, b) => a - b));
    for (const token of tokens) expect(result.text.slice(token.from, token.to)).not.toContain("\n");
  });
});
