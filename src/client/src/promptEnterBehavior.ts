export const MOBILE_PROMPT_ENTER_MEDIA_QUERY = "(pointer: coarse), (max-width: 760px)";

export type PromptEnterMedia = Pick<MediaQueryList, "matches">;

export interface PromptEnterShiftEvidence {
  /** A Shift keydown is currently held (set on keydown, cleared on keyup/blur). */
  explicitShiftKeyActive: boolean;
  /** A real Shift keydown has ever reached this editor. Only hardware keyboards dispatch one. */
  hardwareShiftKeySeen: boolean;
}

export function createMobilePromptEnterMedia(): PromptEnterMedia | undefined {
  return typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(MOBILE_PROMPT_ENTER_MEDIA_QUERY) : undefined;
}

/**
 * Whether Enter should act as Shift+Enter. Enter and Shift+Enter both insert a
 * new line, so this only decides whether Enter bypasses an open completion
 * menu: Shift+Enter takes the new line instead of picking a completion.
 */
export function shouldUsePromptEnterShiftShortcut(shiftKey: boolean, evidence: PromptEnterShiftEvidence, media = createMobilePromptEnterMedia()): boolean {
  // A Shift key is physically held right now. Trust it even when the event's own
  // shiftKey flag is false: CodeMirror's Android key-delay path swallows the real
  // Enter keydown and re-dispatches a synthetic one that strips all modifiers.
  if (evidence.explicitShiftKeyActive) return true;
  if (!shiftKey) return false;
  // Touch keyboards can report autocapitalization as Shift on Enter after a line
  // break. On mobile-like screens, only trust the flag once a real Shift keydown
  // has ever been seen — on-screen keyboards never dispatch one, so the autocap
  // phantom stays out.
  if (media?.matches === true) return evidence.hardwareShiftKeySeen;
  return true;
}

/**
 * Whether Enter submits the draft. Enter alone always inserts a new line — on
 * every device and keyboard — so submitting needs the send button or a held
 * Ctrl/Cmd. The held flag covers Android, where CodeMirror re-dispatches Enter
 * as a synthetic event with every modifier stripped.
 */
export function shouldSubmitPromptOnEnterShortcut(sendModifierKey: boolean, sendModifierHeld: boolean): boolean {
  return sendModifierKey || sendModifierHeld;
}
