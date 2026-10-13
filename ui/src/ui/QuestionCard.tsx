import type { ReactNode } from "react";
import { ReplyBox } from "./ReplyBox";
import "./QuestionCard.css";

/**
 * Molecule: a question that waits on the reader, in the flow of a
 * conversation. Who asks, the question, and a reply box while it is open;
 * once answered, the answer in place of the box. A link can open the asker.
 * Context, such as what someone else would answer, sits under the question
 * on a quiet rule while the question is open.
 */
export function QuestionCard({ asker, question, context, answer, replyLabel, placeholder, sendLabel, onAnswer, link, closedReason }: {
  asker: string;
  question: ReactNode;
  /** Help for the answer, shown under the question while it is open. */
  context?: ReactNode;
  /** The given answer. Undefined while the question is open. */
  answer?: string | undefined;
  /** A closed question without an answer, such as a cancelled request. */
  closedReason?: string | undefined;
  /** The reply box's words. Needed only with `onAnswer`. */
  replyLabel?: string;
  placeholder?: string;
  sendLabel?: string;
  /** Absent: the card shows the open question without a box, because the answer is given elsewhere. */
  onAnswer?: ((text: string) => Promise<void>) | undefined;
  link?: { label: string; onPress: () => void } | undefined;
}) {
  const open = answer === undefined && closedReason === undefined;
  return <section className="question-card" data-open={open || undefined} aria-label={`${asker} asks`}>
    <header className="question-card-head">
      <span className="question-card-dot" aria-hidden />
      <span className="question-card-asker">{asker}</span>
      {link && <button type="button" className="question-card-link" onClick={link.onPress}>{link.label}</button>}
    </header>
    <div className="question-card-question">{question}</div>
    {open && context !== undefined && <div className="question-card-context">{context}</div>}
    {open ? onAnswer && <ReplyBox label={replyLabel ?? `Answer ${asker}`} placeholder={placeholder ?? ""} sendLabel={sendLabel ?? "Send"} onSend={onAnswer} />
      : <p className="question-card-answer">{answer ?? closedReason}</p>}
  </section>;
}
