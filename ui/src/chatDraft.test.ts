import { describe, expect, it } from "vitest";
import { createChatDraft } from "./chatDraft";

/** A composer input. Subscribers run synchronously, as assistant-ui notifies them. */
function input(text: string) {
  let current = text;
  const listeners: (() => void)[] = [];
  return {
    getState: () => ({ text: current }),
    setText: (next: string) => { current = next; for (const listener of listeners) listener(); },
    subscribe: (listener: () => void) => { listeners.push(listener); },
  };
}
/** The session's saved chat draft, as the draft store keeps it. */
function savedChat(text = "") {
  const saved = { text, saveChat: (next: string) => { saved.text = next; } };
  return saved;
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
  it("saves the chat draft as it changes, and writes nothing before the saved draft is back", () => {
    const saved = savedChat("from before the reload");
    const composer = input("");
    const draft = createChatDraft(() => composer, saved);
    composer.subscribe(draft.sync);
    // Mount order: the ask layer settles, and the empty composer notifies, before hydration.
    draft.setAsk(undefined); draft.sync();
    expect(saved.text).toBe("from before the reload");
    draft.hydrate(saved.text);
    expect(composer.getState().text).toBe("from before the reload");
    composer.setText("from before the reload, edited");
    expect(saved.text).toBe("from before the reload, edited");
    composer.setText("");
    expect(saved.text).toBe("");
  });
  it("saves the parked chat draft, never the answer, while an ask holds the input", () => {
    const saved = savedChat();
    const composer = input("");
    const draft = createChatDraft(() => composer, saved);
    composer.subscribe(draft.sync);
    draft.hydrate("");
    composer.setText("chat thought");
    draft.setAsk("a");
    expect(composer.getState().text).toBe("");
    composer.setText("my answer");
    expect(saved.text).toBe("chat thought");
    draft.restore("queued follow-up");
    expect(saved.text).toBe("queued follow-up\n\nchat thought");
    draft.setAsk(undefined);
    expect(composer.getState().text).toBe("queued follow-up\n\nchat thought");
    expect(saved.text).toBe("queued follow-up\n\nchat thought");
  });
  it("puts a saved draft in the parked slot when an ask already holds the input", () => {
    const saved = savedChat("saved chat");
    const composer = input("");
    const draft = createChatDraft(() => composer, saved);
    draft.setAsk("a"); composer.setText("restored answer");
    draft.hydrate(saved.text);
    expect(composer.getState().text).toBe("restored answer");
    draft.setAsk(undefined);
    expect(composer.getState().text).toBe("saved chat");
  });
  it("never writes into a different session after the composer unmounts", () => {
    const composer = input("draft"); let mounted = true;
    const draft = createChatDraft(() => mounted ? composer : undefined);
    draft.setAsk("a"); composer.setText("answer"); mounted = false;
    draft.setAsk(undefined); draft.restore("/compact old session");
    expect(composer.getState().text).toBe("answer");
  });
});
