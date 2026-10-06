import type { Editor } from "@tiptap/core";

/**
 * Tiptap escapes every `_`, `*`, `<`, `>`, and `&` it writes, so a prompt that
 * names `se_atomic_commit` reaches the model as `se\_atomic\_commit`, and
 * `a && b` as `a &amp;&amp; b`. An agent prompt is read by a model, not
 * rendered, so this escapes only what would change the document when it is
 * read back: backticks, brackets, tildes, and emphasis runs that could open or
 * close emphasis. Underscores inside words and spaced asterisks stay as typed.
 */
export function escapePromptText(text: string): string {
  return text
    .replace(/\\(?=[\\`*_[\]~])/g, "\\\\")
    .replace(/[`[\]~]/g, "\\$&")
    .replace(/[*_]+/g, (run: string, at: number, all: string) => {
      const before = all[at - 1] ?? " ";
      const after = all[at + run.length] ?? " ";
      const word = /[\p{L}\p{N}]/u;
      const opens = !/\s/.test(after) && !word.test(before);
      const closes = !/\s/.test(before) && !word.test(after);
      return opens || closes ? run.replace(/./g, "\\$&") : run;
    });
}

interface Manager {
  codeTypes: Set<string>;
  encodeTextForMarkdown: (text: string, node: { marks?: unknown[] }, parent?: { type?: string }) => string;
}

/** Swap Tiptap's text encoder for {@link escapePromptText}. Code keeps its text exactly. */
export function keepPromptTextLiteral(editor: Editor) {
  const manager = (editor as unknown as { markdown?: Manager }).markdown;
  if (!manager) return;
  const code = manager.codeTypes;
  manager.encodeTextForMarkdown = (text, node, parent) => {
    const inCode = (parent?.type != null && code.has(parent.type))
      || (node.marks ?? []).some((mark) => code.has(typeof mark === "string" ? mark : (mark as { type: string }).type));
    return inCode ? text : escapePromptText(text);
  };
}

/** Keep the file's own blank line after the header and one final newline. */
export function framePromptBody(original: string, markdown: string): string {
  const lead = /^\n*/.exec(original)?.[0] ?? "";
  return `${lead}${markdown.replace(/^\n+/, "").replace(/\s+$/, "")}\n`;
}
