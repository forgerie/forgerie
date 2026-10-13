import type { ReactNode } from "react";
import "./EmptyState.css";

/**
 * Molecule: a list with nothing in it yet, as an invitation: an icon, a
 * title, one or two sentences on what goes here, and the action that adds the
 * first one.
 */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state">
    {icon ? <span className="empty-state-icon" aria-hidden="true">{icon}</span> : null}
    <h2 className="empty-state-title">{title}</h2>
    <p className="empty-state-text">{children}</p>
    {action ? <div className="empty-state-action">{action}</div> : null}
  </div>;
}
