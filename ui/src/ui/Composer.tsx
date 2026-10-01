// Adapted from assistant-ui's homepage demo. See THIRD_PARTY_NOTICES.md.
import { useRef, type KeyboardEvent } from "react";
import { AuiIf, ComposerPrimitive, useAuiState, unstable_useTriggerPopoverRootContext } from "@assistant-ui/react";
import type { MentionSource } from "../mentionSource";
import { MentionPopover, type MentionInputSnapshot } from "./MentionPopover";
import { ArrowUpIcon, ChevronLeftIcon, CornerDownLeftIcon, InfoIcon, SquareIcon } from "lucide-react";
import { OTHER_TEXT_MAX_LENGTH } from "../askDraft";
import { useDictation } from "../DictationProvider";
import { ComposerDictation } from "./ComposerDictation";
import { useAskMode, type AskBinding, type AskControl } from "./useAskMode";
import { SlashCommands, type CommandBinding } from "./SlashCommands";

/**
 * System molecule: the one input bar. While an ask is open it gains a question
 * layer on top, and its own input answers the current question. There is never
 * a second input. Input capabilities belong to this bar in both modes.
 */
type ComposerProps = { ask?: AskBinding; mentions?: MentionSource | undefined; commands?: CommandBinding };
export function Composer(props: ComposerProps) {
  return <ComposerPrimitive.Unstable_TriggerPopoverRoot><ComposerBar {...props} /></ComposerPrimitive.Unstable_TriggerPopoverRoot>;
}
function ComposerBar({ ask, mentions, commands }: ComposerProps) {
  const disabled = useAuiState((s) => s.thread.isDisabled);
  const dictating = useAuiState((s) => s.composer.dictation != null);
  const { state } = useDictation();
  const control = useAskMode(ask);
  const anchor = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const snapshot = useRef<MentionInputSnapshot>(null);
  const rememberInput = () => { if (input.current) snapshot.current = { text: input.current.value, cursor: input.current.selectionStart }; };
  const triggers = unstable_useTriggerPopoverRootContext();
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    rememberInput();
    // Input's custom handler runs before SDK plugins. Trigger selection consumes
    // Enter before ask mode can advance or submit the current question.
    for (const trigger of triggers.getTriggers().values()) {
      if (trigger.resource.handleKeyDown(event)) return;
    }
    control?.onKeyDown(event);
  }
  const scopeKey = `${mentions?.key}:${control?.ask.askId ?? "chat"}:${control?.question.id ?? ""}`;
  return <ComposerPrimitive.Root className="composer">
    <div ref={anchor} className="composer-shell" data-mode={control ? "ask" : "chat"}>
      {control && <AskQuestions control={control} />}
      {control?.route === "chat" && <p className="ask-route" role="status">
        <InfoIcon aria-hidden size={14} />Commands run in Pi. Questions stay open unless Pi closes them.
      </p>}
      {control?.error && <p className="ask-error" role="alert">{control.error}</p>}
      {state.type === "failed" && <p className="ask-error" role="alert">{state.message}</p>}
      <ComposerPrimitive.Input ref={input} aria-label="Message" rows={1} className="composer-input"
        placeholder={control?.placeholder ?? "Send a message..."}
        aria-describedby={control?.headingId}
        enterKeyHint={control && !control.last && control.route === "answer" ? "next" : "send"}
        maxLength={control ? OTHER_TEXT_MAX_LENGTH : undefined}
        submitMode={control ? "none" : "enter"} onKeyDown={onKeyDown} onChange={rememberInput} onSelect={rememberInput}
        disabled={control?.sending || undefined} />
      <div className="composer-actions">
        <ComposerDictation disabled={disabled || !!control?.sending} />
        {control ? <AskActions control={control} /> : <>
          <AuiIf condition={(s) => !s.thread.isRunning}>
            <ComposerPrimitive.Send disabled={disabled || dictating} className="primary icon-button" aria-label="Send message" title="Send message">
              <ArrowUpIcon aria-hidden size={16} />
            </ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(s) => s.thread.isRunning}>
            <ComposerPrimitive.Cancel disabled={disabled} className="primary icon-button" aria-label="Stop generating" title="Stop generating">
              <SquareIcon aria-hidden size={12} fill="currentColor" />
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </>}
      </div>
    </div>
    {commands && <SlashCommands binding={commands} anchor={anchor} />}
    {mentions && (["@", "!@", "#"] as const).map((char) => <MentionPopover key={`${scopeKey}:${char}`}
      source={mentions} char={char} input={input} snapshot={snapshot} enabled={!disabled && !control?.sending} />)}
  </ComposerPrimitive.Root>;
}

/** The question layer: step row, question, and options. It scrolls inside a height budget. */
function AskQuestions({ control }: { control: AskControl }) {
  const { ask, question, index, count } = control;
  const kind = question.multiple ? "checkbox" : "radio";
  return <section className="ask" aria-label="Questions from the agent" aria-busy={control.sending}
    data-folded={control.route === "chat" || undefined}>
    {/* Like the homepage branch picker (hideWhenSingleBranch), the step row
        appears only when there is more than one question, or when a command
        folds the questions to it. */}
    {(count > 1 || control.route === "chat") && <div className="ask-head">
      {count > 1 && <button type="button" className="icon-button quiet-button" aria-label="Previous question" title="Previous question"
        disabled={index === 0 || control.sending} onClick={() => control.go(index - 1)}>
        <ChevronLeftIcon aria-hidden size={16} />
      </button>}
      {count > 1 && <ol className="ask-rail" aria-label="Questions">
        {ask.questions.map((item, position) => {
          const answered = control.answered(position);
          return <li key={item.id}>
            <button type="button" className="ask-step" data-answered={answered || undefined} disabled={control.sending}
              aria-current={position === index ? "step" : undefined} onClick={() => control.go(position)}
              aria-label={`Question ${position + 1}, ${answered ? "answered" : "not answered"}`} />
          </li>;
        })}
      </ol>}
      <span className="ask-count" aria-hidden>{index + 1} of {count}</span>
    </div>}
    <div className="ask-body">
      <h2 className="ask-question" id={control.headingId}>{question.question}</h2>
      {question.detail && <p className="ask-detail">{question.detail}</p>}
      {question.options.length > 0 && <div className="ask-options" role="group" aria-labelledby={control.headingId} data-kind={kind}>
        {question.options.map((option) => <label key={option.value} className="ask-option">
          <input type={kind} name={`${ask.askId}-${question.id}`} checked={control.values.includes(option.value)}
            disabled={control.sending} onChange={() => control.pick(option.value)} />
          <span className="ask-option-text">
            <span>{option.label}</span>
            {option.detail && <small>{option.detail}</small>}
          </span>
        </label>)}
      </div>}
    </div>
  </section>;
}

function AskActions({ control }: { control: AskControl }) {
  const { phase, route, last, count } = control;
  const sending = (action: "submit" | "dismiss") => phase.type === "sending" && phase.action === action;
  if (route === "chat") {
    return <button type="button" className="primary ask-primary" disabled={control.blocked} onClick={control.primary}>
      Send message<ArrowUpIcon aria-hidden size={16} />
    </button>;
  }
  return <>
    <button type="button" className="ask-skip" disabled={control.blocked} onClick={control.dismiss}
      title="Close these questions without answering them">{sending("dismiss") ? "Skipping…" : "Skip"}</button>
    <button type="button" className="primary ask-primary" disabled={control.blocked} onClick={control.primary}>
      {!last ? <>Next<CornerDownLeftIcon aria-hidden size={14} className="ask-key" /></>
        : sending("submit") ? "Sending…" : count > 1 ? "Send answers" : "Send answer"}
    </button>
  </>;
}
