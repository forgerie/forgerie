import { useId, useLayoutEffect, useState, type KeyboardEvent } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import type { AskPhase } from "../ask";
import type { AskAnswer, AskQuestion, PendingAsk } from "../contracts";
import { useDictation } from "../DictationProvider";
import { OTHER_TEXT_MAX_LENGTH, draftOf, isAnswered, pickOption, routeOf, settle, toAnswers, type AskDrafts, type AskRoute, type QuestionDraft } from "../askDraft";

/** What the binding hands the composer while an ask is open. */
export interface AskBinding {
  ask: PendingAsk;
  phase: AskPhase;
  /** Inputs stay visible, but nothing can be sent. */
  offline: boolean;
  onSubmit: (answers: AskAnswer[]) => void;
  onDismiss: () => void;
  /** Sends the input as a chat message. The server closes the ask as answered in chat. */
  onChat: (text: string) => Promise<void>;
}
export type AskControl = NonNullable<ReturnType<typeof useAskMode>>;

interface Progress { askId?: string; index: number; drafts: AskDrafts }

/**
 * Ask mode of the one composer. The composer's own input answers the current
 * question, so every input feature works in ask mode too. The draft from before
 * the ask is set aside when the ask opens and put back when it closes.
 */
export function useAskMode(binding: AskBinding | undefined) {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const dictating = useAuiState((s) => s.composer.dictation != null);
  const disabled = useAuiState((s) => s.thread.isDisabled);
  const { cancel } = useDictation();
  const headingId = useId();
  const askId = binding?.ask.askId;
  const [saved, setProgress] = useState<Progress>({ askId, index: 0, drafts: {} });
  // A new ask starts blank on its first question.
  const progress: Progress = saved.askId === askId ? saved : { askId, index: 0, drafts: {} };

  // Invalidate capture before an ask, question, or connection replaces its input owner.
  const questionId = binding?.ask.questions[progress.index]?.id;
  useLayoutEffect(() => {
    cancel();
    aui.composer.stopDictation();
    return () => { cancel(); aui.composer.stopDictation(); };
  }, [askId, questionId, disabled, cancel, aui]);

  useLayoutEffect(() => {
    if (askId === undefined) return;
    const stash = aui.composer.getState().text;
    aui.composer.setText("");
    return () => aui.composer.setText(stash);
  }, [askId, aui]);

  const questions = binding?.ask.questions ?? [];
  const index = Math.min(progress.index, Math.max(questions.length - 1, 0));
  const question = questions[index];
  const current = (item: AskQuestion): QuestionDraft => item === question
    ? { values: draftOf(progress.drafts, item).values, text } : draftOf(progress.drafts, item);
  /** Every draft, with the input's text written into the current question. */
  const flushed = (): AskDrafts => question
    ? { ...progress.drafts, [question.id]: settle(question, { values: draftOf(progress.drafts, question).values, text }) }
    : progress.drafts;

  if (!binding || !question) return undefined;
  const { phase, offline } = binding;
  const sending = phase.type === "sending";
  const tooLong = questions.some((item) => current(item).text.trim().length > OTHER_TEXT_MAX_LENGTH);
  const blocked = sending || offline || dictating || tooLong;
  const last = index >= questions.length - 1;
  const route: AskRoute = routeOf(text);

  function go(next: number) {
    cancel();
    aui.composer.stopDictation();
    const drafts = flushed();
    setProgress({ askId, index: next, drafts });
    aui.composer.setText(draftOf(drafts, questions[next]!).text);
  }
  function pick(value: string) {
    if (!question || sending) return;
    cancel();
    aui.composer.stopDictation();
    const next = pickOption(question, current(question), value);
    setProgress({ ...progress, drafts: { ...progress.drafts, [question.id]: next } });
    if (next.text !== text) aui.composer.setText(next.text);
  }
  async function sendChat() {
    if (blocked || text.trim() === "" || !binding) return;
    // Clear first: the ask can close, and restore the old draft, before the reply arrives.
    aui.composer.setText("");
    try { await binding.onChat(text); } catch { aui.composer.setText(text); }
  }
  function advance() {
    if (blocked) return;
    if (!last) { go(index + 1); return; }
    if (blocked || !binding) return;
    const drafts = flushed();
    setProgress({ askId, index, drafts });
    binding.onSubmit(toAnswers(binding.ask, drafts));
  }
  function primary() { if (route === "chat") void sendChat(); else advance(); }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    primary();
  }
  return {
    ask: binding.ask, question, index, count: questions.length, last, route, headingId,
    sending, blocked, phase, error: tooLong ? `An answer exceeds ${OTHER_TEXT_MAX_LENGTH} characters. Shorten it before sending.`
      : phase.type === "answering" ? phase.error : undefined,
    values: settle(question, current(question)).values,
    answered: (position: number) => isAnswered(questions[position]!, current(questions[position]!)),
    placeholder: question.options.length > 0 ? "Or answer in your own words" : "Type your answer",
    go, pick, primary, onKeyDown, dismiss: binding.onDismiss,
  };
}
