import { useEffect, useId, useLayoutEffect, useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import type { AskPhase } from "../ask";
import type { AskAnswer, AskQuestion, PendingAsk } from "../contracts";
import { useDictation } from "../DictationProvider";
import type { ChatDraft } from "../chatDraft";
import type { SessionDrafts } from "../draftStore";
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
  /** Where unsent answers outlive the view. Without it, they last only while it is mounted. */
  answers?: Pick<SessionDrafts, "answers" | "saveAnswers"> | undefined;
}
export type AskControl = NonNullable<ReturnType<typeof useAskMode>>;

interface Progress { askId?: string; index: number; drafts: AskDrafts }

/**
 * Ask mode of the one composer. The composer's own input answers the current
 * question, so every input feature works in ask mode too. The draft from before
 * the ask is set aside when the ask opens and put back when it closes.
 */
export function useAskMode(binding: AskBinding | undefined, chatDraft: ChatDraft) {
  const aui = useAui();
  const text = useAuiState((s) => s.composer.text);
  const dictating = useAuiState((s) => s.composer.dictation != null);
  const disabled = useAuiState((s) => s.thread.isDisabled);
  const { cancel } = useDictation();
  const hasAttachments = useAuiState((s) => s.composer.attachments.length > 0 || s.composer.submission !== undefined);
  const preparing = useAuiState((s) => s.composer.submission !== undefined);
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

  const questions = binding?.ask.questions ?? [];
  // An ask takes the input with its saved answers, or blank on its first question.
  useLayoutEffect(() => {
    chatDraft.setAsk(askId);
    if (askId === undefined) return;
    const restored = binding?.answers?.answers(askId) ?? { index: 0, drafts: {} };
    setProgress({ askId, ...restored });
    const shown = questions[Math.min(restored.index, Math.max(questions.length - 1, 0))];
    const text = shown ? draftOf(restored.drafts, shown).text : "";
    if (text) aui.composer.setText(text);
    // Only a new ask restores. Later bindings of the same ask carry the same store.
  }, [askId, chatDraft]);
  useLayoutEffect(() => () => chatDraft.setAsk(undefined), [chatDraft]);

  const index = Math.min(progress.index, Math.max(questions.length - 1, 0));
  const question = questions[index];
  const current = (item: AskQuestion): QuestionDraft => item === question
    ? { values: draftOf(progress.drafts, item).values, text } : draftOf(progress.drafts, item);
  /** Every draft, with the input's text written into the current question. */
  const flushed = (input = text): AskDrafts => question
    ? { ...progress.drafts, [question.id]: settle(question, { values: draftOf(progress.drafts, question).values, text: input }) }
    : progress.drafts;

  const answerStore = binding?.answers;
  useEffect(() => {
    // Save only once this ask's progress is in place: the first render of a new ask is blank.
    if (askId === undefined || saved.askId !== askId || !question || !answerStore) return;
    // The render's text can lag one change behind the input. Right after an ask
    // takes the input it can still be the parked chat draft, which must never
    // be saved as an answer, so save what the input holds now.
    answerStore.saveAnswers(askId, { index, drafts: flushed(chatDraft.inputText() ?? text) });
    // flushed() reads only saved, question, and the input.
  }, [answerStore, askId, saved, index, question, text, chatDraft]);

  if (!binding || !question) return undefined;
  const { phase, offline } = binding;
  const sending = phase.type === "sending" || preparing;
  const tooLong = questions.some((item) => current(item).text.trim().length > OTHER_TEXT_MAX_LENGTH);
  const blocked = sending || offline || dictating || tooLong;
  const last = index >= questions.length - 1;
  const route: AskRoute = hasAttachments ? "chat" : routeOf(text);

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
    if (blocked || !binding) return;
    if (hasAttachments) { await aui.composer.send(); return; }
    if (text.trim() === "") return;
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
  function onKeyDown(event: KeyboardEvent, shiftKey = event.shiftKey) {
    if (event.key !== "Enter" || shiftKey || event.isComposing) return;
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
