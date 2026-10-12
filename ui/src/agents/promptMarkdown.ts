export { escapePromptText, keepPromptTextLiteral } from "../ui/markdownLiteral";

/** Keep the file's own blank line after the header and one final newline. */
export function framePromptBody(original: string, markdown: string): string {
  const lead = /^\n*/.exec(original)?.[0] ?? "";
  return `${lead}${markdown.replace(/^\n+/, "").replace(/\s+$/, "")}\n`;
}
