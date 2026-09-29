import type { ReactNode } from "react";

// System template: the binding supplies labels and actions, never transport objects.
export function SessionFrame({ name, status, error, recovery, children }: {
  name: string;
  status: string;
  error?: string;
  recovery?: ReactNode;
  children: ReactNode;
}) {
  return <main className="session-shell">
    <header className="session-header">
      <div className="session-heading"><span className="product-name">Forgerie</span>
        <h1 className="session-title" title={name}>{name}</h1>
      </div>
      <span className="connection-status" role="status">{status}</span>
    </header>
    {error && <div className="notice" role="alert"><p>{error}</p>{recovery}</div>}
    {children}
  </main>;
}
