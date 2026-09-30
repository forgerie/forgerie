import type { AskAnswer, AskQuestion, PendingAsk } from "./contracts";

/**
 * The user's unsent reply to one question. `text` is what the composer input
 * held while the question was current.
 */
export interface QuestionDraft {
  values: readonly string[];
  text: string;
}
export type AskDrafts = Readonly<Record<string, QuestionDraft>>;
export const blankDraft: QuestionDraft = { values: [], text: "" };
/** Server limit for the typed answer to one question. */
export const OTHER_TEXT_MAX_LENGTH = 4000;

export function draftOf(drafts: AskDrafts, question: AskQuestion): QuestionDraft {
  return drafts[question.id] ?? blankDraft;
}

/**
 * One choice replaces the answer, typed text included; several choices toggle
 * and keep the text. What the bar shows is what gets sent.
 */
export function pickOption(question: AskQuestion, draft: QuestionDraft, value: string): QuestionDraft {
  if (!question.multiple) return { values: [value], text: "" };
  const values = draft.values.includes(value) ? draft.values.filter((item) => item !== value) : [...draft.values, value];
  return { ...draft, values };
}

/** In a one-choice question, typed text replaces the chosen option. */
export function settle(question: AskQuestion, draft: QuestionDraft): QuestionDraft {
  return !question.multiple && draft.text.trim() !== "" && draft.values.length > 0 ? { ...draft, values: [] } : draft;
}

export function isAnswered(question: AskQuestion, draft: QuestionDraft): boolean {
  const settled = settle(question, draft);
  return settled.values.length > 0 || settled.text.trim() !== "";
}

/** Answers in question order. Untouched questions are left out, which the server reports as unanswered. */
export function toAnswers(ask: PendingAsk, drafts: AskDrafts): AskAnswer[] {
  return ask.questions.flatMap((question) => {
    const draft = settle(question, draftOf(drafts, question));
    if (!isAnswered(question, draft)) return [];
    const otherText = draft.text.trim();
    return [{ id: question.id, values: [...draft.values], ...(otherText ? { otherText } : {}) }];
  });
}

/**
 * Where the input's text goes while an ask is open. A form answer carries only
 * text, so a slash command goes out as a chat message. The server then closes
 * the ask as answered in chat.
 */
export type AskRoute = "answer" | "chat";
export function routeOf(text: string): AskRoute {
  return text.trimStart().startsWith("/") ? "chat" : "answer";
}
