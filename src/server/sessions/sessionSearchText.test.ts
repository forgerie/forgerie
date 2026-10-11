import { describe, expect, it } from "vitest";
import { extractSearchMessage, parseSearchQuery, searchPassage } from "./sessionSearchText.js";

describe("session search text", () => {
  it("extracts user strings and text parts without injected skill and file blocks", () => {
    const text = 'typed <skill name="audit" location="/skill">secret skill</skill> pasted <file name="/a">secret file</file> end';
    for (const content of [text, [{ type: "text", text }, { type: "image", data: "hidden" }]]) {
      expect(extractSearchMessage({ type: "message", id: "one", timestamp: "2026-01-01", message: { role: "user", content } })?.text).toBe("typed  pasted  end");
    }
  });
  it("excludes thinking, tool calls, results and custom messages", () => {
    expect(extractSearchMessage({ type: "message", id: "one", message: { role: "assistant", content: [{ type: "text", text: "visible" }, { type: "thinking", text: "hidden" }, { type: "toolCall", text: "hidden" }, { type: "image", text: "hidden" }] } })?.text).toBe("visible");
    for (const type of ["custom", "custom_message"]) expect(extractSearchMessage({ type, id: "one", message: { role: "user", content: "hidden" } })).toBeUndefined();
    expect(extractSearchMessage({ type: "message", id: "one", message: { role: "toolResult", content: "hidden" } })).toBeUndefined();
    expect(extractSearchMessage({ type: "message", id: "one", message: { role: "assistant", content: "visible" } })?.text).toBe("visible");
  });
  it("parses phrases, ignores short terms, and quotes all FTS syntax", () => {
    expect(parseSearchQuery('A to HELLO "two words" NEAR * "a"').terms).toEqual(["hello", "two words", "near"]);
    expect(parseSearchQuery('"say ""hello"""').fts).toBe('"say ""hello"""');
    expect(parseSearchQuery('foo* OR NEAR(a,b)').fts).toBe('"foo*" OR "near(a,b)"');
    expect(parseSearchQuery("needle 😊😊").terms).toEqual(["needle"]);
    expect(() => parseSearchQuery("a to *")).toThrow("at least 3");
  });
  it("keeps passage marks in source coordinates when case folding expands a character", () => {
    const passage = searchPassage({ entryId: "a", role: "user", timestamp: "", text: `${"İ".repeat(100)}NEEDLE` }, ["needle"]);
    expect(passage.marks.map(([start, end]) => passage.text.slice(start, end))).toEqual(["NEEDLE"]);
  });
  it("bounds passages and merges overlapping marks", () => {
    const passage = searchPassage({ entryId: "a", role: "assistant", timestamp: "", text: `${"x".repeat(500)}Hello world${"y".repeat(500)}` }, ["hello", "hello world"]);
    expect(passage.text.length).toBeLessThanOrEqual(240);
    expect(passage.marks.map(([start, end]) => passage.text.slice(start, end))).toEqual(["Hello world"]);
  });
});
