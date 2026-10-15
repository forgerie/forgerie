import { highlightCode } from "./highlightCode";

/**
 * System atom: the body of a code sheet, under `CodeSheetHead`. It scrolls sideways instead of wrapping, and
 * colours the code by its language. Pass `highlight={false}` while the code is still arriving: a half-written
 * token would colour wrongly. The highlighter escapes all source text.
 */
export function CodeSheetBody({ code, language, highlight = true }: { code: string; language: string; highlight?: boolean }) {
  const highlighted = highlight ? highlightCode(code, language) : undefined;
  return <pre className="code-body" tabIndex={0} aria-label={`${language || "Text"} code`}>
    {highlighted === undefined ? <code>{code}</code> : <code dangerouslySetInnerHTML={{ __html: highlighted }} />}
  </pre>;
}
