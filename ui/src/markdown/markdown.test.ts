// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import { describe, expect, test } from "vitest";
import { isMarkdownPath, joinFrontMatter, markdownExtensions, richEditability, splitFrontMatter } from "./markdown";

describe("Markdown paths", () => {
  test.each(["README.md", "docs/Guide.MARKDOWN", "note.Md"])("recognizes %s", (path) => {
    expect(isMarkdownPath(path)).toBe(true);
  });
  test.each(["README.mdx", "md", "note.md.ts", "directory.md/file"])("leaves %s unchanged", (path) => {
    expect(isMarkdownPath(path)).toBe(false);
  });
});

describe("front matter", () => {
  test.each([
    ["", null, ""],
    ["# Title\n", null, "# Title\n"],
    ["---\nname: demo\n---\n# Body\n", "---\nname: demo\n---\n", "# Body\n"],
    ["---\r\nname: demo\r\n---\r\nbody\r\n", "---\r\nname: demo\r\n---\r\n", "body\r\n"],
    ["---\nname: demo\n---\nbody", "---\nname: demo\n---\n", "body"],
    ["---\nname: demo\n---", "---\nname: demo\n---", ""],
    ["---\n---\n", "---\n---\n", ""],
    ["paragraph\n---\n", null, "paragraph\n---\n"],
    ["---\nno closing line", null, "---\nno closing line"],
    ["---", null, "---"],
    [" ---\nname: demo\n---\n", null, " ---\nname: demo\n---\n"],
    ["---\nname: demo\n----\n", null, "---\nname: demo\n----\n"],
  ])("preserves every byte of %j", (text, frontMatter, body) => {
    const parts = splitFrontMatter(text!);
    expect(parts).toEqual({ frontMatter, body });
    expect(joinFrontMatter(parts)).toBe(text);
  });
});

describe("rich editability", () => {
  test.each(["", "Plain text", "# Title", "**bold** and *italic*", "> Quote", "se_atomic_commit && other_value", "---\nname: demo\n---\nPlain text"])("allows exact Markdown: %j", (text) => {
    expect(richEditability(text)).toEqual({ kind: "editable" });
  });
  test("treats even a final newline difference as lossy", () => {
    expect(richEditability("Plain text\n")).toEqual({ kind: "lossy", changes: 2 });
  });
  test("counts added and removed lines, including syntax normalization", () => {
    expect(richEditability("Title\n=====\n\nbody")).toEqual({ kind: "lossy", changes: 3 });
  });
  test.each(["![alt](image.png)", "hello\r\n\r\nworld", "<strong>bold</strong>"])("blocks a rewrite of %j", (text) => {
    expect(richEditability(text)).toMatchObject({ kind: "lossy" });
  });
  test("checks the whole file's UTF-8 size before parsing", () => {
    expect(richEditability("x".repeat(262144))).toEqual({ kind: "editable" });
    expect(richEditability("x".repeat(262145))).toEqual({ kind: "too-large" });
    expect(richEditability("é".repeat(131072))).toEqual({ kind: "editable" });
    expect(richEditability("é".repeat(131073))).toEqual({ kind: "too-large" });
    expect(richEditability(`---\n${"x".repeat(262144)}\n---\n`)).toEqual({ kind: "too-large" });
  });
});

describe("the shared extension set", () => {
  test("parses transcript formatting, tables, tasks and links without opening links", () => {
    const editor = new Editor({
      element: null,
      extensions: markdownExtensions(),
      contentType: "markdown",
      content: "# Heading\n\n- [x] Task\n\n> **bold** and *italic*\n\n```sh\na && b_value\n```\n\n| A | B |\n| --- | --- |\n| c | d |\n\n[Link](https://example.com)",
    });
    try {
      const types = JSON.stringify(editor.getJSON());
      for (const type of ["heading", "taskList", "taskItem", "blockquote", "bold", "italic", "codeBlock", "table", "tableRow", "tableHeader", "tableCell", "link"]) {
        expect(types).toContain(`"type":"${type}"`);
      }
      expect(editor.extensionManager.extensions.find((extension) => extension.name === "link")?.options.openOnClick).toBe(false);
      expect(editor.getMarkdown()).toContain("a && b_value");
    } finally {
      editor.destroy();
    }
  });
  test("applies the literal encoder before the first serialization, without a mounted editor", () => {
    const editor = new Editor({ element: null, extensions: markdownExtensions(), contentType: "markdown", content: "se_atomic_commit && b_value" });
    try {
      expect(editor.getMarkdown()).toBe("se_atomic_commit && b_value");
      editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "*literal* [brackets] `ticks`" }] }] });
      expect(editor.getMarkdown()).toBe("\\*literal\\* \\[brackets\\] \\`ticks\\`");
    } finally {
      editor.destroy();
    }
  });
});
