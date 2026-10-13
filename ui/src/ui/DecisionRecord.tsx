import { useEffect, useRef } from "react";
import { FlagIcon } from "lucide-react";
import { TextButton } from "./TextButton";
import "./DecisionRecord.css";

/**
 * Molecule: one decision that was made without the reader, as a row of a log.
 * A line says who decided and when; the question follows, then the choice and
 * its reason on one rule. A flag in the margin marks a record the reader may
 * want to look at, so a column of flags can be scanned down the list. A choice
 * that no longer stands is struck through, and the correction that replaced
 * it sits under it on a strong rule. One quiet action sits at the end of the
 * first line; pressed, it says so, and the record keeps itself in view while
 * what the action opened (such as a footer) takes room from the list.
 */
export function DecisionRecord({ subject, phrase, time, timeTitle, status, question, choice, reason, flag, correction, action }: {
  /** Who decided, in the code face. */
  subject: string;
  /** What they did, after the name. */
  phrase: string;
  /** How long ago, in shorthand. */
  time?: string | undefined;
  /** The full time, as hover text. */
  timeTitle?: string | undefined;
  /** One word after the phrase, such as the record's state. */
  status?: string | undefined;
  question: string;
  choice: string;
  reason?: string | undefined;
  /** Marks the record for the reader, with this as the mark's name. */
  flag?: string | undefined;
  /** The choice no longer stands: what replaced it, who said so, and when. */
  correction?: { label: string; text: string; time?: string | undefined } | undefined;
  action?: { label: string; onPress: () => void; pressed?: boolean | undefined; disabled?: boolean | undefined } | undefined;
}) {
  const struck = correction !== undefined;
  const row = useRef<HTMLLIElement>(null);
  const pressed = action?.pressed === true;
  // After the frame that lays out what the press opened, and after a sheet that opens with it pressed has shown.
  useEffect(() => {
    if (!pressed) return;
    const frame = requestAnimationFrame(() => row.current?.scrollIntoView?.({ block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [pressed]);
  return <li ref={row} className="decision-record" data-flagged={flag !== undefined || undefined} data-struck={struck || undefined}>
    {flag !== undefined ? <span className="decision-record-mark" role="img" aria-label={flag} title={flag}><FlagIcon aria-hidden /></span>
      : <span className="decision-record-mark" aria-hidden="true" />}
    <p className="decision-record-head">
      <span className="decision-record-subject">{subject}</span>
      <span className="decision-record-phrase">{phrase}</span>
      {status !== undefined && <span className="decision-record-status">{status}</span>}
      {time !== undefined && <span className="decision-record-time" title={timeTitle}>{time}</span>}
    </p>
    {action !== undefined && <span className="decision-record-end">
      <TextButton label={action.label} onPress={action.onPress} pressed={action.pressed} disabled={action.disabled} />
    </span>}
    <p className="decision-record-question">{question}</p>
    <div className="decision-record-answer">
      {struck ? <del className="decision-record-choice">{choice}</del> : <p className="decision-record-choice">{choice}</p>}
      {reason !== undefined && reason.trim() !== "" && <p className="decision-record-reason">{reason}</p>}
    </div>
    {correction !== undefined && <p className="decision-record-correction">
      <span className="decision-record-correction-head">
        <span className="decision-record-subject">{correction.label}</span>
        {correction.time !== undefined && <span className="decision-record-time">{correction.time}</span>}
      </span>
      <span className="decision-record-correction-text">{correction.text}</span>
    </p>}
  </li>;
}
