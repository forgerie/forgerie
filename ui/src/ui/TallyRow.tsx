import { useId, useState, type ReactNode } from "react";
import "./TallyRow.css";

/** One mark's state. `faint` is a mark for work that never finished. */
export type TallyTone = "plain" | "bad" | "warn" | "live" | "faint";

/** The worst tone wins when marks are summed into one count. */
const SEVERITY: readonly TallyTone[] = ["plain", "faint", "live", "warn", "bad"];
const worst = (tones: readonly TallyTone[]): TallyTone =>
  tones.reduce<TallyTone>((top, tone) => SEVERITY.indexOf(tone) > SEVERITY.indexOf(top) ? tone : top, "plain");

/**
 * The marks a row shows. Past `limit`, the tail becomes one count that takes
 * the worst tone it hides, so a failure in the tail stays visible.
 */
export function visibleMarks(marks: readonly TallyTone[], limit: number): { shown: readonly TallyTone[]; more?: { count: number; tone: TallyTone } } {
  if (marks.length <= limit) return { shown: marks };
  const shown = marks.slice(0, Math.max(limit - 1, 0));
  const hidden = marks.slice(shown.length);
  return { shown, more: { count: hidden.length, tone: worst(hidden) } };
}

/**
 * System molecule: content with a tally of toned marks in its margin, one
 * mark per unit of work, in order. The tally opens a panel under the content.
 * Without content, a quiet line stands in, and the whole row opens the panel.
 * The panel and notes render only while open.
 */
export function TallyRow({ marks, label, title, line, live = false, notes, panel, children, limit = 9 }: {
  marks: readonly TallyTone[];
  /** Accessible name of the toggle: what the marks count. */
  label: string;
  /** The first line of the open panel. */
  title?: string;
  /** Shown in place of absent content. */
  line?: string;
  live?: boolean;
  /** Secondary text at the top of the open panel. */
  notes?: () => ReactNode;
  panel: () => ReactNode;
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
      {notes && <div className="tally-notes">{notes()}</div>}
      {panel()}
    </div>}
  </div>;
}
