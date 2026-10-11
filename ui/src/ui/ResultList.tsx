import type { KeyboardEvent, ReactNode, Ref } from "react";
import "./ResultList.css";

export interface ResultListRow { key: string; node: ReactNode }

/**
 * Molecule: the answers to a search, as a list that scrolls in the room it
 * gets. Above the rows, a progress line while the answers are still being
 * gathered and an inline failure with its retry. Skeleton rows stand in
 * before the first answer; later answers keep the old rows under a busy
 * mark. A foot control loads the next rows. Arrow keys move between rows.
 */
export function ResultList({ label, rows, loading = false, busy = false, progress, alert, empty, more, rootRef }: {
  label: string;
  rows: readonly ResultListRow[];
  /** No answer yet: skeleton rows. */
  loading?: boolean;
  /** A newer answer is on its way; the rows shown are the last one. */
  busy?: boolean;
  /** The answers are still being gathered. `value` of `max` drives a thin meter. */
  progress?: { text: string; value: number; max: number } | undefined;
  alert?: { text: string; action?: { label: string; onPress: () => void } | undefined } | undefined;
  /** Shown instead of the rows when there are none. */
  empty?: ReactNode;
  more?: { label: string; onPress: () => void; busy?: boolean | undefined; note?: string | undefined } | undefined;
  rootRef?: Ref<HTMLDivElement> | undefined;
}) {
  const share = progress && progress.max > 0 ? Math.min(1, Math.max(0, progress.value / progress.max)) : 0;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const targets = [...event.currentTarget.querySelectorAll<HTMLElement>(".result-list-row > button, .result-list-row > a, .result-list-more")];
    const index = targets.findIndex((target) => target === document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    targets[Math.min(Math.max(index + (event.key === "ArrowDown" ? 1 : -1), 0), targets.length - 1)]?.focus();
  };
  return <div ref={rootRef} className="result-list" role="region" aria-label={label} aria-busy={loading || busy || undefined} onKeyDown={onKeyDown}>
    {busy ? <span className="result-list-busy" aria-hidden="true" /> : null}
    {progress ? <div className="result-list-progress">
      <p className="result-list-progress-text" role="status">{progress.text}</p>
      <span className="result-list-meter" role="progressbar" aria-label={progress.text} aria-valuemin={0} aria-valuemax={progress.max}
        aria-valuenow={progress.value} style={{ "--result-list-share": String(share) }} />
    </div> : null}
    {alert ? <div className="result-list-alert" role="alert">
      <p className="result-list-alert-text">{alert.text}</p>
      {alert.action ? <button type="button" className="result-list-alert-action" onClick={alert.action.onPress}>{alert.action.label}</button> : null}
    </div> : null}
    {loading && rows.length === 0 ? <div className="result-list-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => <span key={index} className="result-list-ghost"><i /><i /><i /></span>)}
    </div> : rows.length === 0 && empty ? <div className="result-list-empty">{empty}</div>
    : <ul className="result-list-rows">
      {rows.map((row) => <li key={row.key} className="result-list-row">{row.node}</li>)}
    </ul>}
    {more && rows.length > 0 ? <div className="result-list-foot">
      {more.note ? <p className="result-list-foot-note" role="status">{more.note}</p> : null}
      <button type="button" className="result-list-more" disabled={more.busy} aria-busy={more.busy || undefined} onClick={more.onPress}>{more.label}</button>
    </div> : null}
  </div>;
}
