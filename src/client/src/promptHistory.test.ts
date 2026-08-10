import { describe, expect, it } from "vitest";
import { normalizeMessages, textMessage } from "./chatMessages";
import type { ChatLine } from "./components/shared";
import {
  addPromptHistoryEntry,
  createPromptHistory,
  leavePromptHistory,
  navigatePromptHistory,
  promptHistoryEntries,
  type PromptHistoryEditorSnapshot,
} from "./promptHistory";

function editor(text: string, head = text.length, boundaries = { top: true, bottom: true }): PromptHistoryEditorSnapshot {
  return {
    text,
    selection: { anchor: head, head },
    atTop: boundaries.top,
    atBottom: boundaries.bottom,
  };
}

describe("prompt history", () => {
  it("projects the latest 100 user prompts from the visible session transcript", () => {
    const messages: ChatLine[] = Array.from({ length: 102 }, (_, index) => textMessage("user", `prompt ${String(index)}`));
    messages.splice(101, 0, textMessage("assistant", "answer"));
    messages.push(textMessage("user", "prompt 101"));
    messages.push({ role: "user", parts: [{ type: "image", mimeType: "image/png", data: "image" }] });

    const entries = promptHistoryEntries(messages);

    expect(entries).toHaveLength(100);
    expect(entries.slice(0, 3)).toEqual(["prompt 101", "prompt 100", "prompt 99"]);
    expect(entries.at(-1)).toBe("prompt 2");
  });

  it("reconstructs Pi skill invocation prompts from their visible transcript lines", () => {
    const prompt = "<skill name=\"testing-guide\" location=\"/skills/testing-guide/SKILL.md\">\nUse the test harness\n</skill>\n\nNow test the UI";

    expect(promptHistoryEntries(normalizeMessages([{ role: "user", content: prompt }]))).toEqual([prompt]);
  });

  it("keeps a skill-only turn separate from a later queued prompt", () => {
    const skill: ChatLine = {
      role: "user",
      parts: [{ type: "skillInvocation", name: "testing-guide", location: "/skills/testing-guide/SKILL.md", content: "Use the test harness" }],
    };

    expect(promptHistoryEntries([skill, textMessage("user", "separate prompt")])).toEqual([
      "separate prompt",
      "<skill name=\"testing-guide\" location=\"/skills/testing-guide/SKILL.md\">\nUse the test harness\n</skill>",
    ]);
  });

  it("browses older prompts and restores the unsent draft on the way back down", () => {
    const initial = createPromptHistory(["most recent", "older"]);

    const recent = navigatePromptHistory(initial, "older", editor("unfinished", 0));
    if (recent === undefined) throw new Error("Expected the most recent prompt");
    expect(recent.editor).toEqual({ text: "most recent", selection: { anchor: 0, head: 0 } });

    const older = navigatePromptHistory(recent.state, "older", editor("most recent", 0));
    if (older === undefined) throw new Error("Expected the older prompt");
    expect(older.editor).toEqual({ text: "older", selection: { anchor: 0, head: 0 } });
    expect(navigatePromptHistory(older.state, "older", editor("older", 0))).toBeUndefined();

    const newer = navigatePromptHistory(older.state, "newer", editor("older", 5));
    if (newer === undefined) throw new Error("Expected the newer prompt");
    expect(newer.editor).toEqual({ text: "most recent", selection: { anchor: 11, head: 11 } });

    const draft = navigatePromptHistory(newer.state, "newer", editor("most recent", 11));
    expect(draft?.editor).toEqual({ text: "unfinished", selection: { anchor: 0, head: 0 } });
  });

  it("leaves arrow keys to normal cursor movement away from Pi's history boundaries", () => {
    const history = createPromptHistory(["previous"]);

    expect(navigatePromptHistory(history, "older", editor("draft", 3))).toBeUndefined();
    expect(navigatePromptHistory(history, "older", editor("", 0, { top: false, bottom: true }))).toBeUndefined();
    expect(navigatePromptHistory(history, "newer", editor("", 0))).toBeUndefined();
  });

  it("trims new prompts, skips consecutive duplicates, and exits browsing after edits", () => {
    let history = createPromptHistory(["previous"]);
    history = addPromptHistoryEntry(history, "  next  ");
    history = addPromptHistoryEntry(history, "next");
    expect(history.entries).toEqual(["next", "previous"]);

    const browsing = navigatePromptHistory(history, "older", editor(""));
    if (browsing === undefined) throw new Error("Expected prompt history browsing");
    expect(browsing.state.position.kind).toBe("entry");
    expect(leavePromptHistory(browsing.state).position).toEqual({ kind: "draft" });
  });
});
