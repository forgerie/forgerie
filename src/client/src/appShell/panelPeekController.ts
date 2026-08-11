import type { ReactiveController, ReactiveControllerHost } from "lit";
import { ROW_PRESS } from "../rowPress";
import type { ShellPanel } from "./panelIntent";
import { PANEL_PEEK, PEEK_CLOSED, peekProgress, peekedPanel, releasePeek, trackPeek, type PanelPeek, type PeekConfig } from "./panelPeek";

/**
 * How long a still finger may rest before the drag is given up.
 *
 * Tied to the row hold rather than chosen separately: a shorter window leaves a
 * gap where the peek has quit and the hold has not yet fired, and a press that
 * lands in it does nothing at all. At this length the press is handed straight
 * from one to the other, which is also the point where a long press has taken
 * the text under it.
 */
const PEEK_STILL_MS = ROW_PRESS.holdMs;

/** A trackpad sends its horizontal travel in pieces; this ends the gesture. */
const WHEEL_SETTLE_MS = 120;

export interface PanelPeekControllerOptions {
  readonly config?: PeekConfig | undefined;
  /** Whether a panel is hidden, and so worth peeking at. */
  readonly peekable: (panel: ShellPanel) => boolean;
  /** How wide the sheet is when fully pulled. */
  readonly sheetWidth: (panel: ShellPanel) => number;
}

interface PeekOrigin {
  readonly x: number;
  readonly y: number;
  readonly pointerId: number;
}

/**
 * The part of a touch move this controller needs. `TouchEvent` satisfies it, so
 * the shell hands one straight over, and a test can hand over the same facts
 * without a browser to make them in.
 */
export interface HorizontalClaim {
  readonly touches: ArrayLike<{ readonly clientX: number; readonly clientY: number }>;
  readonly cancelable: boolean;
  preventDefault: () => void;
}

/**
 * Turns pointer and wheel travel into a peek.
 *
 * The same travel arrives from a finger and from two fingers on a trackpad, so
 * both feed one pipeline and a trackpad earns the same rubber-band look. The
 * controller decides only whether a drag belongs to the shell; where the sheet
 * sits is {@link trackPeek}'s answer, and it is pure.
 */
export class PanelPeekController implements ReactiveController {
  peek: PanelPeek = PEEK_CLOSED;
  private readonly config: PeekConfig;
  private origin: PeekOrigin | undefined;
  private stillTimer: ReturnType<typeof setTimeout> | undefined;
  private wheelTravel = 0;
  private wheelTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly host: ReactiveControllerHost, private readonly options: PanelPeekControllerOptions) {
    host.addController(this);
    this.config = options.config ?? PANEL_PEEK;
  }

  hostConnected(): void {
    return;
  }

  hostDisconnected(): void {
    this.disarm();
    this.clearWheel();
  }

  get panel(): ShellPanel | undefined {
    return peekedPanel(this.peek);
  }

  progress(panel: ShellPanel): number {
    return peekProgress(this.peek, panel);
  }

  get isOpen(): boolean {
    return this.peek.kind === "open";
  }

  /** True while a finger is on the sheet, so the renderer can drop its easing. */
  get isTracking(): boolean {
    return this.peek.kind === "tracking";
  }

  close(): void {
    this.disarm();
    this.setPeek(PEEK_CLOSED);
  }

  onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== "touch") return;
    this.disarm();
    // A drag that starts inside something that scrolls sideways belongs to it.
    if (ownsHorizontalScroll(composedElements(event))) return;
    if (this.hasLiveSelection()) return;

    this.origin = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    this.stillTimer = setTimeout(() => { this.disarm(); }, PEEK_STILL_MS);
  }

  onPointerMove(event: PointerEvent): void {
    const origin = this.origin;
    if (origin?.pointerId !== event.pointerId) return;
    // A selection can appear part-way through a press. When it does, the drag is
    // moving its handles and stops being the shell's.
    if (this.hasLiveSelection()) {
      this.disarm();
      return;
    }
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    // Movement means this was never a resting press.
    if (Math.abs(dx) >= this.config.capturePx) this.clearStillTimer();
    this.setPeek(this.track(dx, dy));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.origin?.pointerId !== event.pointerId) return;
    this.disarm();
    this.setPeek(releasePeek(this.peek, this.config));
  }

  onPointerCancel(): void {
    this.disarm();
    this.setPeek(releasePeek(this.peek, this.config));
  }

  /**
   * Claims a horizontal drag before the browser scrolls with it.
   *
   * Without this the compositor takes the gesture at its own slop distance and
   * sends `pointercancel`, so the sheet never moves however good the arithmetic
   * is. `touch-action: pan-y` would also stop the theft, but it intersects down
   * the ancestor chain: a diff or a table inside the transcript could no longer
   * be pushed sideways with a finger, and a child cannot re-enable what a
   * parent forbade. Claiming per gesture keeps both.
   *
   * The claim is made on direction alone, before the capture distance, because
   * the browser decides earlier than the sheet does.
   */
  onTouchMove(event: HorizontalClaim): void {
    if (!this.claimsHorizontal(event)) return;
    if (event.cancelable) event.preventDefault();
  }

  private claimsHorizontal(event: HorizontalClaim): boolean {
    const origin = this.origin;
    const touch = event.touches[0];
    if (origin === undefined || touch === undefined || this.hasLiveSelection()) return false;
    const dx = Math.abs(touch.clientX - origin.x);
    const dy = Math.abs(touch.clientY - origin.y);
    return dx > dy && dx > 0;
  }

  /**
   * A drag that is moving selection handles belongs to the selection. The peek
   * asks the document rather than guessing from timing, because a long press
   * that took the text is a fact and the delay before it is not.
   */
  private hasLiveSelection(): boolean {
    if (typeof window === "undefined" || typeof window.getSelection !== "function") return false;
    const selection = window.getSelection();
    return selection !== null && !selection.isCollapsed;
  }

  /**
   * Two fingers on a trackpad. The browser reports travel rather than position,
   * so the controller keeps the running total and settles the gesture on a
   * pause instead of on a release it never receives.
   */
  onWheel(event: WheelEvent): void {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    if (ownsHorizontalScroll(composedElements(event))) return;

    // The wheel reports the content's movement, which runs against the finger.
    this.wheelTravel -= event.deltaX;
    this.setPeek(this.track(this.wheelTravel, 0));
    if (this.peek.kind !== "closed") event.preventDefault();

    if (this.wheelTimer !== undefined) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => { this.settleWheel(); }, WHEEL_SETTLE_MS);
  }

  private track(dx: number, dy: number): PanelPeek {
    const panel = peekedPanel(this.peek) ?? (dx > 0 ? "navigation" : "workspace");
    return trackPeek({
      current: this.peek,
      dx,
      dy,
      sheetWidthPx: this.options.sheetWidth(panel),
      peekable: this.options.peekable,
      config: this.config,
    });
  }

  private settleWheel(): void {
    this.clearWheel();
    this.setPeek(releasePeek(this.peek, this.config));
  }

  private clearWheel(): void {
    if (this.wheelTimer !== undefined) clearTimeout(this.wheelTimer);
    this.wheelTimer = undefined;
    this.wheelTravel = 0;
  }

  private disarm(): void {
    this.clearStillTimer();
    this.origin = undefined;
  }

  private clearStillTimer(): void {
    if (this.stillTimer !== undefined) clearTimeout(this.stillTimer);
    this.stillTimer = undefined;
  }

  private setPeek(peek: PanelPeek): void {
    if (peek === this.peek) return;
    if (peek.kind === this.peek.kind && peekedPanel(peek) === peekedPanel(this.peek)
      && peekProgressOf(peek) === peekProgressOf(this.peek)) return;
    this.peek = peek;
    this.host.requestUpdate();
  }
}

function peekProgressOf(peek: PanelPeek): number {
  return peek.kind === "tracking" ? peek.progress : 0;
}

/**
 * Whether anything under the pointer scrolls sideways and has somewhere to go.
 *
 * A drag that reaches the end of such an element does not carry on into the
 * sheet: chaining would open a panel every time a reader ran out of diff, so
 * the sheet asks for a gesture of its own.
 */
export function ownsHorizontalScroll(elements: readonly Element[]): boolean {
  return elements.some((element) => element.scrollWidth > element.clientWidth);
}

function composedElements(event: Event): readonly Element[] {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const elements: Element[] = [];
  for (const target of path) {
    if (target instanceof Element) elements.push(target);
  }
  return elements;
}
