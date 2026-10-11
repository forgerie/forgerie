import type { ReactNode } from "react";
import "./DecisionCard.css";

/**
 * Molecule: something in a thread that waits on the reader's decision. While
 * it is open it wears the live colour on its edge and a faint live wash, and
 * its footer holds the choices. Once decided it goes quiet and says what was
 * decided in one line, where the choices stood.
 */
export function DecisionCard({ icon, title, meta, open, closed, children, footer }: {
  icon: ReactNode;
  title: string;
  /** A short fact at the end of the title line, such as the file it concerns. */
  meta?: ReactNode;
  open: boolean;
  /** What was decided, shown once the card is closed. */
  closed?: string | undefined;
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
    {open ? footer : closed !== undefined && <p className="decision-card-closed">{closed}</p>}
  </section>;
}
