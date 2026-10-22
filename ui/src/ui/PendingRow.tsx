import type { ReactNode } from "react";
import "./PendingRow.css";

/**
 * Molecule: one item in a list that waits for the reader's choice. A mark gutter keeps its words in line with the
 * list's other rows; the title can be pressed to show the item where it lives; a detail line says where it goes or
 * what became of it. The commands stand beside the words while the row has room and drop under them, at the words'
 * start, when it does not, so no command is ever cut. A `quiet` row needs nothing more and steps back. `below` takes
 * the words' width under everything, such as a running thing it started.
 */
export function PendingRow({ title, onShow, showLabel, mark, detail, detailTone, actions, below, tone }: {
  title: string;
  /** Show the item where it lives. Absent: the title is plain words. */
  onShow?: (() => void) | undefined;
  /** The title's accessible name and hover text when it can be pressed. */
  showLabel?: string | undefined;
  /** A small state mark in the gutter. */
  mark?: ReactNode;
  detail?: ReactNode;
  /** `bad`: the detail says why the last attempt failed, in the failure ink. */
  detailTone?: "bad" | undefined;
  actions?: ReactNode;
  below?: ReactNode;
  tone?: "quiet" | undefined;
}) {
  return <li className="pending-row" data-tone={tone}>
    <span className="pending-row-mark" aria-hidden="true">{mark}</span>
    <span className="pending-row-body">
      <span className="pending-row-words">
        {onShow ? <button type="button" className="pending-row-title" title={showLabel} aria-label={showLabel ? `${showLabel}: ${title}` : undefined}
          onClick={onShow}>{title}</button> : <span className="pending-row-title">{title}</span>}
        {detail !== undefined && detail !== null && detail !== false ? <span className="pending-row-detail" data-tone={detailTone}>{detail}</span> : null}
      </span>
      {actions !== undefined && actions !== null && actions !== false ? <span className="pending-row-actions">{actions}</span> : null}
    </span>
    {below !== undefined && below !== null && below !== false ? <div className="pending-row-below">{below}</div> : null}
  </li>;
}
