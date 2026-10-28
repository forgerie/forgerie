// Which of the input bar's controls stay inline, and which move into its More menu. Pure: the bar measures, this
// decides, and the bar draws the decision. Ported from the approved mockup (prototypes/proposal-ledge, planBar()).
// Every threshold is a measured width, never a breakpoint, so the bar adapts the same way in a pane, on the Fold's
// cover screen and on a phone.

/** A control on the bar's action row, in the order the row draws them. */
export type BarSlot = "context" | "attach" | "handle" | "model" | "dictate" | "more" | "steer" | "send";
/** A control that can move into More. */
export type MovableSlot = "model" | "steer" | "attach" | "dictate";
/** How the handle reads: its counts in words ("3 proposals, 2 queued"), or their total ("5"). */
export type HandleForm = "words" | "total";

/**
 * The row's order. `context` is a readout that shrinks to its least width before anything moves. More ends the left
 * group, so `send` (Send, Queue, Stop, and every primary send of a mode, such as Send answer) keeps the corner.
 */
export const BAR_ORDER: readonly BarSlot[] = ["context", "attach", "handle", "model", "dictate", "more", "steer", "send"];
/** What leaves first. The handle and `send` never leave: the handle only shortens to its total. */
export const OVERFLOW_ORDER: readonly MovableSlot[] = ["model", "steer", "attach", "dictate"];

/** The gap between controls: 4% of the bar, between 8 and 16 px. The row draws the same number. */
export const BAR_GAP = { min: 8, max: 16, share: 0.04 } as const;
export function barGap(barWidth: number): number {
  return Math.min(BAR_GAP.max, Math.max(BAR_GAP.min, Math.round(barWidth * BAR_GAP.share)));
}

/**
 * Natural widths in CSS px. `context` is the readout's least width, not its natural one. The handle has one width for
 * each form. A control the row does not hold needs no width.
 */
export interface BarWidths {
  context?: number | undefined;
  attach?: number | undefined;
  handleWords?: number | undefined;
  handleTotal?: number | undefined;
  model?: number | undefined;
  dictate?: number | undefined;
  more?: number | undefined;
  steer?: number | undefined;
  send?: number | undefined;
}

export interface BarInput {
  /** The width the row's controls share: the row's content box. */
  room: number;
  /** The bar's own width, which sets the gap. */
  barWidth: number;
  widths: BarWidths;
  /** The controls the row holds now. More is never listed: the plan adds it when something moves into it. */
  present: ReadonlySet<BarSlot>;
  /** Movable controls that must stay inline now, such as dictation while it listens. */
  pinned?: ReadonlySet<MovableSlot> | undefined;
}

export interface BarPlan {
  gap: number;
  handle: HandleForm;
  /** The controls in More, in the row's order. Empty: no More. */
  overflow: readonly MovableSlot[];
}

/** The controls a plan draws on the row, in order. More is there only when it holds something. */
export function inlineSlots(plan: Pick<BarPlan, "overflow">, present: ReadonlySet<BarSlot>): BarSlot[] {
  return BAR_ORDER.filter((slot) => slot === "more" ? plan.overflow.length > 0
    : present.has(slot) && !plan.overflow.includes(slot as MovableSlot));
}

function widthOf(slot: BarSlot, handle: HandleForm, widths: BarWidths): number {
  if (slot === "handle") return (handle === "words" ? widths.handleWords : widths.handleTotal) ?? 0;
  return widths[slot] ?? 0;
}

/** The width a plan needs on the row: every inline control and one gap between each pair. */
export function neededWidth(plan: Omit<BarPlan, "gap">, gap: number, widths: BarWidths, present: ReadonlySet<BarSlot>): number {
  const inline = inlineSlots(plan, present);
  return inline.reduce((sum, slot) => sum + widthOf(slot, plan.handle, widths), 0) + gap * Math.max(0, inline.length - 1);
}

/**
 * Walks the ladder and keeps the first step that fits: everything inline with the handle in words; the handle as its
 * total; then the model picker, Steer, Attach and Dictate move into More, one at a time, in that order. When nothing
 * fits, everything movable is in More and the bar keeps its primary actions on the row.
 */
export function planBar({ room, barWidth, widths, present, pinned }: BarInput): BarPlan {
  const gap = barGap(barWidth);
  const steps: Omit<BarPlan, "gap">[] = [{ handle: "words", overflow: [] }];
  if (present.has("handle")) steps.push({ handle: "total", overflow: [] });
  const handle: HandleForm = present.has("handle") ? "total" : "words";
  const movable = OVERFLOW_ORDER.filter((slot) => present.has(slot) && pinned?.has(slot) !== true);
  for (let count = 1; count <= movable.length; count++) steps.push({ handle, overflow: movable.slice(0, count) });
  const last = steps[steps.length - 1]!;
  const fit = steps.find((step) => neededWidth(step, gap, widths, present) <= room) ?? last;
  return { gap, handle: fit.handle, overflow: BAR_ORDER.filter((slot): slot is MovableSlot => fit.overflow.includes(slot as MovableSlot)) };
}

/** Whether two plans draw the same row. */
export const samePlan = (a: BarPlan, b: BarPlan) => a.gap === b.gap && a.handle === b.handle
  && a.overflow.length === b.overflow.length && a.overflow.every((slot, index) => b.overflow[index] === slot);
