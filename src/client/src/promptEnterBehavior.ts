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

export function shouldUsePromptEnterShiftShortcut(shiftKey: boolean, evidence: PromptEnterShiftEvidence, media = createMobilePromptEnterMedia()): boolean {
  // Touch keyboards can report autocapitalization as Shift on Enter after a line break.
  // On mobile-like screens, only trust Shift when a real Shift keydown backs it up.
  // Android routes hardware keyboards through the IME, which drops or interleaves the
  // per-chord Shift keydown, so any past hardware Shift evidence is enough — on-screen
  // keyboards never dispatch a standalone Shift keydown, so the autocap phantom stays out.
  if (!shiftKey) return false;
  if (media?.matches === true) return evidence.explicitShiftKeyActive || evidence.hardwareShiftKeySeen;
  return true;
}

export function shouldSendPromptOnEnterShortcut(shiftKey: boolean): boolean {
  return !shiftKey;
}
