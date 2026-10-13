import type { ReactNode } from "react";
import "./ReadoutLine.css";

/**
 * Molecule: one sentence about the state of something, with the action that
 * changes it at the line's end. The action wraps under the sentence before the
 * sentence gives up words.
 */
export function ReadoutLine({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <p className="readout-line"><span className="readout-line-text">{children}</span>
    {action ? <span className="readout-line-action">{action}</span> : null}</p>;
}
