import type { ReactNode } from "react";
import { ChevronRightIcon, ExternalLinkIcon } from "lucide-react";
import { StateMark, type WorkState } from "./StateMark";
import "./RunRow.css";

/** A short identifier beside the title: a branch, a commit, an attempt. `code` sets it in the code face. */
export interface RunRowFact { text: string; label: string; code?: boolean }

/**
 * Molecule: one build in a list. Its press target holds a state mark, the
 * pipeline's name and the build's title on one line with its age at the end,
 * then the state in words and a few short facts. Its controls stand outside
 * the press target; when the row is narrow they drop under the text rather
 * than squeeze it. A note and a problem, when given, take the full width
 * under both, so the row keeps its place in the list when it cannot be read.
 */
export function RunRow({ state, stateText, name, title, facts = [], age, ageLabel, open, controls, note, problem, busy = false }: {
  state: WorkState;
  /** The state in words, coloured like the mark. */
  stateText: string;
  name: string;
  title?: string | undefined;
  facts?: readonly RunRowFact[];
  age?: string | undefined;
  /** The full time the age stands for, for hover and a screen reader. */
  ageLabel?: string | undefined;
  /** What a press does: open its detail here, or go to it in a new tab. The label is the hover text; the row's words are its name. */
  open: { label: string; onPress: () => void } | { label: string; href: string };
  controls?: ReactNode;
  /** A quiet sentence under the row, such as what keeps an eye on it. */
  note?: string | undefined;
  /** Why the row cannot show everything. `warn` for something the reader can fix elsewhere. */
  problem?: { tone: "bad" | "warn"; content: ReactNode } | undefined;
  /** A newer read is on its way; the row shows the last one. */
  busy?: boolean;
}) {
  const body = <>
    <span className="run-row-mark"><StateMark state={state} /></span>
    <span className="run-row-head">
      <span className="run-row-name">{name}</span>
      {title ? <span className="run-row-title">{title}</span> : null}
    </span>
    {age ? <span className="run-row-age" title={ageLabel}>{age}</span> : null}
    {"href" in open ? <ExternalLinkIcon aria-hidden className="run-row-go" /> : <ChevronRightIcon aria-hidden className="run-row-go" />}
    <span className="run-row-facts">
      <span className="run-row-state">{stateText}</span>
      {facts.map((fact) => <span key={fact.label} className="run-row-fact" data-face={fact.code ? "code" : undefined} title={fact.label}>{fact.text}</span>)}
    </span>
  </>;
  return <div className="run-row" data-state={state} aria-busy={busy || undefined}>
    {"href" in open
      ? <a className="run-row-main" href={open.href} target="_blank" rel="noreferrer" title={open.label}>{body}</a>
      : <button type="button" className="run-row-main" title={open.label} onClick={open.onPress}>{body}</button>}
    {controls ? <div className="run-row-controls">{controls}</div> : null}
    {note ? <p className="run-row-note">{note}</p> : null}
    {problem ? <div className="run-row-problem" data-tone={problem.tone} role="alert">{problem.content}</div> : null}
  </div>;
}
