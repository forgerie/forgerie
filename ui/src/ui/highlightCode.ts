import hljs from "./codeGrammars";

// Unknown fence labels are plain text. Highlight.js escapes HTML in known languages.
export function highlightCode(code: string, language: string): string | undefined {
  return hljs.getLanguage(language) ? hljs.highlight(code, { language, ignoreIllegals: true }).value : undefined;
}
