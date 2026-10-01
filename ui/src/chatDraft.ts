interface DraftInput {
  getState: () => { text: string };
  setText: (text: string) => void;
}
type DraftOwner = { type: "chat" } | { type: "ask"; id: string; text: string };
/** Route delayed chat recovery to the saved draft, never to the active ask answer. */
export function createChatDraft(input: () => DraftInput | undefined) {
  let owner: DraftOwner = { type: "chat" };
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
    },
    restore: (text: string, policy: "prepend" | "if-empty" = "prepend") => {
      const composer = input();
      if (!composer || !text.trim()) return;
      const current = owner.type === "ask" ? owner.text : composer.getState().text;
      if (policy === "if-empty" && current !== "") return;
      const restored = [text, current].filter((part) => part.trim()).join("\n\n");
      if (owner.type === "ask") owner = { ...owner, text: restored };
      else composer.setText(restored);
    },
  };
}
export type ChatDraft = ReturnType<typeof createChatDraft>;
