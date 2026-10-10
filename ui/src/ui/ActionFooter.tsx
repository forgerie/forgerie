import type { ReactNode } from "react";
import "./ActionFooter.css";

export interface FooterAction { label: string; onPress: () => void; disabled?: boolean | undefined; tone?: "primary" | "danger" | undefined }

/** A pinned decision group. Text yields first; controls wrap together without leaving the footer. */
export function ActionFooter({ note, actions }: { note?: ReactNode; actions: readonly FooterAction[] }) {
  return <div className="action-footer">
    {note !== undefined && <div className="action-footer-note">{note}</div>}
    <div className="action-footer-controls">{actions.map((action) => <button type="button" className="action-footer-button" key={action.label}
      data-tone={action.tone} disabled={action.disabled} onClick={action.onPress}>{action.label}</button>)}</div>
  </div>;
}
