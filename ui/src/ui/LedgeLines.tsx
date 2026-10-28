import { useState, type MouseEvent, type ReactNode } from "react";
import "./LedgeLines.css";

/** One line that waits. */
export interface LedgeLine {
  key: string;
  kind: string;
  /** `strong`: the kind in full ink, for the line that goes first in its own way. */
  kindTone?: "strong" | undefined;
  /** `code`: the text is a command, set in the code face. */
  face?: "code" | undefined;
  text: string;
}

/**
 * Molecule: lines that wait in order, as one band of a ledge. Quieter than an offer: each line is a kind word in the
 * code face and its text cut to one line, with no box and no action of its own; a press shows all of it. A head counts
 * them beside the one action they share, such as clearing them all. One line alone sits beside that action. The list
 * scrolls inside a share of the container's height, and takes focus so a keyboard can scroll it.
 */
export function LedgeLines({ label, listLabel, head, action, lines }: {
  /** The band's accessible name. */
  label: string;
  /** The list's accessible name, such as what order the lines keep. */
  listLabel: string;
  /** The head's words, for two lines or more. */
  head: ReactNode;
  /** The one action every line shares. */
  action: { label: string; title?: string | undefined; disabled?: boolean | undefined; onPress: (event: MouseEvent<HTMLButtonElement>) => void };
  lines: readonly LedgeLine[];
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (lines.length === 0) return null;
  const toggle = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const button = <button type="button" className="ledge-lines-action" title={action.title} disabled={action.disabled} onClick={action.onPress}>
    {action.label}</button>;
  const line = (item: LedgeLine) => <li key={item.key} className="ledge-lines-line" data-tone={item.kindTone} data-face={item.face}
    data-open={open.has(item.key) || undefined}>
    <button type="button" className="ledge-lines-press" aria-expanded={open.has(item.key)} onClick={() => toggle(item.key)}>
      <span className="ledge-lines-kind">{item.kind}</span><span className="ledge-lines-gap">: </span>
      <span className="ledge-lines-text">{item.text}</span>
    </button>
  </li>;
  return <section className="ledge-lines" aria-label={label} data-ledge-band data-single={lines.length === 1 || undefined}>
    {lines.length > 1 ? <div className="ledge-lines-head"><span>{head}</span>{button}</div> : null}
    {/* Focusable so a keyboard can scroll it when it outgrows its height budget. */}
    <ol className="ledge-lines-items" tabIndex={0} aria-label={listLabel}>{lines.map(line)}</ol>
    {lines.length === 1 ? button : null}
  </section>;
}
