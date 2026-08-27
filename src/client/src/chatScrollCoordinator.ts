export interface ChatScrollViewport {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

const CHAT_SCROLL_BOTTOM_THRESHOLD = 2;

export interface ChatScrollFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

const browserFrameScheduler: ChatScrollFrameScheduler = {
  request(callback: FrameRequestCallback): number {
    return requestAnimationFrame(callback);
  },
  cancel(id: number): void {
    cancelAnimationFrame(id);
  },
};

/** Follows the transcript tail until the reader takes control. */
export class ChatScrollCoordinator {
  private followingTail = true;
  private placementFrame: number | undefined;
  private intentFrame: number | undefined;

  constructor(private readonly frames: ChatScrollFrameScheduler = browserFrameScheduler) {}

  get followsTail(): boolean {
    return this.followingTail;
  }

  reset(): void {
    this.cancelFrames();
    this.followingTail = true;
  }

  dispose(): void {
    this.cancelFrames();
  }

  recordScroll(scroller: ChatScrollViewport): void {
    this.followingTail = distanceFromBottom(scroller) < CHAT_SCROLL_BOTTOM_THRESHOLD;
    if (!this.followingTail) this.cancelPlacement();
  }

  readerIntent(scroller: ChatScrollViewport): void {
    this.cancelFrames();
    this.followingTail = false;
    this.intentFrame = this.frames.request(() => {
      this.intentFrame = undefined;
      this.recordScroll(scroller);
    });
  }

  holdPosition(): void {
    this.cancelFrames();
    this.followingTail = false;
  }

  scheduleTailPlacement(place: () => void): void {
    if (!this.followingTail) return;
    this.cancelPlacement();
    this.placementFrame = this.frames.request(() => {
      this.placementFrame = undefined;
      if (this.followingTail) place();
    });
  }

  private cancelFrames(): void {
    this.cancelPlacement();
    if (this.intentFrame === undefined) return;
    this.frames.cancel(this.intentFrame);
    this.intentFrame = undefined;
  }

  private cancelPlacement(): void {
    if (this.placementFrame === undefined) return;
    this.frames.cancel(this.placementFrame);
    this.placementFrame = undefined;
  }
}

function distanceFromBottom(scroller: ChatScrollViewport): number {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
}
