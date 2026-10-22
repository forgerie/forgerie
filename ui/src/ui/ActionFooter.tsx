import type { ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import "./ActionFooter.css";

export interface FooterAction { label: string; onPress: () => void; disabled?: boolean | undefined; tone?: "primary" | "danger" | "quiet" | undefined }

/**
 * A pinned decision group. Text yields first; controls wrap together without leaving the footer.
 * An `input`, such as a reply box for a note, takes the place of the actions while it is open; the note stays above it.
 * With no actions and no input, the footer is its note alone. A `problem`, such as why the last action failed, is
 * said in the failure ink right above the actions or the input, and announced. With `stack`, a container under 26rem
 * puts the primary action alone on the first row and the others side by side under it. A `quiet` action, such as Dismiss,
 * is words without a frame, last in the row.
 */
export function ActionFooter({ note, problem, actions, input, stack = false, noteLastWhenShort = false }: {
  note?: ReactNode; problem?: string | undefined; actions: readonly FooterAction[]; input?: ReactNode;
  /** In a short container (under 42rem tall), the note follows the actions, so the actions show first. */
  noteLastWhenShort?: boolean;
  /** In a narrow container, such as a rail's foot: the primary action takes the first row, and the rest share the next. */
  stack?: boolean;
}) {
  return <div className="action-footer" data-note-last={noteLastWhenShort || undefined}>
    {note !== undefined && <div className="action-footer-note">{note}</div>}
    {problem !== undefined && <p className="action-footer-problem" role="alert"><CircleAlertIcon className="action-footer-problem-mark" aria-hidden />{problem}</p>}
    {input ?? (actions.length > 0 && <div className="action-footer-controls" data-stack={stack || undefined}>{actions.map((action) => <button type="button" className="action-footer-button" key={action.label}
      data-tone={action.tone} disabled={action.disabled} onClick={action.onPress}>{action.label}</button>)}</div>)}
  </div>;
}
