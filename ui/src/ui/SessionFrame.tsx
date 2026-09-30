import { createContext, useContext, type ReactNode } from "react";

/**
 * The shell puts its picker opener here when the picker is not docked. The
 * frame draws it first in the header, so the thread never carries a floating
 * control over its own title.
 */
export const SessionFrameLeading = createContext<ReactNode>(null);

// System template: the binding supplies labels and actions, never transport objects.
export function SessionFrame({ name, status, error, recovery, children }: {
  name: string;
  status: string;
  error?: string;
  recovery?: ReactNode;
  children: ReactNode;
}) {
  const leading = useContext(SessionFrameLeading);
  return <main className="session-shell">
    <header className="session-header">
      {leading}
      <div className="session-heading"><span className="product-name">Forgerie</span>
        <h1 className="session-title" title={name}>{name}</h1>
      </div>
      <span className="connection-status" role="status">{status}</span>
    </header>
    {error && <div className="notice" role="alert"><p>{error}</p>{recovery}</div>}
    {children}
  </main>;
}
