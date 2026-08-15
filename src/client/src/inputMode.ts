/**
 * The input the reader uses now, not the input the device supports.
 *
 * A capability query such as `(hover: hover)` reports what the hardware can
 * do, and reports it once. A folding phone with a mouse connected reports a
 * coarse pointer and a fine pointer at the same time, so the query must select
 * one, and the selection is wrong for one half of the work.
 *
 * A pointer event carries `pointerType` for each interaction, so the most
 * recent event is the dependable answer. Code that handles a pointer event
 * reads that event directly and needs nothing from this module. CSS cannot
 * read an event, so this module records the answer on the root element as a
 * custom property. The property inherits through the shadow boundary, which is
 * the method `theme.ts` uses for the theme tokens.
 */
export type InputMode = "mouse" | "touch";

/** The property the row actions read to decide whether they exist at all. */
export const ROW_ACTIONS_DISPLAY_PROPERTY = "--pi-row-actions-display";

/**
 * Whether prose may be selected by dragging a finger across it.
 *
 * On a touch platform, a long press on selectable text raises the system
 * selection callout, and the callout takes the pointer stream with it. Any
 * long-press gesture the application defines over prose therefore never fires:
 * the platform wins the race every time, and the gesture reads as broken
 * rather than as unavailable.
 *
 * So while a finger is the input, prose stops being selectable and the hold
 * belongs to the application. Code keeps its selection — see the style rules
 * that consume this — because code is what a reader actually copies out of a
 * transcript, and it is also the one place where a long press has an obvious
 * competing meaning.
 *
 * A mouse is unaffected. It has no long-press gesture to protect, and a drag
 * to select is the only way it has to copy anything.
 */
export const PROSE_USER_SELECT_PROPERTY = "--pi-prose-user-select";

/**
 * The value each mode gives to the row actions.
 *
 * Touch removes the actions instead of hiding them. A transparent control
 * still answers a tap, and on iOS a `:hover` rule stays active after a tap, so
 * a transparent row becomes visible and then stays visible.
 */
const ROW_ACTIONS_DISPLAY: Readonly<Record<InputMode, string>> = {
  mouse: "flex",
  touch: "none",
};

const PROSE_USER_SELECT: Readonly<Record<InputMode, string>> = {
  mouse: "text",
  touch: "none",
};

export interface InputModeTarget {
  readonly style: { setProperty(property: string, value: string): void };
}

export interface InputModeSource {
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: EventListener, options?: EventListenerOptions): void;
}

/**
 * Read `pointerType` from an event without asserting its type.
 *
 * A test supplies a plain object rather than a real `PointerEvent`, so an
 * `instanceof` check would report the wrong answer under test while passing in
 * the browser. The property is read by shape instead.
 */
function pointerTypeOf(event: Event): string | undefined {
  const candidate: unknown = event;
  if (typeof candidate !== "object" || candidate === null) return undefined;
  if (!("pointerType" in candidate)) return undefined;
  const value: unknown = candidate.pointerType;
  return typeof value === "string" ? value : undefined;
}

/**
 * Watch real input and record the mode. Returns a function that stops the
 * watch and removes both listeners.
 *
 * The start value is mouse. Neither affordance is visible when at rest -- the
 * action row waits for a hover, and the swipe waits for a finger -- so the
 * start value displays nothing incorrect. The first touch corrects it.
 */
export function observeInputMode(root: InputModeTarget, source: InputModeSource): () => void {
  let mode: InputMode | undefined;

  const apply = (next: InputMode): void => {
    if (mode === next) return;
    mode = next;
    root.style.setProperty(ROW_ACTIONS_DISPLAY_PROPERTY, ROW_ACTIONS_DISPLAY[next]);
    root.style.setProperty(PROSE_USER_SELECT_PROPERTY, PROSE_USER_SELECT[next]);
  };

  apply("mouse");

  const onPointerDown = (event: Event): void => {
    apply(pointerTypeOf(event) === "touch" ? "touch" : "mouse");
  };

  // A keyboard user drives the same controls as a mouse user: both reach the
  // action row, one by hover and one by focus. So a key press keeps mouse mode
  // rather than adding a third mode that no rule reads.
  const onKeyDown = (): void => {
    apply("mouse");
  };

  const options = { capture: true, passive: true };
  source.addEventListener("pointerdown", onPointerDown, options);
  source.addEventListener("keydown", onKeyDown, options);

  return () => {
    source.removeEventListener("pointerdown", onPointerDown, options);
    source.removeEventListener("keydown", onKeyDown, options);
  };
}
