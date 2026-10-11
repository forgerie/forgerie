import type { ReactNode } from "react";
import { CircleAlertIcon, ExternalLinkIcon } from "lucide-react";
import "./DecisionCard.css";

/**
 * Molecule: something in a thread that waits on the reader's decision. While
 * it is open it wears the live colour on its edge and a faint live wash, and
 * its footer holds the choices. A choice that failed says why above them.
 * Once decided it goes quiet and says what was decided in one line, where the
 * choices stood; that line can open what the decision made.
 */
export function DecisionCard({ icon, title, meta, open, closed, closedHref, problem, children, footer }: {
  icon: ReactNode;
  title: string;
  /** A short fact at the end of the title line, such as the file it concerns. */
  meta?: ReactNode;
  open: boolean;
  /** What was decided, shown once the card is closed. */
  closed?: string | undefined;
  /** Where the closed line leads, such as the thing the decision made. It opens in a new tab. */
  closedHref?: string | undefined;
  /** Why the last choice failed, shown above the choices while the card is open. */
  problem?: string | undefined;
  children?: ReactNode;
  /** The choices, shown while the card is open. */
  footer?: ReactNode;
}) {
  return <section className="decision-card" data-open={open || undefined} aria-label={title}>
    <header className="decision-card-head">
      <span className="decision-card-icon" aria-hidden>{icon}</span>
      <span className="decision-card-title">{title}</span>
      {meta !== undefined && <span className="decision-card-meta">{meta}</span>}
    </header>
    {children !== undefined && <div className="decision-card-body">{children}</div>}
    {open && problem !== undefined && <p className="decision-card-problem" role="alert">
      <CircleAlertIcon className="decision-card-problem-mark" aria-hidden />{problem}
    </p>}
    {open ? footer : closed !== undefined && <p className="decision-card-closed">
      {closedHref === undefined ? closed : <a className="decision-card-link" href={closedHref} target="_blank" rel="noreferrer">
        {closed}<ExternalLinkIcon className="decision-card-link-mark" aria-hidden />
      </a>}
    </p>}
  </section>;
}
