import type { ReactiveController, ReactiveControllerHost } from "lit";
import { ROW_PRESS, pressTravel } from "../rowPress";
import { radialLayout, radialSelectionAt, type RadialLayout, type RadialPoint, type RadialViewport } from "./radialMenu";

/**
 * The press that opens the radial menu.
 *
 * Timing is not chosen here. It is `ROW_PRESS`, the same hold the inbox row
 * menu uses and the same delay {@link PanelPeekController} stands down at: its
 * still-timer gives up at exactly this point, specifically so a resting press
 * can be handed from the peek to a hold without a gap where neither owns it.
 * Changing the number here without changing it there reopens that gap.
 *
 * The gesture is touch-only. A pointer has a rail and a keyboard has focus;
 * neither needs to hold still for half a second to reach a panel.
 */

/**
 * Closed, waiting, or open — and never two of those at once.
 *
 * `arming` exists as its own case rather than as a boolean beside `open`
 * because the half-second before the wheel appears is a state the reader can
 * see: it draws the closing ring that makes the hold visible. Without it, a
 * press that is arming and a press that is being ignored look identical.
 */
export type RadialMenuState =
  | { readonly kind: "closed" }
  | { readonly kind: "arming"; readonly press: RadialPoint }
  | {
    readonly kind: "open";
    readonly press: RadialPoint;
    readonly layout: RadialLayout;
    readonly hovered: number | undefined;
  };

const RADIAL_CLOSED: RadialMenuState = { kind: "closed" };

export interface RadialMenuControllerOptions {
  /** How many wedges the wheel is divided into. */
  readonly slotCount: () => number;
  /** The space the wheel has to fit inside. */
  readonly viewport: () => RadialViewport;
  /**
   * Whether a press here may open the wheel at all. The shell says no over its
   * own chrome, so a hold on a button is a hold on that button.
   */
  readonly canOpenAt: (event: PointerEvent) => boolean;
  /** Run the chosen slot. Not called for a slot with nothing behind it. */
  readonly onCommit: (slot: number) => void;
  /** Whether a slot has something to open right now. */
  readonly isSlotEnabled: (slot: number) => boolean;
}

export class RadialMenuController implements ReactiveController {
  state: RadialMenuState = RADIAL_CLOSED;

  private origin: { readonly point: RadialPoint; readonly pointerId: number; readonly at: number } | undefined;
  private armTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly host: ReactiveControllerHost, private readonly options: RadialMenuControllerOptions) {
    host.addController(this);
  }

  hostConnected(): void {
    return;
  }

  hostDisconnected(): void {
    this.disarm();
  }

  get isOpen(): boolean {
    return this.state.kind === "open";
  }

  /** How long the ring has to close. Read by the view so the two agree. */
  get holdMs(): number {
    return ROW_PRESS.holdMs;
  }

  onPointerDown(event: PointerEvent): void {
    this.disarm();
    if (event.pointerType !== "touch") return;
    if (!this.options.canOpenAt(event)) return;
    if (hasLiveSelection()) return;

    const point = { x: event.clientX, y: event.clientY };
    this.origin = { point, pointerId: event.pointerId, at: Date.now() };
    this.setState({ kind: "arming", press: point });
    this.armTimer = setTimeout(() => { this.arm(); }, ROW_PRESS.holdMs);
  }

  onPointerMove(event: PointerEvent): void {
    const origin = this.origin;
    if (origin?.pointerId !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };

    if (this.state.kind === "arming") {
      // A selection can appear part-way through a press. When it does, the
      // platform has taken the gesture and the wheel must not fight it.
      const travel = pressTravel(point.x - origin.point.x, point.y - origin.point.y);
      if (hasLiveSelection() || travel > ROW_PRESS.moveTolerancePx) this.close();
      return;
    }

    if (this.state.kind !== "open") return;
    const hovered = radialSelectionAt(this.state.layout, point, this.options.slotCount());
    if (hovered === this.state.hovered) return;
    this.setState({ ...this.state, hovered });
  }

  onPointerUp(event: PointerEvent): void {
    if (this.origin !== undefined && this.origin.pointerId !== event.pointerId) return;
    const state = this.state;
    this.disarm();
    this.setState(RADIAL_CLOSED);

    if (state.kind !== "open" || state.hovered === undefined) return;
    // A reserved slot keeps its direction and absorbs the release. Opening
    // nothing is better than opening something the reader did not aim at, and
    // the bearing still gets practised.
    if (!this.options.isSlotEnabled(state.hovered)) return;
    this.options.onCommit(state.hovered);
  }

  onPointerCancel(): void {
    this.close();
  }

  /**
   * Holds the page still once the wheel is up.
   *
   * Only while open. Claiming the gesture earlier would stop the transcript
   * scrolling under a finger that was only ever trying to scroll it.
   */
  onTouchMove(event: { readonly cancelable: boolean; preventDefault: () => void }): void {
    if (this.state.kind !== "open") return;
    if (event.cancelable) event.preventDefault();
  }

  /** Escape closes the wheel without choosing, like every other overlay. */
  close(): void {
    this.disarm();
    if (this.state.kind !== "closed") this.setState(RADIAL_CLOSED);
  }

  private arm(): void {
    const state = this.state;
    if (state.kind !== "arming") return;
    const layout = radialLayout(state.press, this.options.viewport(), this.options.slotCount());
    if (layout === undefined) {
      this.close();
      return;
    }
    this.setState({ kind: "open", press: state.press, layout, hovered: undefined });
  }

  private disarm(): void {
    if (this.armTimer !== undefined) clearTimeout(this.armTimer);
    this.armTimer = undefined;
    this.origin = undefined;
  }

  private setState(next: RadialMenuState): void {
    this.state = next;
    this.host.requestUpdate();
  }
}

/**
 * A drag that is moving selection handles belongs to the selection. Asked of
 * the document rather than guessed from timing, because a long press that took
 * the text is a fact and the delay before it is not.
 */
function hasLiveSelection(): boolean {
  if (typeof window === "undefined" || typeof window.getSelection !== "function") return false;
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}
