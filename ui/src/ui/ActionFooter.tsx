import type { ReactNode } from "react";
import "./ActionFooter.css";

export interface FooterAction { label: string; onPress: () => void; disabled?: boolean | undefined; tone?: "primary" | "danger" | undefined }

/**
 * A pinned decision group. Text yields first; controls wrap together without leaving the footer.
 * An `input`, such as a reply box for a note, takes the place of the actions while it is open; the note stays above it.
 * With no actions and no input, the footer is its note alone.
 */
export function ActionFooter({ note, actions, input }: { note?: ReactNode; actions: readonly FooterAction[]; input?: ReactNode }) {
  return <div className="action-footer">
    {note !== undefined && <div className="action-footer-note">{note}</div>}
    {input ?? (actions.length > 0 && <div className="action-footer-controls">{actions.map((action) => <button type="button" className="action-footer-button" key={action.label}
      data-tone={action.tone} disabled={action.disabled} onClick={action.onPress}>{action.label}</button>)}</div>)}
  </div>;
}
