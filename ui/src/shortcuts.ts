/**
 * The legacy client's new-session shortcuts: Ctrl+Enter starts a session,
 * Ctrl+Shift+Enter starts one in Rapidfire (Cmd on a Mac). They apply only
 * outside text fields: in the composer, Enter sends and Ctrl+Shift+Enter
 * steers the running agent.
 */
export function newSessionShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "target" | "repeat">): "switch" | "rapidfire" | undefined {
  if (event.key !== "Enter" || event.altKey || event.repeat || !(event.ctrlKey || event.metaKey)) return undefined;
  if (editable(event.target)) return undefined;
  return event.shiftKey ? "rapidfire" : "switch";
}

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null;
}
