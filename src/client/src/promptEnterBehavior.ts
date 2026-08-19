export const MOBILE_PROMPT_ENTER_MEDIA_QUERY = "(pointer: coarse), (max-width: 760px)";

export type PromptEnterMedia = Pick<MediaQueryList, "matches">;

export function createMobilePromptEnterMedia(): PromptEnterMedia | undefined {
  return typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(MOBILE_PROMPT_ENTER_MEDIA_QUERY) : undefined;
}

export function shouldUsePromptEnterShiftShortcut(shiftKey: boolean, explicitShiftKeyActive: boolean, media = createMobilePromptEnterMedia()): boolean {
  // Touch keyboards can report autocapitalization as Shift on Enter after a line break.
  // On mobile-like screens, only trust Shift when the editor saw an explicit Shift keydown.
  if (!shiftKey) return false;
  if (media?.matches === true) return explicitShiftKeyActive;
  return true;
}

export function shouldSendPromptOnEnterShortcut(shiftKey: boolean): boolean {
  return !shiftKey;
}
