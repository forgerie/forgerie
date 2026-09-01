export interface ChatScrollViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ChatScrollFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

export type ChatScrollMode = "opening-tail" | "tail" | "reader" | "history";

export interface ChatScrollControllerOptions {
  readonly frames?: ChatScrollFrameScheduler;
  readonly onModeChange?: (mode: ChatScrollMode) => void;
}

const CHAT_SCROLL_BOTTOM_TOLERANCE = 2;
const CHAT_TOUCH_TAKEOVER_DELTA = 6;
const CHAT_OPENING_SETTLE_FRAMES = 2;

const browserFrameScheduler: ChatScrollFrameScheduler = {
  request(callback: FrameRequestCallback): number {
    return requestAnimationFrame(callback);
  },
  cancel(id: number): void {
    cancelAnimationFrame(id);
  },
};

/** Owns transcript-tail placement, opening settlement, and reader takeover. */
export class ChatScrollController {
  private currentMode: ChatScrollMode = "opening-tail";
  private readonly frames: ChatScrollFrameScheduler;
  private readonly onModeChange: ((mode: ChatScrollMode) => void) | undefined;
  private viewport: ChatScrollViewport | undefined;
  private placementFrame: number | undefined;
  private openingReady = false;
  private openingStableFrames = 0;
  private touchY: number | undefined;
  private touchActive = false;
  private pointerActive = false;

  constructor(options: ChatScrollControllerOptions = {}) {
    this.frames = options.frames ?? browserFrameScheduler;
    this.onModeChange = options.onModeChange;
  }

  get mode(): ChatScrollMode {
    return this.currentMode;
  }

  connect(viewport: ChatScrollViewport): void {
    this.viewport = viewport;
    this.contentChanged();
  }

  beginOpening(): void {
    this.cancelPlacement();
    this.openingReady = false;
    this.openingStableFrames = 0;
    this.touchY = undefined;
    this.touchActive = false;
    this.pointerActive = false;
    this.setMode("opening-tail");
    this.contentChanged();
  }

  completeOpening(): void {
    if (this.currentMode !== "opening-tail") return;
    this.openingReady = true;
    this.openingStableFrames = 0;
    this.contentChanged();
  }

  contentChanged(): void {
    if (this.currentMode === "history") return;
    if (this.currentMode === "reader") {
      if (!this.isAtBottom()) return;
      this.setMode("tail");
    }
    this.openingStableFrames = 0;
    this.placeTail();
    this.schedulePlacement();
  }

  recordScroll(): void {
    if (this.currentMode !== "reader" || !this.isAtBottom()) return;
    this.setMode("tail");
  }

  readerWheel(deltaY: number): void {
    if (deltaY < 0) this.takeReaderControl();
  }

  readerTouchStart(y: number | undefined): void {
    this.touchY = y;
    this.touchActive = y !== undefined;
  }

  readerTouchMove(y: number | undefined): void {
    if (this.touchY === undefined || y === undefined) return;
    const delta = y - this.touchY;
    if (Math.abs(delta) < CHAT_TOUCH_TAKEOVER_DELTA) return;
    this.touchY = y;
    if (delta > 0) this.takeReaderControl();
  }

  readerKey(key: string, shiftKey: boolean): void {
    if (key === "ArrowUp" || key === "PageUp" || key === "Home" || (key === " " && shiftKey)) this.takeReaderControl();
  }

  readerTouchEnd(): void {
    if (!this.touchActive) return;
    this.touchActive = false;
    this.touchY = undefined;
    if (this.currentMode === "opening-tail") this.contentChanged();
  }

  readerPointerStart(): void {
    this.pointerActive = true;
    this.takeReaderControl();
  }

  readerPointerEnd(): void {
    if (!this.pointerActive) return;
    this.pointerActive = false;
    if (this.currentMode === "opening-tail") this.contentChanged();
    else this.recordScroll();
  }

  holdPosition(): void {
    this.cancelPlacement();
    this.touchActive = false;
    this.pointerActive = false;
    this.openingReady = false;
    this.openingStableFrames = 0;
    this.setMode("history");
  }

  completeHistoryHold(): void {
    if (this.currentMode !== "history") return;
    const nextMode = this.isAtBottom() ? "tail" : "reader";
    this.setMode(nextMode);
    if (nextMode === "tail") this.contentChanged();
  }

  dispose(): void {
    this.cancelPlacement();
    this.touchY = undefined;
    this.touchActive = false;
    this.pointerActive = false;
    this.viewport = undefined;
  }

  private takeReaderControl(): void {
    if (this.currentMode === "opening-tail") {
      this.contentChanged();
      return;
    }
    this.cancelPlacement();
    this.setMode("reader");
  }

  private schedulePlacement(): void {
    this.cancelPlacement();
    this.placementFrame = this.frames.request(() => {
      this.placementFrame = undefined;
      if (this.currentMode === "reader") return;
      this.placeTail();
      if (this.currentMode !== "opening-tail" || !this.openingReady) return;
      if (this.pointerActive || this.touchActive) {
        this.openingStableFrames = 0;
        return;
      }
      this.openingStableFrames = this.isAtBottom() ? this.openingStableFrames + 1 : 0;
      if (this.openingStableFrames >= CHAT_OPENING_SETTLE_FRAMES) {
        this.setMode("tail");
        return;
      }
      this.schedulePlacement();
    });
  }

  private placeTail(): void {
    const viewport = this.viewport;
    if (viewport !== undefined) viewport.scrollTop = viewport.scrollHeight;
  }

  private isAtBottom(): boolean {
    const viewport = this.viewport;
    if (viewport === undefined) return true;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= CHAT_SCROLL_BOTTOM_TOLERANCE;
  }

  private setMode(mode: ChatScrollMode): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.onModeChange?.(mode);
  }

  private cancelPlacement(): void {
    if (this.placementFrame === undefined) return;
    this.frames.cancel(this.placementFrame);
    this.placementFrame = undefined;
  }

}
