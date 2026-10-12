import { Editor, Extension, type Extensions } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { diffLines } from "diff";
import { keepPromptTextLiteral } from "../agents/promptMarkdown";

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

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function splitFrontMatter(text: string): { frontMatter: string | null; body: string } {
  const opening = /^---\r?\n/.exec(text);
  if (!opening) return { frontMatter: null, body: text };
  const remaining = text.slice(opening[0].length);
  const closing = /^---(?:\r?\n|$)/m.exec(remaining);
  if (!closing) return { frontMatter: null, body: text };
  const end = opening[0].length + closing.index + closing[0].length;
  return { frontMatter: text.slice(0, end), body: text.slice(end) };
}

export function joinFrontMatter(parts: { frontMatter: string | null; body: string }): string {
  return (parts.frontMatter ?? "") + parts.body;
}

/**
 * File fidelity is stricter than framePromptBody: even one final newline matters.
 * Added and removed lines both count; replacing one line counts as two changes.
 * The caller owns the text buffer. This check never writes or normalizes it.
 */
export function richEditability(text: string): { kind: "editable" } | { kind: "lossy"; changes: number } | { kind: "too-large" } {
  if (new TextEncoder().encode(text).byteLength > 262144) return { kind: "too-large" };
  const { body } = splitFrontMatter(text);
  const editor = new Editor({ element: null, extensions: markdownExtensions(), content: body, contentType: "markdown" });
  try {
    const markdown = editor.getMarkdown();
    if (body === markdown) return { kind: "editable" };
    const changes = diffLines(body, markdown).reduce((total, part) => total + (part.added || part.removed ? part.count : 0), 0);
    return { kind: "lossy", changes };
  } finally {
    editor.destroy();
  }
}
