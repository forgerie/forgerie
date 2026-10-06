/** Pi's name for the tool that runs a model-written script against the other tools. */
export const CODEMODE_TOOL_NAME = "codemode";

const OPTIONS_LINE = /^\s*\/\/\s*@options:/u;
const COMMENT_MARKERS = /^\s*(?:\/\/+|\/\*+|\*+\/?)\s*|\s*\*+\/\s*$/gu;

/**
 * One line that says what a `codemode` script is for.
 *
 * Models usually open a script with a comment that states its purpose, so the
 * first meaningful line is the best name the script has; failing a comment,
 * its first statement is still the most literal thing to show. The
 * `// @options:` line configures the run and says nothing about the work.
 */
export function codemodeScriptSummary(code: string): string {
  for (const line of code.split(/\r?\n/u)) {
    if (OPTIONS_LINE.test(line)) continue;
    const text = line.replace(COMMENT_MARKERS, "").replace(/\s+/gu, " ").trim();
    if (text !== "") return text;
  }
  return "";
}
