import type { ReactNode } from "react";
import "./RecordRow.css";

/** How much room the row has: wide keeps its action inline; narrow puts its meta on two lines. */
export type RecordRowLayout = "wide" | "medium" | "narrow";

/**
 * Molecule: one record in a list as one press target, with a mark for trouble,
 * a title of up to two lines, a time slot, a line of meta parts, and a foot
 * line that holds an outcome strip and the last outcome in words. An inline
 * action and a ⋯ menu sit at the foot's end, above the press target. Narrow,
 * the first meta part keeps its own line and the others share the next; on one
 * line, the last parts truncate first. Dimmed, the record is at rest.
 */
export function RecordRow({ label, title, time, meta, strip, outcome, mark, action, menu, dimmed = false, layout = "wide", onOpen }: {
  /** The press target's accessible name: the whole record in words. */
  label: string;
  title: string;
  time?: string | undefined;
  meta: readonly { key: string; text: string; title?: string | undefined }[];
  strip?: ReactNode;
  outcome?: string | undefined;
  mark?: "bad" | "warn" | undefined;
  action?: { label: string; onPress: () => void } | undefined;
  menu?: ReactNode;
  dimmed?: boolean;
  layout?: RecordRowLayout;
  onOpen: () => void;
}) {
  return <li className="record-row" data-layout={layout} data-dimmed={dimmed || undefined} data-mark={mark}>
    <span className="record-row-mark" aria-hidden="true"><i /></span>
    <button type="button" className="record-row-open" aria-label={label} onClick={onOpen}><span className="record-row-title">{title}</span></button>
    {time ? <span className="record-row-time">{time}</span> : null}
    <span className="record-row-meta">{meta.map((part) => <span key={part.key} className="record-row-part" title={part.title ?? part.text}>{part.text}</span>)}</span>
    <span className="record-row-foot">
      {strip}
      {outcome ? <span className="record-row-outcome" title={outcome}>{outcome}</span> : null}
    </span>
    {action || menu ? <span className="record-row-end">
      {action ? <button type="button" className="record-row-action" onClick={action.onPress}>{action.label}</button> : null}
      {menu}
    </span> : null}
  </li>;
}
