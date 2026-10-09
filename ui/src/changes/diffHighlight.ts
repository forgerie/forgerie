import { LanguageDescription, type Language } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightTree } from "@lezer/highlight";
import { codeHighlighter as highlighter } from "../ui/codeTokens";
import { sideOf, type DiffDocument, type DiffSide } from "./diffDocument";

type Parser = Language["parser"];

/** A highlighted stretch of document text. Never crosses a line. */
export interface Token { from: number; to: number; className: string }

/** Texts larger than this stay plain: one parse of them would hold up the page. */
export const HIGHLIGHT_LIMIT = 1_000_000;

/** The parser for a path's file type, loaded on demand, or nothing for a type the editor does not know. */
export async function parserFor(path: string): Promise<Parser | undefined> {
  const description = LanguageDescription.matchFilename(languages, path.slice(path.lastIndexOf("/") + 1));
  if (!description) return undefined;
  return (await description.load()).language.parser;
}

/**
 * Tokens for the whole document, in order. Each side is parsed as the file it
 * is, so a removed line inside a string or comment colours as it did before
 * the change. Context lines take their colour from the new side.
 */
export function diffTokens(document: DiffDocument, parser: Parser): Token[] {
  if (document.text.length > HIGHLIGHT_LIMIT) return [];
  const starts: number[] = [];
  let offset = 0;
  for (const line of document.lines) { starts.push(offset); offset += line.text.length + 1; }
  const tokens = [
    ...sideTokens(sideOf(document, "new"), parser, starts, () => true),
    ...sideTokens(sideOf(document, "old"), parser, starts, (line) => document.lines[line]?.kind === "remove"),
  ];
  return tokens.sort((a, b) => a.from - b.from || a.to - b.to);
}

function sideTokens(side: DiffSide, parser: Parser, documentStarts: readonly number[], wanted: (documentLine: number) => boolean): Token[] {
  if (side.lines.length === 0) return [];
  const sideStarts: number[] = [];
  let offset = 0;
  for (const line of side.text.split("\n")) { sideStarts.push(offset); offset += line.length + 1; }
  const lineAt = (position: number) => {
    let low = 0;
    let high = sideStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((sideStarts[middle] ?? 0) <= position) low = middle; else high = middle - 1;
    }
    return low;
  };
  const tokens: Token[] = [];
  highlightTree(parser.parse(side.text), highlighter, (from, to, className) => {
    // A block comment or a template string spans lines; the document holds them apart, so split it per line.
    for (let line = lineAt(from); line < sideStarts.length && (sideStarts[line] ?? 0) < to; line++) {
      const lineStart = sideStarts[line] ?? 0;
      const lineEnd = (sideStarts[line + 1] ?? side.text.length + 1) - 1;
      const start = Math.max(from, lineStart);
      const end = Math.min(to, lineEnd);
      const documentLine = side.lines[line];
      if (end <= start || documentLine === undefined || !wanted(documentLine)) continue;
      const base = documentStarts[documentLine] ?? 0;
      tokens.push({ from: base + start - lineStart, to: base + end - lineStart, className });
    }
  });
  return tokens;
}
