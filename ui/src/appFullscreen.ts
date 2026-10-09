/**
 * Full screen on request only. The installed app already opens full screen
 * from its manifest (`display: "fullscreen"`). This is the explicit way in
 * for a browser tab, and the way back out.
 *
 * Never call the Fullscreen API on an ordinary tap: Chrome then keeps Escape
 * for leaving full screen, so a dialog needs two presses to close (main
 * b7849125, 9316e59a).
 */
export interface FullscreenDocument {
  readonly fullscreenElement: unknown;
  readonly documentElement: { requestFullscreen?: (options?: FullscreenOptions) => Promise<void> };
  readonly exitFullscreen?: () => Promise<void>;
}

export type FullscreenState =
  | { type: "unsupported" }
  | { type: "window" }
  | { type: "fullscreen" };

export function fullscreenState(target: FullscreenDocument): FullscreenState {
  const active = target.fullscreenElement !== null && target.fullscreenElement !== undefined;
  if (active) return typeof target.exitFullscreen === "function" ? { type: "fullscreen" } : { type: "unsupported" };
  return typeof target.documentElement.requestFullscreen === "function" ? { type: "window" } : { type: "unsupported" };
}

/** Acts on the state the reader saw, even if the browser changed it since. */
export async function toggleFullscreen(seen: FullscreenState, target: FullscreenDocument): Promise<void> {
  if (seen.type === "window") await target.documentElement.requestFullscreen?.call(target.documentElement, { navigationUI: "hide" });
  else if (seen.type === "fullscreen") await target.exitFullscreen?.call(target);
}
