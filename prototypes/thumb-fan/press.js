/**
 * The long-press recogniser, on the same terms the shell already uses.
 *
 * 500 ms and 10 px are not chosen here. They are `ROW_PRESS` from
 * `src/client/src/rowPress.ts`, which the inbox row menu already presses with
 * and which `panelPeekController` already disarms on. The prototype copies
 * them so what it proves is about this app rather than about a new gesture
 * that would have to be reconciled with two existing ones later.
 */

export const PRESS_DEFAULTS = {
  holdMs: 500,
  moveTolerancePx: 10,
};

/**
 * A press is one of four things, and only the last two are the fan's.
 *
 * 'idle' — nothing down.
 * 'waiting' — down, still, the hold not yet served.
 * 'abandoned' — moved too far too early; this press belongs to the scroller.
 * 'armed' — held long enough. The fan is open and tracking.
 */
export function createPressRecogniser(options = {}) {
  const config = { ...PRESS_DEFAULTS, ...options };
  let state = { kind: "idle" };
  let timer;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  return {
    get state() {
      return state;
    },

    /** @returns true when this press is a candidate the caller should track. */
    down(point, pointerId, onArm) {
      clear();
      state = { kind: "waiting", origin: point, pointerId, at: Date.now() };
      timer = setTimeout(() => {
        if (state.kind !== "waiting") return;
        state = { kind: "armed", origin: state.origin, pointerId: state.pointerId, at: state.at };
        onArm(state);
      }, config.holdMs);
      return true;
    },

    move(point, pointerId) {
      if (state.kind === "idle" || state.pointerId !== pointerId) return state;
      if (state.kind === "waiting") {
        const travel = Math.hypot(point.x - state.origin.x, point.y - state.origin.y);
        if (travel > config.moveTolerancePx) {
          clear();
          state = { kind: "abandoned", pointerId };
        }
      }
      return state;
    },

    up(pointerId) {
      if (state.kind !== "idle" && state.pointerId !== pointerId) return state;
      const finished = state;
      clear();
      state = { kind: "idle" };
      return finished;
    },

    cancel() {
      clear();
      state = { kind: "idle" };
    },
  };
}
