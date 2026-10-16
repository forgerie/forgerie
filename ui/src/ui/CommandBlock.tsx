import { CopyButton } from "./CopyButton";
import { Excerpt } from "./Excerpt";
import "./CommandBlock.css";

/**
 * Molecule: one exact command, or what it printed, on a code surface, with a
 * copy button at its end. It is never cut silently: each long line wraps
 * under a hanging indent, so its end is in view at any width; with `lines` set, text
 * longer than that is cut with a fade and a toggle that opens the rest. A
 * shell command shows its prompt mark, which the copy leaves out.
 */
export function CommandBlock({ code, label, copyLabel, shell = false, lines, moreLabel, marked }: {
  code: string;
  /** The block's accessible name, such as "Command". */
  label: string;
  copyLabel: string;
  /** Draws the prompt mark before the first line. */
  shell?: boolean;
  /** Cut to this many lines, with a toggle to read the rest. A short pane shows fewer. Absent: always whole. */
  lines?: number | undefined;
  /** The toggle's words while the text is cut, such as "Show full result". */
  moreLabel?: string | undefined;
  /** Indexes of lines drawn on the warn wash, such as a process's stderr lines. */
  marked?: readonly number[] | undefined;
}) {
  const tinted = new Set(marked);
  // Each line hangs on its own, so a wrapped line reads as one line and the next line starts at the margin.
  const text = <pre className="command-block-code" data-shell={shell || undefined}>
    {code.split("\n").map((line, index) => <span className="command-block-line" key={index} data-marked={tinted.has(index) || undefined}>{line === "" ? " " : line}</span>)}
  </pre>;
  return <div className="command-block" role="group" aria-label={label}>
    <div className="command-block-text">
      {lines === undefined ? text : <Excerpt label={label} lines={lines} moreLabel={moreLabel}>{text}</Excerpt>}
    </div>
    <CopyButton label={copyLabel} getText={() => code} />
  </div>;
}
