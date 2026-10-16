import { useCallback, useId, useState } from "react";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { StateMark, type WorkState } from "./StateMark";
import "./JobList.css";

export interface JobListItem {
  id: string;
  name: string;
  state: WorkState;
  /** The state in words, for a screen reader; the mark shows it. */
  stateText: string;
  url: string;
  /** How long it ran, as text. Absent before it starts. */
  time?: string | undefined;
  /** Its run time as a share of the longest one, 0 to 1. Drawn as a ribbon under the row. */
  share?: number | undefined;
  /** Output to read in place, such as error annotations. */
  log?: string | undefined;
}

/**
 * Molecule: the jobs of one build. Each row has a state mark, a name, and
 * its time, over a thin ribbon as long as its share of the longest job, so
 * the slow one shows at a glance. A row with output opens it in place,
 * scrolled to its end where the error usually is; a row without opens the
 * job elsewhere. Rows in the `fold` states gather into one row the reader
 * can open. The first failure with output opens by itself.
 */
export function JobList({ label, jobs, empty, linkText, logLabel, fold }: {
  label: string;
  jobs: readonly JobListItem[];
  /** Shown instead of rows when there are none. */
  empty: string;
  /** The link under opened output, to the whole job. */
  linkText: string;
  /** The accessible name of an opened output. */
  logLabel: string;
  /** States that carry no task, folded into one row with these words. */
  fold?: { states: readonly WorkState[]; closed: string; open: string } | undefined;
}) {
  const id = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(jobs.filter((job) => job.state === "failed" && job.log).slice(0, 1).map((job) => job.id)));
  const [unfolded, setUnfolded] = useState(false);
  const toggle = (key: string) => setOpen((current) => { const next = new Set(current); if (!next.delete(key)) next.add(key); return next; });
  // Opened once at its end; after that the reader's scroll stays.
  const toEnd = useCallback((element: HTMLPreElement | null) => { if (element) element.scrollTop = element.scrollHeight; }, []);
  const foldable = fold ? jobs.filter((job) => fold.states.includes(job.state)) : [];
  const shown = fold && !unfolded && foldable.length > 1 ? jobs.filter((job) => !fold.states.includes(job.state)) : jobs;
  if (jobs.length === 0) return <p className="job-list-empty">{empty}</p>;
  return <ul className="job-list" aria-label={label}>
    {shown.map((job) => {
      const opened = open.has(job.id) && job.log !== undefined;
      const line = <>
        <StateMark state={job.state} />
        <span className="job-list-name"><span className="job-list-hidden">{job.stateText}: </span>{job.name}</span>
        {job.time ? <span className="job-list-time">{job.time}</span> : null}
      </>;
      const share = String(Math.min(1, Math.max(0, job.share ?? 0)));
      return <li key={job.id} className="job-list-item" data-state={job.state}>
        {job.log !== undefined
          ? <button type="button" className="job-list-line" style={{ "--job-list-share": share }} aria-expanded={opened} aria-controls={`${id}-${job.id}`} onClick={() => toggle(job.id)}>
            {line}<ChevronRightIcon aria-hidden className="job-list-go" /></button>
          : <a className="job-list-line" style={{ "--job-list-share": share }} href={job.url} target="_blank" rel="noreferrer">{line}<ExternalLinkIcon aria-hidden className="job-list-go" /></a>}
        {opened ? <div className="job-list-log" id={`${id}-${job.id}`}>
          <pre ref={toEnd} tabIndex={0} role="region" aria-label={`${logLabel}: ${job.name}`}>{job.log}</pre>
          <a href={job.url} target="_blank" rel="noreferrer">{linkText}<ExternalLinkIcon aria-hidden /></a>
        </div> : null}
      </li>;
    })}
    {fold && foldable.length > 1 ? <li className="job-list-item">
      <button type="button" className="job-list-line job-list-fold" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>
        <StateMark state={foldable[0]!.state} />
        <span className="job-list-name">{unfolded ? fold.open : fold.closed}</span>
        <ChevronRightIcon aria-hidden className="job-list-go" />
      </button>
    </li> : null}
  </ul>;
}
