import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useDictation } from "../DictationProvider";
import { PuzzleIcon } from "lucide-react";
import type { PendingDialog } from "../contracts";
import { dialogCountdown, dialogInputProblem, type DialogPhase } from "../dialog";
import type { ChatDraft } from "../chatDraft";

/** What the binding hands the composer: the oldest open extension dialog. */
export interface DialogBinding {
  dialog: PendingDialog;
  /** How many dialogs are open, this one included. */
  count: number;
  phase: DialogPhase;
  /** Visible, but nothing can be sent. */
  offline: boolean;
  onAnswer: (value: boolean | string) => void;
  onCancel: () => void;
}
export type DialogControl = NonNullable<ReturnType<typeof useDialogMode>>;

/** A clock for countdowns. It ticks only while something shows a deadline. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Dialog mode of the one composer. A confirm or select dialog adds its choices
 * above the input, and the input stays the chat input. An input dialog takes
 * the input for its answer, and the chat draft waits until it closes, as with
 * `ask_user`.
 */
export function useDialogMode(binding: DialogBinding | undefined, chatDraft: ChatDraft, input: RefObject<HTMLTextAreaElement | null>) {
  const text = useAuiState((s) => s.composer.text);
  const dictating = useAuiState((s) => s.composer.dictation != null);
  const headingId = useId();
  const inputId = binding?.dialog.kind === "input" ? binding.dialog.dialogId : undefined;
  const aui = useAui();
  const { cancel } = useDictation();
  // Speech belongs to the input it started in. When a dialog takes the input
  // or gives it back, capture and transcription in flight are dropped.
  useLayoutEffect(() => {
    cancel();
    aui.composer.stopDictation();
  }, [inputId, cancel, aui]);
  // Park the chat draft while an input dialog holds the input. A new dialog starts blank.
  useLayoutEffect(() => {
    if (inputId === undefined) return;
    chatDraft.setAsk(`dialog:${inputId}`);
    return () => chatDraft.setAsk(undefined);
  }, [inputId, chatDraft]);
  const now = useNow(binding?.dialog.timeoutAt !== undefined);
  // A tapped choice must not pull a touch keyboard up. Focus returns to the
  // input only when the reader was typing there when the press began.
  const wasTyping = useRef(false);
  if (!binding) return undefined;
  const { dialog, phase, offline } = binding;
  const sending = phase.type === "sending";
  const isInput = dialog.kind === "input";
  const problem = isInput ? dialogInputProblem(text) : undefined;
  const blocked = sending || offline;
  const notePress = () => { wasTyping.current = document.activeElement === input.current; };
  const keepFocus = () => { if (wasTyping.current || isInput) input.current?.focus({ preventScroll: true }); wasTyping.current = false; };
  function answer(value: boolean | string) {
    if (blocked) return;
    binding!.onAnswer(value);
    keepFocus();
  }
  function submitInput() {
    if (!isInput || blocked || dictating || problem) return;
    answer(text);
  }
  function skip() {
    if (blocked) return;
    binding!.onCancel();
    keepFocus();
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, shiftKey = event.shiftKey) {
    if (!isInput || event.key !== "Enter" || shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitInput();
  }
  return {
    dialog, count: binding.count, phase, sending, blocked, isInput, headingId,
    countdown: dialogCountdown(dialog.timeoutAt, now),
    error: problem ?? (phase.type === "failed" ? phase.message : undefined),
    inputBlocked: blocked || dictating || problem !== undefined,
    placeholder: dialog.placeholder || "Type your answer",
    answer, submitInput, skip, onKeyDown, notePress,
  };
}

/**
 * Shape: an extension's question on top of the input bar, in the ask layer's
 * form. The extension waits until the user answers or skips.
 */
export function DialogLayer({ control }: { control: DialogControl }) {
  const { dialog } = control;
  return <section className="ask dialog-layer" aria-label="Question from an extension" aria-busy={control.sending}
    aria-describedby={control.headingId} data-kind={dialog.kind} onPointerDownCapture={control.notePress}>
    <div className="ask-head dialog-head">
      <span className="dialog-source"><PuzzleIcon aria-hidden size={14} />Extension</span>
      {control.countdown && <span className="dialog-countdown" title={control.countdown}>{control.countdown}</span>}
      {control.count > 1 && <span className="ask-count" aria-label={`1 of ${control.count} open questions`}>1 of {control.count}</span>}
      <button type="button" className="ask-skip" disabled={control.blocked} onClick={control.skip}
        title="Close without answering. The extension sees a cancel.">Skip</button>
    </div>
    <div className="ask-body">
      <h2 className="ask-question" id={control.headingId}>{dialog.title}</h2>
      {dialog.message && <p className="ask-detail">{dialog.message}</p>}
      {dialog.kind === "unknown" && <p className="ask-detail">This client cannot show this kind of question. Skip it, or answer it in the old client.</p>}
      {dialog.kind === "select" && <div className="dialog-options" role="group" aria-labelledby={control.headingId}>
        {(dialog.options ?? []).map((option) => <button key={option} type="button" className="dialog-option" disabled={control.blocked}
          onClick={() => control.answer(option)}>{option}</button>)}
        {(dialog.options ?? []).length === 0 && <p className="ask-detail">The extension offered no choices. Skip to continue.</p>}
      </div>}
    </div>
    {/* Outside the scrolling body, so a long message never hides the answer. */}
    {dialog.kind === "confirm" && <div className="dialog-confirm" role="group" aria-labelledby={control.headingId}>
      <button type="button" className="dialog-no" disabled={control.blocked} onClick={() => control.answer(false)}>No</button>
      <button type="button" className="primary dialog-yes" disabled={control.blocked} onClick={() => control.answer(true)}>Yes</button>
    </div>}
    {control.error && <p className="ask-error" role="alert">{control.error}</p>}
  </section>;
}
