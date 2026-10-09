import type { ReactNode } from "react";
import "./EventLine.css";

export type EventTone = "positive" | "negative" | "active" | "neutral";

export interface EventFact { label: string; value: string }

/**
 * Molecule: one quiet line in a conversation that reports something that
 * happened, not something someone said. A tone dot, a monospace subject, a
 * phrase, and a time. A quoted line, when given, stays visible under it.
 * Facts and code open on request.
 */
export function EventLine({ tone, hollow = false, subject, phrase, time, quote, quoteFace = "code", facts = [], code, codeLabel, detail }: {
  tone: EventTone;
  /** Draws the dot as a ring: the thing ended without a verdict. */
  hollow?: boolean;
  subject: string;
  phrase: string;
  time?: string | undefined;
  /** The one line of evidence the reader should see without opening anything. */
  quote?: ReactNode;
  /** The quote's face: a line of output in the code face, or a person's words in the text face. */
  quoteFace?: "code" | "text";
  facts?: readonly EventFact[];
  code?: string | undefined;
  codeLabel?: string | undefined;
  /** Prose that opens under the line, such as the full text the quote begins. */
  detail?: ReactNode;
}) {
  const line = <>
    <span className="event-line-dot" aria-hidden="true" />
    <span className="event-line-subject">{subject}</span>
    <span className="event-line-phrase">{phrase}</span>
    {time && <span className="event-line-time">{time}</span>}
  </>;
  const openable = facts.length > 0 || code !== undefined || detail !== undefined;
  return <div className="event-line" data-tone={tone} data-hollow={hollow || undefined}>
    {openable ? <details>
      <summary className="event-line-row">{line}</summary>
      <div className="event-line-body">
        {detail !== undefined && <div className="event-line-detail">{detail}</div>}
        {code !== undefined && <pre className="event-line-code" tabIndex={0} aria-label={codeLabel}>{code}</pre>}
        {facts.length > 0 && <dl className="event-line-facts">
          {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>}
      </div>
    </details> : <div className="event-line-row">{line}</div>}
    {quote !== undefined && <p className="event-line-quote" data-face={quoteFace}>{quote}</p>}
  </div>;
}
