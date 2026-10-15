import type { ReactNode } from "react";
import "./GuessTag.css";

/**
 * System atom: a short word that something inferred, not declared, as a
 * readout in a row, such as what a reply seems to ask for. Muted ink in the
 * reader's face. `raised` draws it in full ink and weight for something more
 * pressing, still with no signal colour. It is read as its `label`, which says
 * it is a guess; the shown word is hover text too. It truncates last.
 */
export function GuessTag({ text, label, tone = "quiet", icon }: {
  /** The shown word, such as "Review". */
  text: string;
  /** The whole statement for a screen reader and the hover text, such as "Likely needs you: review". */
  label: string;
  tone?: "quiet" | "raised";
  /** A small mark before the word, such as for a raised tone. */
  icon?: ReactNode;
}) {
  return <span className="guess-tag" data-tone={tone} title={label}>
    <span className="guess-tag-said">{label}</span>
    <span className="guess-tag-face" aria-hidden="true">{icon}<span className="guess-tag-text">{text}</span></span>
  </span>;
}
