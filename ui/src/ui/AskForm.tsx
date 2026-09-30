import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeftIcon } from "lucide-react";
import type { AskPhase } from "../ask";
import type { AskAnswer, AskQuestion, PendingAsk } from "../contracts";
import { chooseOther, draftOf, isAnswered, OTHER_TEXT_MAX_LENGTH, pickOption, toAnswers, writeOther, type AskDrafts, type QuestionDraft } from "../askDraft";

/**
 * System organism that stands in for the composer while the agent waits for
 * answers. One question at a time, so the form fits a short pane. Answers live
 * here until sent; the parent keys the form by ask ID so a new ask starts blank.
 */
export function AskForm({ ask, phase, offline, onSubmit, onDismiss }: {
  ask: PendingAsk;
  phase: AskPhase;
  /** Inputs stay editable, but nothing can be sent. */
  offline: boolean;
  onSubmit: (answers: AskAnswer[]) => void;
  onDismiss: () => void;
}) {
  const [drafts, setDrafts] = useState<AskDrafts>({});
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const headingId = useId();
  const count = ask.questions.length;
  const question = ask.questions[Math.min(index, count - 1)];
  const last = index >= count - 1;
  const sending = phase.type === "sending";
  const blocked = sending || offline;

  useEffect(() => {
    // Focus lost with the composer (or moved by Back and Next) lands on the question.
    if (moved.current || document.activeElement === document.body) heading.current?.focus({ preventScroll: true });
    moved.current = false;
  }, [index]);

  const go = (next: number) => { moved.current = true; setIndex(next); };
  const update = (item: AskQuestion, change: (draft: QuestionDraft) => QuestionDraft) =>
    setDrafts((current) => ({ ...current, [item.id]: change(draftOf(current, item)) }));
  const advance = () => {
    if (!last) go(index + 1);
    else if (!blocked) onSubmit(toAnswers(ask, drafts));
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); advance(); }
  };

  return <section className="ask" aria-label="Questions from the agent" onKeyDown={onKeyDown} aria-busy={sending}>
    {count > 1 && <nav className="ask-rail" aria-label="Questions">
      <ol>
        {ask.questions.map((item, position) => {
          const answered = isAnswered(draftOf(drafts, item));
          return <li key={item.id}>
            <button type="button" className="ask-step" data-answered={answered || undefined}
              aria-current={position === index ? "step" : undefined} onClick={() => go(position)}
              aria-label={`Question ${position + 1}, ${answered ? "answered" : "not answered"}`} />
          </li>;
        })}
      </ol>
      <span className="ask-count" aria-hidden>{index + 1} of {count}</span>
    </nav>}
    {question && <div className="ask-body">
      <h2 className="ask-question" id={headingId} ref={heading} tabIndex={-1}>{question.question}</h2>
      {question.detail && <p className="ask-detail">{question.detail}</p>}
      <QuestionInputs key={question.id} question={question} draft={draftOf(drafts, question)} labelledBy={headingId}
        disabled={sending} onChange={(change) => update(question, change)} />
    </div>}
    {phase.type === "answering" && phase.error && <p className="ask-error" role="alert">{phase.error}</p>}
    <div className="ask-actions">
      <button type="button" className="ask-skip" disabled={blocked} onClick={onDismiss}
        title="Close these questions without answering them">
        {sending && phase.action === "dismiss" ? "Skipping…" : "Skip"}
      </button>
      {index > 0 && <button type="button" className="icon-button quiet-button" aria-label="Previous question"
        title="Previous question" disabled={sending} onClick={() => go(index - 1)}>
        <ChevronLeftIcon aria-hidden size={18} />
      </button>}
      <button type="button" className="primary ask-primary" disabled={last && blocked} onClick={advance}>
        {!last ? "Next" : sending && phase.action === "submit" ? "Sending…" : count > 1 ? "Send answers" : "Send answer"}
      </button>
    </div>
  </section>;
}

/** Choices plus a free-text answer. A question without options is free text only. */
function QuestionInputs({ question, draft, labelledBy, disabled, onChange }: {
  question: AskQuestion;
  draft: QuestionDraft;
  labelledBy: string;
  disabled: boolean;
  onChange: (change: (draft: QuestionDraft) => QuestionDraft) => void;
}) {
  const type = question.multiple ? "checkbox" : "radio";
  const name = useId();
  const freeTextOnly = question.options.length === 0;
  return <div className="ask-options" role="group" aria-labelledby={labelledBy} data-kind={type}>
    {question.options.map((option) => <label key={option.value} className="ask-option">
      <input type={type} name={name} checked={draft.values.includes(option.value)} disabled={disabled}
        onChange={() => onChange((current) => pickOption(question, current, option.value))} />
      <span className="ask-option-text">
        <span className="ask-option-label">{option.label}</span>
        {option.detail && <span className="ask-option-detail">{option.detail}</span>}
      </span>
    </label>)}
    <div className="ask-option ask-other" data-free={freeTextOnly || undefined}>
      {!freeTextOnly && <input type={type} name={name} checked={draft.otherChosen} disabled={disabled}
        aria-label="Use your own answer"
        onChange={(event) => onChange((current) => chooseOther(question, current, event.target.checked))} />}
      <textarea className="ask-other-input" rows={1} value={draft.other} maxLength={OTHER_TEXT_MAX_LENGTH}
        disabled={disabled} aria-label={freeTextOnly ? "Your answer" : "Your own answer"}
        placeholder={freeTextOnly ? "Type your answer" : "Something else"}
        onChange={(event) => { const text = event.target.value; onChange((current) => writeOther(question, current, text)); }} />
    </div>
  </div>;
}
