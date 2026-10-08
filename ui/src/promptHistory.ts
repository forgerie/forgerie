import type { ThreadMessage } from "@assistant-ui/react";

const LIMIT = 100;
export interface PromptSnapshot { text: string; start: number; end: number }
export type PromptHistory = { entries: readonly string[]; position: { type: "draft" } | { type: "entry"; index: number; draft: PromptSnapshot } };

/** Legacy recall order: newest user text first, adjacent duplicates removed. */
export function promptHistoryEntries(messages: readonly ThreadMessage[]): readonly string[] {
  const entries: string[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    const original = message.metadata.custom?.promptText;
    const text = (typeof original === "string" ? original : message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("")).trim();
    if (!text || entries.at(-1) === text) continue;
    entries.push(text);
    if (entries.length === LIMIT) break;
  }
  return entries;
}

export function createPromptHistory(entries: readonly string[] = []): PromptHistory {
  return { entries, position: { type: "draft" } };
}

/** Up only takes a nonempty draft at its start. Down requires the final line. */
export function recallPrompt(state: PromptHistory, direction: "older" | "newer", editor: PromptSnapshot): { state: PromptHistory; editor: PromptSnapshot } | undefined {
  if (editor.start !== editor.end || state.entries.length === 0) return undefined;
  const { position } = state;
  if (direction === "older") {
    if (editor.text.slice(0, editor.start).includes("\n") || position.type === "draft" && editor.text !== "" && editor.start !== 0) return undefined;
    const index = position.type === "entry" ? position.index + 1 : 0;
    const text = state.entries[index];
    if (text === undefined) return undefined;
    return { state: { entries: state.entries, position: { type: "entry", index, draft: position.type === "entry" ? position.draft : editor } }, editor: { text, start: 0, end: 0 } };
  }
  if (position.type === "draft" || editor.text.slice(editor.end).includes("\n")) return undefined;
  const index = position.index - 1;
  if (index < 0) return { state: createPromptHistory(state.entries), editor: position.draft };
  const text = state.entries[index];
  if (text === undefined) return undefined;
  return { state: { ...state, position: { ...position, index } }, editor: { text, start: text.length, end: text.length } };
}
