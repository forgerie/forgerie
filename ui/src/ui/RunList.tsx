import { useId, type ReactNode } from "react";
import "./RunList.css";

export interface RunListRow { key: string; node: ReactNode }

/**
 * Organism: a titled list of builds in a pane that scrolls around it. A
 * heading with a count; one alert, with its retry, above the rows; skeleton
 * rows shaped like real ones before the first read; an empty text; and a
 * foot, such as a field to add one, that stays under the rows in every state.
 * A reread keeps the rows on show and marks the list busy.
 */
export function RunList({ title, count, rows, loading = false, busy = false, alert, empty, foot }: {
  title: string;
  count?: string | undefined;
  rows: readonly RunListRow[];
  /** Nothing read yet: skeleton rows. */
  loading?: boolean;
  /** A newer read is on its way; the rows are the last one. */
  busy?: boolean;
  alert?: { text: ReactNode; action?: { label: string; onPress: () => void } | undefined } | undefined;
  /** Shown instead of rows when there are none. */
  empty?: ReactNode;
  foot?: ReactNode;
}) {
  const headId = useId();
  return <section className="run-list" aria-labelledby={headId} aria-busy={loading || busy || undefined}>
    <div className="run-list-head">
      <h3 id={headId}>{title}</h3>
      {count ? <span className="run-list-count">{count}</span> : null}
      {busy ? <span className="run-list-busy" aria-hidden /> : null}
    </div>
    {alert ? <div className="run-list-alert" role="alert">
      <div className="run-list-alert-text">{alert.text}</div>
      {alert.action ? <button type="button" className="run-list-alert-action" onClick={alert.action.onPress}>{alert.action.label}</button> : null}
    </div> : null}
    {loading && rows.length === 0 ? <div className="run-list-skeleton" aria-hidden>
      {[0.62, 0.48, 0.7].map((share) => <span key={share} className="run-list-ghost" style={{ "--run-list-ghost": String(share) }}><b /><i /><i /></span>)}
    </div> : rows.length === 0 ? (empty ? <div className="run-list-empty">{empty}</div> : null)
    : <ul className="run-list-rows">{rows.map((row) => <li key={row.key}>{row.node}</li>)}</ul>}
    {foot ? <div className="run-list-foot">{foot}</div> : null}
  </section>;
}
