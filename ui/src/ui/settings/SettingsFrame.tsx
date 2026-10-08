import { useContext, type ReactNode } from "react";
import { SessionFrameLeading } from "../SessionFrame";

/**
 * System template: a settings page in the thread's place. The same header as a
 * session, so opening settings changes what the column holds, not the app.
 * A notice is pending state, such as a needed restart. It stays under the
 * header, where scrolling cannot take it away.
 */
export function SettingsFrame({ back, title, status, actions, error, recovery, notice, children }: {
  back?: ReactNode; title: string; status?: string | undefined; actions?: ReactNode;
  error?: string | undefined; recovery?: ReactNode; notice?: ReactNode; children: ReactNode;
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
    {notice ? <div className="notice" data-tone="pending" role="status">{notice}</div> : null}
    <div className="settings-scroll"><div className="settings-column">{children}</div></div>
  </main>;
}
