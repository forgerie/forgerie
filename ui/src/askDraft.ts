import type { AskAnswer, AskQuestion, PendingAsk } from "./contracts";

/**
 * The user's unsent reply to one question. Typed text survives picking an
 * option, so switching back to "your own answer" does not lose it.
 */
export interface QuestionDraft {
  values: readonly string[];
  other: string;
  /** Whether the own-answer text is part of the reply. */
  otherChosen: boolean;
}
export type AskDrafts = Readonly<Record<string, QuestionDraft>>;
export const blankDraft: QuestionDraft = { values: [], other: "", otherChosen: false };
/** Server limit for the text of one own answer. */
export const OTHER_TEXT_MAX_LENGTH = 4000;

export function draftOf(drafts: AskDrafts, question: AskQuestion): QuestionDraft {
  return drafts[question.id] ?? blankDraft;
}

/** One choice replaces the answer; several choices toggle. */
export function pickOption(question: AskQuestion, draft: QuestionDraft, value: string): QuestionDraft {
  if (!question.multiple) return { ...draft, values: [value], otherChosen: false };
  const values = draft.values.includes(value) ? draft.values.filter((item) => item !== value) : [...draft.values, value];
  return { ...draft, values };
}

export function chooseOther(question: AskQuestion, draft: QuestionDraft, chosen: boolean): QuestionDraft {
  return question.multiple ? { ...draft, otherChosen: chosen } : { ...draft, values: chosen ? [] : draft.values, otherChosen: chosen };
}

/** Typing an own answer chooses it. */
export function writeOther(question: AskQuestion, draft: QuestionDraft, text: string): QuestionDraft {
  return { ...chooseOther(question, draft, text.trim() !== "" || draft.otherChosen), other: text };
}

export function isAnswered(draft: QuestionDraft): boolean {
  return draft.values.length > 0 || draft.otherChosen && draft.other.trim() !== "";
}

/** Answers in question order. Untouched questions are left out, which the server reports as unanswered. */
export function toAnswers(ask: PendingAsk, drafts: AskDrafts): AskAnswer[] {
  return ask.questions.flatMap((question) => {
    const draft = draftOf(drafts, question);
    if (!isAnswered(draft)) return [];
    const otherText = draft.otherChosen ? draft.other.trim() : "";
    return [{ id: question.id, values: [...draft.values], ...(otherText ? { otherText } : {}) }];
  });
}
