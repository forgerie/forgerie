import { describe, expect, it } from "vitest";
import { fromThreadMessageLike } from "@assistant-ui/react";
import { createPromptHistory, promptHistoryEntries, recallPrompt, type PromptSnapshot } from "./promptHistory";
import { convertMessage, fromHistory } from "./transcript";

const editor = (text: string, start = text.length, end = start): PromptSnapshot => ({ text, start, end });
const messages = (...texts: string[]) => fromHistory(texts.map((content) => ({ role: "user", content }))).messages
  .map((message) => fromThreadMessageLike(convertMessage(message), message.id, { type: "complete", reason: "stop" }));

describe("legacy prompt recall", () => {
  it("keeps newest user text, drops blank prompts and adjacent duplicates, and caps at 100", () => {
    expect(promptHistoryEntries(messages("first", "first", " ", "second"))).toEqual(["second", "first"]);
    expect(promptHistoryEntries(messages(...Array.from({ length: 101 }, (_, i) => String(i))))).toHaveLength(100);
    const assistant = fromThreadMessageLike({ role: "assistant", content: "reply" }, "a", { type: "complete", reason: "stop" });
    expect(promptHistoryEntries([...messages("first"), assistant])).toEqual(["first"]);
  });
  it("recalls the expanded skill and its argument, not only the bubble's text", () => {
    const skill = '<skill name="review" location="/skills/review/SKILL.md">\nRead first.\n</skill>';
    expect(promptHistoryEntries(messages(skill, `${skill}\n\nReview these changes`))).toEqual([`${skill}\n\nReview these changes`, skill]);
  });
  it("walks both ways and restores the exact unsent draft and caret", () => {
    const initial = createPromptHistory(["recent", "older"]);
    const draft = editor("unfinished", 0);
    const recent = recallPrompt(initial, "older", draft)!;
    expect(recent.editor).toEqual(editor("recent", 0));
    const older = recallPrompt(recent.state, "older", recent.editor)!;
    expect(older.editor.text).toBe("older");
    expect(recallPrompt(older.state, "older", older.editor)).toBeUndefined();
    const newer = recallPrompt(older.state, "newer", editor("older"))!;
    expect(newer.editor).toEqual(editor("recent"));
    expect(recallPrompt(newer.state, "newer", newer.editor)?.editor).toEqual(draft);
  });
  it("leaves selections, interior lines, a draft's end, and Down outside browsing alone", () => {
    const state = createPromptHistory(["recent"]);
    for (const value of [editor("draft"), editor("draft", 0, 2), editor("first\nsecond", 6)]) {
      expect(recallPrompt(state, "older", value)).toBeUndefined();
    }
    expect(recallPrompt(state, "newer", editor(""))).toBeUndefined();
    const browsing = recallPrompt(state, "older", editor(""))!;
    expect(recallPrompt(browsing.state, "newer", editor("first\nsecond", 2))).toBeUndefined();
  });
});
