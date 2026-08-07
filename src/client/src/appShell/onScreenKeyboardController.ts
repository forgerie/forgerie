import type { ReactiveController, ReactiveControllerHost } from "lit";

const DEFAULT_MIN_KEYBOARD_HEIGHT_PX = 120;
const WIDTH_CHANGE_TOLERANCE_PX = 1;

export interface KeyboardViewport {
  readonly innerWidth: number;
  readonly innerHeight: number;
  addEventListener(type: "resize", listener: EventListener): void;
  removeEventListener(type: "resize", listener: EventListener): void;
}

export interface OnScreenKeyboardControllerOptions {
  viewport?: KeyboardViewport | undefined;
  isComposerFocused: () => boolean;
  isTouchInput?: (() => boolean) | undefined;
  minKeyboardHeight?: number | undefined;
}

/**
 * Converts browser viewport resize events into the keyboard-open state used by
 * the app shell. The viewport meta policy makes Android resize the layout, but
 * browsers do not expose a standard keyboard-open media query.
 */
export class OnScreenKeyboardController implements ReactiveController {
  private readonly viewport: KeyboardViewport | undefined;
  private readonly isComposerFocused: () => boolean;
  private readonly isTouchInput: () => boolean;
  private readonly minKeyboardHeight: number;
  private baselineHeight: number;
  private viewportWidth: number;
  private connected = false;
  isOpen = false;

  constructor(private readonly host: ReactiveControllerHost, options: OnScreenKeyboardControllerOptions) {
    host.addController(this);
    this.viewport = options.viewport ?? browserKeyboardViewport();
    this.isComposerFocused = options.isComposerFocused;
    this.isTouchInput = options.isTouchInput ?? browserUsesTouchInput;
    this.minKeyboardHeight = options.minKeyboardHeight ?? DEFAULT_MIN_KEYBOARD_HEIGHT_PX;
    this.baselineHeight = this.viewport?.innerHeight ?? 0;
    this.viewportWidth = this.viewport?.innerWidth ?? 0;
  }

  hostConnected(): void {
    if (this.connected) return;
    this.connected = true;
    this.viewport?.addEventListener("resize", this.onViewportResize);
  }

  hostDisconnected(): void {
    if (!this.connected) return;
    this.connected = false;
    this.viewport?.removeEventListener("resize", this.onViewportResize);
    this.isOpen = false;
  }

  private readonly onViewportResize: EventListener = () => {
    const viewport = this.viewport;
    if (viewport === undefined) return;
    const widthChanged = Math.abs(viewport.innerWidth - this.viewportWidth) > WIDTH_CHANGE_TOLERANCE_PX;
    if (widthChanged) {
      this.viewportWidth = viewport.innerWidth;
      this.baselineHeight = viewport.innerHeight;
      // A fold or rotation can keep the keyboard open while both dimensions
      // change. Preserve that state until the new posture expands again.
      if (!this.isOpen) this.setOpen(false);
      return;
    }

    if (!this.isTouchInput() || !this.isComposerFocused()) {
      this.baselineHeight = viewport.innerHeight;
      this.setOpen(false);
      return;
    }

    if (viewport.innerHeight > this.baselineHeight) this.baselineHeight = viewport.innerHeight;
    this.setOpen(this.baselineHeight - viewport.innerHeight >= this.minKeyboardHeight);
  };

  private setOpen(open: boolean): void {
    if (this.isOpen === open) return;
    this.isOpen = open;
    this.host.requestUpdate();
  }
}

function browserKeyboardViewport(): KeyboardViewport | undefined {
  if (typeof window === "undefined") return undefined;
  return {
    get innerWidth() { return window.innerWidth; },
    get innerHeight() { return window.innerHeight; },
    addEventListener(type, listener) { window.addEventListener(type, listener); },
    removeEventListener(type, listener) { window.removeEventListener(type, listener); },
  };
}

function browserUsesTouchInput(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}
