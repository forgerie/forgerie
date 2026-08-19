import { followModeAfterReaderPullback, followModeAfterScroll, followModeAfterTurnOpened, FOLLOW_FREE, FOLLOW_TAIL, type ChatFollowMode, type ChatScrollDriver } from "./chatFollowMode";
import { CHAT_SCROLL_BOTTOM_THRESHOLD, CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD, distanceFromScrollBottom, type ChatScrollViewport } from "./chatScrollPosition";

export interface ChatScrollFrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}

export interface ChatScrollUpdate {
  readonly driver: ChatScrollDriver | "none";
  readonly viewportChanged: boolean;
}

export interface ChatReaderGesture {
  readonly direction: "older" | "newer";
  readonly readerOwned: boolean;
}

export interface ChatScrollSettlement {
  readonly frames: number;
  readonly apply: () => void;
  readonly immediate?: boolean;
  readonly suppressLoadMore?: boolean;
}

const WHEEL_TAKEOVER_DELTA = 1;
const TOUCH_TAKEOVER_DELTA = 6;

const browserFrameScheduler: ChatScrollFrameScheduler = {
  request(callback: FrameRequestCallback): number {
    return requestAnimationFrame(callback);
  },
  cancel(id: number): void {
    cancelAnimationFrame(id);
  },
};

/**
 * Owns transient transcript-scroll policy and animation-frame ordering.
 *
 * The component decides which element represents a turn or saved anchor. This
 * controller decides whether automatic movement is still allowed, makes the
 * latest placement win, and cancels all pending movement when the reader acts.
 */
export class ChatScrollCoordinator {
  private currentMode: ChatFollowMode = FOLLOW_TAIL;
  private lastScrollTop = 0;
  private lastClientHeight = 0;
  private writtenScrollTop: number | undefined;
  private placementFrame: number | undefined;
  private settlementFrame: number | undefined;
  private settlementGeneration = 0;
  private loadMoreSuppressed = false;
  private wheelIntentDelta = 0;
  private touchStartY: number | undefined;

  constructor(private readonly frames: ChatScrollFrameScheduler = browserFrameScheduler) {}

  get mode(): ChatFollowMode {
    return this.currentMode;
  }

  get canLoadMore(): boolean {
    return !this.loadMoreSuppressed;
  }

  reset(): void {
    this.cancelAutomaticMotion();
    this.currentMode = FOLLOW_TAIL;
    this.lastScrollTop = 0;
    this.lastClientHeight = 0;
    this.writtenScrollTop = undefined;
    this.wheelIntentDelta = 0;
    this.touchStartY = undefined;
    this.loadMoreSuppressed = false;
  }

  dispose(): void {
    this.cancelAutomaticMotion();
  }

  follow(mode: ChatFollowMode): void {
    this.currentMode = mode;
  }

  followOpenedTurn(turnKey: string, sentFromHere: boolean): boolean {
    const next = followModeAfterTurnOpened(this.currentMode, turnKey, sentFromHere);
    this.currentMode = next;
    return next.kind === "turn";
  }

  readerWheel(deltaY: number, canScrollUp: boolean, forceTakeover = false): ChatReaderGesture | undefined {
    this.wheelIntentDelta += deltaY;
    if (Math.abs(this.wheelIntentDelta) < WHEEL_TAKEOVER_DELTA) return undefined;
    const intentDelta = this.wheelIntentDelta;
    this.wheelIntentDelta = 0;
    const direction = intentDelta < 0 ? "older" : "newer";
    this.readerTookControl();
    if (forceTakeover) this.currentMode = FOLLOW_FREE;
    else if (direction === "older") this.currentMode = followModeAfterReaderPullback(this.currentMode, canScrollUp);
    return { direction, readerOwned: this.currentMode.kind === "free" };
  }

  readerTouchStart(y: number | undefined): void {
    this.touchStartY = y;
  }

  readerTouchMove(y: number | undefined, canScrollUp: boolean, forceTakeover = false): ChatReaderGesture | undefined {
    if (this.touchStartY === undefined || y === undefined || Math.abs(y - this.touchStartY) < TOUCH_TAKEOVER_DELTA) return undefined;
    const direction = y > this.touchStartY ? "older" : "newer";
    this.touchStartY = y;
    this.readerTookControl();
    if (forceTakeover) this.currentMode = FOLLOW_FREE;
    else if (direction === "older") this.currentMode = followModeAfterReaderPullback(this.currentMode, canScrollUp);
    return { direction, readerOwned: this.currentMode.kind === "free" };
  }

  recordScroll(scroller: ChatScrollViewport, allowReaderControl = true): ChatScrollUpdate {
    const viewportChanged = this.lastClientHeight !== 0 && scroller.clientHeight !== this.lastClientHeight;
    if (viewportChanged) {
      this.lastClientHeight = scroller.clientHeight;
      return { driver: "component", viewportChanged: true };
    }

    const programmatic = this.writtenScrollTop !== undefined && Math.abs(scroller.scrollTop - this.writtenScrollTop) < 1;
    const moved = Math.abs(scroller.scrollTop - this.lastScrollTop) >= 1;
    if (!programmatic && this.currentMode.kind !== "tail" && distanceFromScrollBottom(scroller) < CHAT_SCROLL_BOTTOM_THRESHOLD) this.currentMode = FOLLOW_TAIL;
    if (!programmatic && !moved) {
      this.writtenScrollTop = undefined;
      this.lastClientHeight = scroller.clientHeight;
      return { driver: "none", viewportChanged: false };
    }
    if (!allowReaderControl) {
      this.writtenScrollTop = undefined;
      this.lastScrollTop = scroller.scrollTop;
      this.lastClientHeight = scroller.clientHeight;
      return { driver: programmatic ? "component" : "none", viewportChanged: false };
    }
    const driver: ChatScrollDriver = programmatic ? "component" : "reader";
    if (driver === "reader") this.readerTookControl();
    this.currentMode = followModeAfterScroll(this.currentMode, {
      atBottom: distanceFromScrollBottom(scroller) < CHAT_SCROLL_BOTTOM_THRESHOLD,
      nearBottom: distanceFromScrollBottom(scroller) < CHAT_SCROLL_NEAR_BOTTOM_THRESHOLD,
      scrollingUp: scroller.scrollTop < this.lastScrollTop,
    }, driver);
    this.lastScrollTop = scroller.scrollTop;
    this.lastClientHeight = scroller.clientHeight;
    return { driver, viewportChanged: false };
  }

  sync(scroller: ChatScrollViewport): void {
    this.lastScrollTop = scroller.scrollTop;
    this.lastClientHeight = scroller.clientHeight;
    this.writtenScrollTop = scroller.scrollTop;
  }

  viewportSizeChanged(scroller: Pick<ChatScrollViewport, "clientHeight"> | undefined): boolean {
    return scroller !== undefined && this.lastClientHeight !== 0 && scroller.clientHeight !== this.lastClientHeight;
  }

  syncViewportSize(scroller: Pick<ChatScrollViewport, "clientHeight">): void {
    this.lastClientHeight = scroller.clientHeight;
  }

  schedulePlacement(place: () => void): void {
    this.cancelSettlement();
    this.cancelPlacement();
    this.placementFrame = this.frames.request(() => {
      this.placementFrame = undefined;
      place();
    });
  }

  cancelPlacement(): void {
    if (this.placementFrame === undefined) return;
    this.frames.cancel(this.placementFrame);
    this.placementFrame = undefined;
  }

  settle(settlement: ChatScrollSettlement): void {
    this.cancelPlacement();
    this.cancelSettlement();
    const generation = this.settlementGeneration + 1;
    this.settlementGeneration = generation;
    this.loadMoreSuppressed = settlement.suppressLoadMore === true;
    let appliedFrames = 0;
    const apply = () => {
      if (generation !== this.settlementGeneration) return;
      settlement.apply();
      appliedFrames += 1;
      if (appliedFrames >= settlement.frames) {
        this.finishSettlement(generation);
        return;
      }
      this.settlementFrame = this.frames.request(apply);
    };
    if (settlement.immediate === true) apply();
    else this.settlementFrame = this.frames.request(apply);
  }

  cancelAutomaticMotion(): void {
    this.cancelPlacement();
    this.cancelSettlement();
  }

  withProgrammaticScroll<Result>(scroller: ChatScrollViewport, change: () => Result): Result {
    try {
      return change();
    } finally {
      this.sync(scroller);
    }
  }

  private readerTookControl(): void {
    this.cancelAutomaticMotion();
    this.writtenScrollTop = undefined;
  }

  private cancelSettlement(): void {
    this.settlementGeneration += 1;
    if (this.settlementFrame !== undefined) {
      this.frames.cancel(this.settlementFrame);
      this.settlementFrame = undefined;
    }
    this.loadMoreSuppressed = false;
  }

  private finishSettlement(generation: number): void {
    if (generation !== this.settlementGeneration) return;
    this.settlementFrame = undefined;
    this.loadMoreSuppressed = false;
  }
}
