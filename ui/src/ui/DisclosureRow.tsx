import type { ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import "./DisclosureRow.css";

/**
 * Molecule: one `<li>` line of a list that opens in place. Closed, it is a mark, a title, an optional quieter line
 * under it, and a trail at the end: a status word, a count, an age. Open, the content it holds shows under the line,
 * indented past the mark, then an optional note. `struck` mutes a line that no longer stands. When the list is narrow
 * the trail moves under the title, so the title keeps the width.
 */
export function DisclosureRow({ icon, iconLabel, title, line, status, count, time, timeTitle, struck = false, open, onToggle, note, children }: {
  /** A small mark before the title, such as the kind of the item. */
  icon: ReactNode;
  /** The mark's hover text. */
  iconLabel?: string | undefined;
  title: string;
  /** A quieter line under the title, cut at two lines. */
  line?: ReactNode;
  /** One word at the end, such as the item's state. */
  status?: string | undefined;
  /** How many items the line stands for, said as "3 times". Shown only above one. */
  count?: number | undefined;
  /** How long ago, in shorthand. */
  time: string;
  timeTitle?: string | undefined;
  struck?: boolean;
  open: boolean;
  onToggle: () => void;
  /** A note under the open content. */
  note?: ReactNode;
  /** What the open line shows. */
  children: ReactNode;
}) {
  return <li className="disclosure-row" data-open={open || undefined} data-struck={struck || undefined}>
    <button type="button" className="disclosure-row-main" aria-expanded={open} onClick={onToggle}>
      <span className="disclosure-row-icon" title={iconLabel}>{icon}</span>
      <span className="disclosure-row-text">
        <span className="disclosure-row-title">{title}</span>
        {line !== undefined && <span className="disclosure-row-line">{line}</span>}
      </span>
      <span className="disclosure-row-trail">
        {status !== undefined && <span className="disclosure-row-status">{status}</span>}
        {count !== undefined && count > 1 && <span className="disclosure-row-count">{count} times</span>}
        <span title={timeTitle}>{time}</span>
      </span>
      {open ? <ChevronDownIcon aria-hidden className="disclosure-row-chevron" /> : <ChevronRightIcon aria-hidden className="disclosure-row-chevron" />}
    </button>
    {open && <div className="disclosure-row-content">
      {children}
      {note !== undefined && <p className="disclosure-row-note">{note}</p>}
    </div>}
  </li>;
}
