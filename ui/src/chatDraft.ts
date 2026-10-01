import type { SessionDrafts } from "./draftStore";

interface DraftInput {
  getState: () => { text: string };
  setText: (text: string) => void;
}
type DraftOwner = { type: "chat" } | { type: "ask"; id: string; text: string };
/**
 * Route delayed chat recovery to the saved draft, never to the active ask answer.
 * With `saved`, the chat draft (in the input or parked under an ask) also
 * outlives the page, so a session switch or reload brings it back.
 */
export function createChatDraft(input: () => DraftInput | undefined, saved?: Pick<SessionDrafts, "saveChat">) {
  let owner: DraftOwner = { type: "chat" };
  // Nothing is written until the saved draft is read back: the empty composer
  // of a fresh page would otherwise erase it.
  let hydrated = false;
  function persist() {
    if (!hydrated || !saved) return;
    if (owner.type === "ask") { saved.saveChat(owner.text); return; }
    const composer = input();
    if (composer) saved.saveChat(composer.getState().text);
  }
  function restore(text: string, policy: "prepend" | "if-empty" = "prepend") {
    const composer = input();
    if (!composer || !text.trim()) return;
    const current = owner.type === "ask" ? owner.text : composer.getState().text;
    if (policy === "if-empty" && current !== "") return;
    const restored = [text, current].filter((part) => part.trim()).join("\n\n");
    if (owner.type === "ask") owner = { ...owner, text: restored };
    else composer.setText(restored);
    persist();
  }
  return {
    setAsk: (id: string | undefined) => {
      const composer = input();
      if (id === undefined) {
        if (owner.type === "ask") composer?.setText(owner.text);
        owner = { type: "chat" };
      } else if (composer && (owner.type === "chat" || owner.id !== id)) {
        // A replacement ask inherits the saved chat draft, not the outgoing answer.
        owner = { type: "ask", id, text: owner.type === "ask" ? owner.text : composer.getState().text };
        composer.setText("");
      }
      persist();
    },
    restore,
    /** Bring back the draft saved before this page, then start saving. A newer draft wins. */
    hydrate: (text: string) => { hydrated = true; restore(text, "if-empty"); },
    /** The composer changed. While an ask holds the input, the parked text stays the chat draft. */
    sync: persist,
    /** What the input holds now. A render can still show the text from before the last change. */
    inputText: () => input()?.getState().text,
  };
}
export type ChatDraft = ReturnType<typeof createChatDraft>;
