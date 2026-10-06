import { useContext, type ReactNode } from "react";
import { SessionFrameLeading } from "../SessionFrame";

/**
 * System template: a settings page in the thread's place. The same header as a
 * session, so opening settings changes what the column holds, not the app.
 */
export function SettingsFrame({ back, title, status, actions, error, recovery, children }: {
  back?: ReactNode; title: string; status?: string | undefined; actions?: ReactNode;
  error?: string | undefined; recovery?: ReactNode; children: ReactNode;
}) {
  const leading = useContext(SessionFrameLeading);
  return <main className="session-shell settings-shell">
    <header className="session-header">
      {leading}
      {back}
      <div className="session-heading"><h1 className="session-title" title={title}>{title}</h1></div>
      {status ? <span className="connection-status" role="status">{status}</span> : null}
      {actions}
    </header>
    {error ? <div className="notice" role="alert"><p>{error}</p>{recovery}</div> : null}
    <div className="settings-scroll"><div className="settings-column">{children}</div></div>
  </main>;
}
