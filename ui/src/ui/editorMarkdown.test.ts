// @vitest-environment happy-dom
import { Editor, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { expect, it } from "vitest";
import { editorMarkdown } from "./editorMarkdown";
import { markdownExtensions } from "./markdownDocument";

const TASKS = "- [ ] task\n- [x] done\n";

function read(extensions: Extensions, content: string) {
  const editor = new Editor({ element: null, extensions, content, contentType: "markdown" });
  try {
    return { json: editor.getJSON(), markdown: editor.getMarkdown() };
  } finally {
    editor.destroy();
  }
}

it("reads Markdown the same whatever editors the page made before", () => {
  // The prompt editor's extensions: no task lists, so a task list is a bullet list with its brackets as text.
  const prompt = () => [StarterKit, editorMarkdown()];
  const first = read(prompt(), TASKS);
  expect(first.json).toMatchObject({ content: [{ type: "bulletList" }] });

  // A Markdown document editor knows task lists. Its tokenizers must not reach the next editor.
  expect(read(markdownExtensions(), TASKS).json).toMatchObject({ content: [{ type: "taskList" }] });

  expect(read(prompt(), TASKS)).toEqual(first);
});
