import { createContext, useContext, type ReactNode } from "react";

/**
 * The shell puts its picker opener here when the picker is not docked. The
 * frame draws it first in the header, so the thread never carries a floating
 * control over its own title.
 */
export const SessionFrameLeading = createContext<ReactNode>(null);

/**
 * System template: a thread's page. The header names it, then shows its status
 * (a `StatusChip`) and its controls. Nothing is drawn between the header and
 * the thread: a status with more to say opens from the chip, so the
 * conversation keeps its full height.
 */
export function SessionFrame({ name, status, actions, children }: {
  name: string;
  status?: ReactNode;
  /** Session-level controls, drawn at the trailing end of the header. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const leading = useContext(SessionFrameLeading);
  return <main className="session-shell">
    <header className="session-header">
      {leading}
      {/* The homepage thread header names the thread only; the product name
          lives in the picker header, as it does in the homepage sidebar. */}
      <div className="session-heading"><h1 className="session-title" title={name}>{name}</h1></div>
      {status}
      {actions}
    </header>
    {children}
  </main>;
}
