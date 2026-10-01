import { describe, expect, it } from "vitest";
import { createChatDraft } from "./chatDraft";

function input(text: string) {
  let current = text;
  return { getState: () => ({ text: current }), setText: (next: string) => { current = next; } };
}
describe("chat draft ownership", () => {
  it("keeps recovery in chat across replacement asks and retains queue order", () => {
    const composer = input("unfinished draft");
    const draft = createChatDraft(() => composer);
    draft.setAsk("a"); composer.setText("answer a");
    draft.restore("/compact keep decisions\n\nqueued follow-up");
    expect(composer.getState().text).toBe("answer a");
    draft.setAsk("b"); expect(composer.getState().text).toBe("");
    composer.setText("answer b"); draft.setAsk(undefined);
    expect(composer.getState().text).toBe("/compact keep decisions\n\nqueued follow-up\n\nunfinished draft");
  });
  it("puts a rejected command back only when its chat draft is still empty", () => {
    const composer = input(""); const draft = createChatDraft(() => composer);
    draft.setAsk("a"); composer.setText("answer");
    draft.restore("/compact preserve tests", "if-empty");
    expect(composer.getState().text).toBe("answer");
    draft.setAsk(undefined); expect(composer.getState().text).toBe("/compact preserve tests");
    composer.setText("new thought"); draft.setAsk("b");
    draft.restore("/compact previous instructions", "if-empty");
    draft.setAsk(undefined); expect(composer.getState().text).toBe("new thought");
  });
  it("never writes into a different session after the composer unmounts", () => {
    const composer = input("draft"); let mounted = true;
    const draft = createChatDraft(() => mounted ? composer : undefined);
    draft.setAsk("a"); composer.setText("answer"); mounted = false;
    draft.setAsk(undefined); draft.restore("/compact old session");
    expect(composer.getState().text).toBe("answer");
  });
});
