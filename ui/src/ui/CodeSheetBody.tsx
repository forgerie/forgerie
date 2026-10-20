import { memo, useRef } from "react";
import { codeLanguageName } from "./codeLanguageNames";
import { useCodeHighlighter } from "./useCodeHighlighter";

/**
 * System atom: the body of a code sheet, under `CodeSheetHead`. It scrolls sideways instead of wrapping, and
 * colours the code by its language. Pass `highlight={false}` while the code is still arriving: a half-written
 * token would colour wrongly. The highlighter escapes all source text.
 */
export const CodeSheetBody = memo(function CodeSheetBody({ code, language, highlight = true }: { code: string; language: string; highlight?: boolean }) {
  const source = useRef<HTMLPreElement>(null);
  const highlighter = useCodeHighlighter(highlight && codeLanguageName(language) !== undefined, source);
  const highlighted = highlighter?.(code, language);
  return <pre ref={source} className="code-body" tabIndex={0} aria-label={`${language || "Text"} code`}>
    {highlighted === undefined ? <code>{code}</code> : <code dangerouslySetInnerHTML={{ __html: highlighted }} />}
  </pre>;
});
