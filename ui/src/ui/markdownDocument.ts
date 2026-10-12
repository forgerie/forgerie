import { Editor, Extension, type Extensions } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { diffLines } from "diff";
import { keepPromptTextLiteral } from "./markdownLiteral";
import { frameMarkdownBody, splitFrontMatter } from "./markdownText";

/** The encoder runs after Markdown installs its manager, before any content is serialized. */
const LiteralText = Extension.create({
  name: "literalMarkdownText",
  priority: 0,
  onBeforeCreate() {
    keepPromptTextLiteral(this.editor);
  },
});

export function markdownExtensions(): Extensions {
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    Markdown,
    TableKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    LiteralText,
  ];
}

/**
 * Compare the serialized body with its original byte-exact frame restored.
 * Added and removed lines both count; replacing one line counts as two changes.
 * The caller owns the text buffer. This check never writes or normalizes it.
 */
export function richEditability(text: string): { kind: "editable" } | { kind: "lossy"; changes: number } | { kind: "too-large" } {
  if (new TextEncoder().encode(text).byteLength > 262144) return { kind: "too-large" };
  const { body } = splitFrontMatter(text);
  const editor = new Editor({ element: null, extensions: markdownExtensions(), content: body, contentType: "markdown" });
  try {
    const markdown = frameMarkdownBody(body, editor.getMarkdown());
    if (body === markdown) return { kind: "editable" };
    const changes = diffLines(body, markdown).reduce((total, part) => total + (part.added || part.removed ? part.count : 0), 0);
    return { kind: "lossy", changes };
  } finally {
    editor.destroy();
  }
}
