import { Markdown } from "@tiptap/markdown";
import { Marked, type marked } from "marked";

/**
 * Tiptap's Markdown extension for one editor, with its own marked instance.
 *
 * By default every editor parses with marked's one global instance and adds its
 * tokenizers to it for good. Each later parse then tries the tokenizers of every
 * editor made before it: parsing gets slower with every editor the page has made,
 * and an editor without task lists reads `- [ ] task` as a paragraph once an editor
 * with task lists has existed.
 */
export function editorMarkdown() {
  // The manager calls only use, lexer, setOptions, Lexer and defaults, which a Marked instance has.
  // Tiptap types the option as the global marked function.
  return Markdown.configure({ marked: new Marked() as unknown as typeof marked });
}
