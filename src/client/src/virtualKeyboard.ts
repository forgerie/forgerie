// Detects whether the on-screen (virtual) keyboard is currently open.
//
// The composer needs this at Enter time: an open virtual keyboard means Enter
// inserts a new line (glass typing has no Shift+Enter chord and the send
// button is the submit path), while hardware typing keeps Enter-to-send.
// Android funnels both keyboards through identical key events, so the only
// reliable runtime signal is geometry: an opening keyboard shrinks the
// viewport's height while its width stays constant. Rotation, fold/unfold,
// and window resizes always change width, so they re-baseline instead of
// misreading as a keyboard. Browser chrome (URL bar) shifts height by less
// than the threshold and is ignored.
//
// This works under both `interactive-widget` modes: the visual viewport
// shrinks with the keyboard either way.

export interface VirtualKeyboardViewportSample {
  width: number;
  height: number;
}

export interface VirtualKeyboardState {
  baseline: VirtualKeyboardViewportSample;
  open: boolean;
}

/**
 * Minimum height loss (CSS px) that counts as a keyboard. On-screen keyboards
 * take >=200px on every supported posture; URL-bar show/hide moves ~56-100px.
 */
export const VIRTUAL_KEYBOARD_MIN_INSET = 140;

export function initialVirtualKeyboardState(sample: VirtualKeyboardViewportSample): VirtualKeyboardState {
  return { baseline: sample, open: false };
}

export function reduceVirtualKeyboardState(state: VirtualKeyboardState, sample: VirtualKeyboardViewportSample): VirtualKeyboardState {
  // Width changed: rotation, fold/unfold, or window resize — never the keyboard.
  if (sample.width !== state.baseline.width) return { baseline: sample, open: false };
  if (sample.height <= state.baseline.height - VIRTUAL_KEYBOARD_MIN_INSET) return { baseline: state.baseline, open: true };
  // Height recovered (keyboard closed) or shifted a little (browser chrome).
  // Track the tallest constant-width height so hidden chrome raises the baseline.
  return { baseline: { width: state.baseline.width, height: Math.max(sample.height, state.baseline.height) }, open: false };
}

export interface VirtualKeyboardTracker {
  readonly open: boolean;
  dispose(): void;
}

export function createVirtualKeyboardTracker(win: Window = window): VirtualKeyboardTracker {
  const viewport = win.visualViewport ?? undefined;
  const sample = (): VirtualKeyboardViewportSample => viewport === undefined
    ? { width: win.innerWidth, height: win.innerHeight }
    : { width: Math.round(viewport.width), height: Math.round(viewport.height) };
  let state = initialVirtualKeyboardState(sample());
  const onResize = (): void => {
    state = reduceVirtualKeyboardState(state, sample());
  };
  const target: EventTarget = viewport ?? win;
  target.addEventListener("resize", onResize);
  return {
    get open() {
      return state.open;
    },
    dispose() {
      target.removeEventListener("resize", onResize);
    },
  };
}
