import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import "./FindBar.css";

export interface FindBarStep { label: string; onPress: () => void; disabled?: boolean | undefined }

/**
 * Molecule: a slim bar over a document for stepping through the places a
 * search found: where the reader is ("2 of 7"), previous, next, and close.
 * Without steps it carries one note about the found place, such as why it
 * cannot show yet. The words wrap when the bar is narrow; the controls keep
 * their row. Arrow keys step and Escape closes while focus is in the bar.
 */
export function FindBar({ name, label, detail, previous, next, action, close }: {
  /** The bar's accessible name, such as "Search matches". */
  name: string;
  /** Announced as it changes. */
  label: ReactNode;
  detail?: ReactNode;
  previous?: FindBarStep | undefined;
  next?: FindBarStep | undefined;
  /** One text action, such as a retry. */
  action?: { label: string; onPress: () => void } | undefined;
  close: { label: string; onPress: () => void };
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.onPress(); return; }
    const step = event.key === "ArrowUp" ? previous : event.key === "ArrowDown" ? next : undefined;
    if (!step || step.disabled) return;
    event.preventDefault();
    step.onPress();
  };
  return <div className="find-bar" role="group" aria-label={name} onKeyDown={onKeyDown}>
    <p className="find-bar-text" role="status">
      <span className="find-bar-label">{label}</span>
      {detail ? <span className="find-bar-detail">{detail}</span> : null}
    </p>
    {action ? <button type="button" className="find-bar-action" onClick={action.onPress}>{action.label}</button> : null}
    {previous ? <button type="button" className="find-bar-step" aria-label={previous.label} title={previous.label} disabled={previous.disabled}
      aria-keyshortcuts="ArrowUp" onClick={previous.onPress}><ChevronUpIcon aria-hidden size={16} /></button> : null}
    {next ? <button type="button" className="find-bar-step" aria-label={next.label} title={next.label} disabled={next.disabled}
      aria-keyshortcuts="ArrowDown" onClick={next.onPress}><ChevronDownIcon aria-hidden size={16} /></button> : null}
    <button type="button" className="find-bar-step" aria-label={close.label} title={close.label} aria-keyshortcuts="Escape"
      onClick={close.onPress}><XIcon aria-hidden size={16} /></button>
  </div>;
}
