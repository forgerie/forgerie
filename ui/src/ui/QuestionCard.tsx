import type { ReactNode } from "react";
import { ReplyBox } from "./ReplyBox";
import "./QuestionCard.css";

/**
 * Molecule: a question that waits on the reader, in the flow of a
 * conversation. Who asks, the question, and a reply box while it is open;
 * once answered, the answer in place of the box. A link can open the asker.
 */
export function QuestionCard({ asker, question, answer, replyLabel, placeholder, sendLabel, onAnswer, link }: {
  asker: string;
  question: ReactNode;
  /** The given answer. Undefined while the question is open. */
  answer?: string | undefined;
  replyLabel: string;
  placeholder: string;
  sendLabel: string;
  onAnswer?: ((text: string) => Promise<void>) | undefined;
  link?: { label: string; onPress: () => void } | undefined;
}) {
  const open = answer === undefined;
  return <section className="question-card" data-open={open || undefined} aria-label={`${asker} asks`}>
    <header className="question-card-head">
      <span className="question-card-dot" aria-hidden />
      <span className="question-card-asker">{asker}</span>
      {link && <button type="button" className="question-card-link" onClick={link.onPress}>{link.label}</button>}
    </header>
    <div className="question-card-question">{question}</div>
    {open ? onAnswer && <ReplyBox label={replyLabel} placeholder={placeholder} sendLabel={sendLabel} onSend={onAnswer} />
      : <p className="question-card-answer">{answer}</p>}
  </section>;
}
