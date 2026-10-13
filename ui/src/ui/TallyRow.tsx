import { useId, useState, type ReactNode } from "react";
import { visibleMarks, type TallyTone } from "./visibleMarks";
import "./TallyRow.css";

export { visibleMarks, type TallyTone };

/** One part of an open panel. */
export interface TallySection { key: string; notes?: ReactNode; body: ReactNode }

/**
 * System molecule: content with a tally of toned marks in its margin, one
 * mark per unit of work, in order. The tally opens a panel under the content.
 * Without content, a quiet line stands in, and the whole row opens the panel.
 * The panel lists the work in sections, each with optional notes, and renders
 * only while open.
 */
export function TallyRow({ marks, label, title, line, live = false, sections, children, limit = 9 }: {
  marks: readonly TallyTone[];
  /** Accessible name of the toggle: what the marks count. */
  label: string;
  /** The first line of the open panel. */
  title?: string;
  /** Shown in place of absent content. */
  line?: string;
  live?: boolean;
  /** The open panel's sections, in order. Notes are secondary text above a section's body. */
  sections: () => readonly TallySection[];
  children?: ReactNode;
  limit?: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { shown, more } = visibleMarks(marks, limit);
  const tally = <span className="tally-marks" aria-hidden="true">
    {shown.map((tone, index) => <span key={index} className="tally-mark" data-tone={tone} />)}
    {more && <span className="tally-more" data-tone={more.tone}>+{more.count}</span>}
  </span>;
  const quiet = children === undefined || children === null || children === false;
  const toggle = { type: "button" as const, "aria-expanded": open, "aria-controls": panelId, onClick: () => setOpen(!open) };
  return <div className="tally" data-tally="" data-open={open || undefined}>
    {quiet
      ? <button className="tally-toggle" data-wide="" {...toggle}>
        {tally}
        <span className="tally-line" data-live={live || undefined}><span className="tally-label">{label}: </span>{line}</span>
      </button>
      : <>
        <button className="tally-toggle" aria-label={label} {...toggle}>{tally}</button>
        <div className="tally-body">{children}</div>
      </>}
    {open && <div className="tally-panel" id={panelId}>
      {title && <div className="tally-title">{title}</div>}
      {sections().map((section) => <section key={section.key} className="tally-section">
        {section.notes && <div className="tally-notes">{section.notes}</div>}
        {section.body}
      </section>)}
    </div>}
  </div>;
}
