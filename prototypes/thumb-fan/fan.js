/**
 * Where a positional fan can open, and what a finger is pointing at.
 *
 * Pure geometry. No DOM, no events, no state — so `check-fan.mjs` can sweep
 * thousands of press points across every posture and prove the fan never puts
 * a target off screen. That is the one failure a positional fan has and an
 * anchored fan does not, so it is the thing worth proving rather than eyeballing.
 *
 * Screen coordinates: x right, y down. Bearings are degrees in [0, 360),
 * 0 = right, 90 = down, 180 = left, 270 = up.
 */

export const FAN_DEFAULTS = {
  /** Distance from the press point to a target centre. */
  radiusPx: 96,
  /** Widest a target disc is allowed to be, on a screen with room to spare. */
  maxDiscPx: 52,
  /** Narrowest a target disc may shrink to before it stops being a touch target. */
  minDiscPx: 42,
  /** Share of the shorter viewport side one disc may occupy. */
  discShare: 0.12,
  /** Overhang past the disc edge for the unread badge. */
  badgeOverhangPx: 4,
  /** Degrees between adjacent targets. */
  spacingDeg: 30,
  /** Travel below which the finger has chosen nothing yet. */
  deadzonePx: 26,
  /** Keep-out band at the viewport edge. */
  marginPx: 10,
  /** Beyond this angular miss the finger is not pointing at anything. */
  slackDeg: 90,
  /**
   * Centre-to-centre distance below which two targets read as one blob.
   *
   * Wider than the disc, not equal to it. Touching circles are legible as
   * shapes and illegible as choices.
   */
  discGapPx: 4,
  /**
   * Share of the shorter viewport side the radius may grow to for room.
   *
   * Half looks extravagant and is not, because {@link selectionAt} picks by
   * bearing: the finger points at a target rather than travelling to it, so a
   * wide fan asks no more of a thumb than a narrow one. Only a corner press on
   * the cover screen ever needs the top of this range.
   */
  maxRadiusShare: 0.5,
  /** 'ordinal' anchors target 1 nearest the bottom; 'sweep' follows the arc. */
  order: "ordinal",
  /**
   * Where the fan opens when it has a choice. 180° is left of the thumb.
   *
   * A right hand holding the tablet pivots its thumb up and down far more
   * comfortably than in and out, so a fan opening to the left turns choosing
   * into a vertical motion. `undefined` restores the older behaviour of simply
   * opening away from the nearest edge, which is the fallback when the
   * preferred side has no room.
   */
  preferredBearingDeg: 180,
  /**
   * How far the fan's centre sits from the press point, along the preferred
   * bearing.
   *
   * Zero puts the arc around the finger, which means the near half of every
   * disc is under the hand that pressed. Moving the centre out clears the
   * hand without asking the thumb to travel further, because the finger still
   * only points.
   *
   * It is not free: from the press point an offset fan subtends a narrower
   * angle, so neighbouring targets sit closer together in pointing terms.
   * `check-fan.mjs` gates that separation rather than trusting it.
   */
  originOffsetPx: 8,
  /** Least angle between neighbours as seen from the finger. */
  minPointingGapDeg: 12,
};

const normalize = (deg) => ((deg % 360) + 360) % 360;

/**
 * How big a target is here.
 *
 * Read from the space the fan actually has rather than fixed, because the
 * cover screen in landscape is 374px tall and a disc sized for the unfolded
 * panel cannot seat five of itself in a corner there. Fixing the number meant
 * the smallest posture silently carried fewer panels than the others; scaling
 * it means every posture carries the same set.
 */
export function fanMetrics(viewport, options = {}) {
  const config = { ...FAN_DEFAULTS, ...options };
  const shorter = Math.min(viewport.width, viewport.height);
  const discPx = Math.round(Math.min(config.maxDiscPx, Math.max(config.minDiscPx, shorter * config.discShare)));
  return {
    discPx,
    targetRadiusPx: discPx / 2 + config.badgeOverhangPx,
    minChordPx: discPx + config.discGapPx,
  };
}

export function bearingOf(dx, dy) {
  return normalize((Math.atan2(dy, dx) * 180) / Math.PI);
}

/** Shortest signed turn from `from` to `to`, in (-180, 180]. */
export function angleDelta(from, to) {
  const raw = normalize(to - from);
  return raw > 180 ? raw - 360 : raw;
}

export function angleDistance(a, b) {
  return Math.abs(angleDelta(a, b));
}

/**
 * The bearing that opens the fan into the screen rather than off it.
 *
 * A thumb arrives from an edge, so the fan should grow away from the edge the
 * press is nearest. On a press in open space the choice barely matters; near a
 * corner it is the difference between a usable fan and a clipped one.
 */
export function awayFromNearestEdge(press, viewport) {
  const gaps = [
    { bearing: 0, gap: press.x },
    { bearing: 180, gap: viewport.width - press.x },
    { bearing: 90, gap: press.y },
    { bearing: 270, gap: viewport.height - press.y },
  ];
  return gaps.reduce((best, entry) => (entry.gap < best.gap ? entry : best)).bearing;
}

function fits(press, viewport, bearing, radius, config) {
  const inset = config.marginPx + fanMetrics(viewport, config).targetRadiusPx;
  const radians = (bearing * Math.PI) / 180;
  const x = press.x + radius * Math.cos(radians);
  const y = press.y + radius * Math.sin(radians);
  return x >= inset && x <= viewport.width - inset && y >= inset && y <= viewport.height - inset;
}

/**
 * Contiguous bearing ranges where a target stays on screen.
 *
 * Sampled at one degree rather than solved analytically: a rectangle can
 * exclude up to two separate arcs, the corner cases are where the errors live,
 * and 360 cheap tests are easier to trust than the closed form.
 *
 * The scan starts at a bearing that is known to be blocked, so no run can
 * straddle the start of the sweep. Scanning from zero instead cut the run that
 * crosses 0° into two fragments, and a press in the bottom-left corner then
 * chose a two-degree sliver over the eighty-degree arc beside it.
 */
export function allowedRuns(press, viewport, radius, config) {
  const ok = [];
  for (let deg = 0; deg < 360; deg += 1) ok.push(fits(press, viewport, deg, radius, config));

  const firstBlocked = ok.indexOf(false);
  if (firstBlocked === -1) return [{ start: 0, span: 359 }];
  if (!ok.includes(true)) return [];

  const runs = [];
  let start;
  let length = 0;
  for (let step = 0; step < 360; step += 1) {
    const deg = (firstBlocked + step) % 360;
    if (ok[deg]) {
      if (start === undefined) {
        start = deg;
        length = 0;
      }
      length += 1;
      continue;
    }
    if (start !== undefined) {
      runs.push({ start, span: length - 1 });
      start = undefined;
    }
  }
  if (start !== undefined) runs.push({ start, span: length - 1 });
  return runs;
}

/**
 * The run the fan should use.
 *
 * The preferred side wins whenever it can seat every target. It loses only to
 * a hard lack of room — a thumb close enough to the left edge that a left-hand
 * fan would hang off the screen — and then the widest run takes over. That
 * order is the point: the side is a standing preference, not a per-press
 * calculation, so the gesture stays the same gesture almost everywhere.
 */
function chooseRun(runs, preferred, requiredSpan) {
  const holding = runs.find((run) => angleDistance(normalize(run.start + run.span / 2), preferred) <= run.span / 2);
  if (holding !== undefined && holding.span >= requiredSpan) return holding;
  return runs.reduce((best, run) => (run.span > best.span ? run : best));
}

/**
 * The smallest angle between two targets that still reads as two targets.
 *
 * Falls with radius, because the same angle covers more distance further out.
 * This is why a corner is fixed by growing the fan rather than shrinking it.
 */
function minSpacingDeg(radius, viewport, config) {
  const ratio = fanMetrics(viewport, config).minChordPx / (2 * radius);
  if (ratio >= 1) return 180;
  return (2 * Math.asin(ratio) * 180) / Math.PI;
}

/**
 * Radii to try, best first.
 *
 * The preferred radius comes first because it is the one tuned to a thumb.
 * After that the search grows rather than shrinks: near a corner a larger
 * circle both sees a wider run of on-screen bearings and needs fewer degrees
 * per target, so growth fixes crowding twice over. It costs nothing to reach,
 * because {@link selectionAt} picks by bearing — the finger points at a
 * target, it does not travel to it.
 */
function radiiToTry(viewport, config) {
  const cap = Math.max(config.radiusPx, Math.min(viewport.width, viewport.height) * config.maxRadiusShare);
  const radii = [config.radiusPx];
  for (let radius = config.radiusPx + 8; radius <= cap; radius += 8) radii.push(radius);
  return radii;
}

/**
 * Where the fan's targets sit for one press.
 *
 * Returns `undefined` only when no radius up to the cap can seat every target
 * without crowding — a viewport smaller than the fan itself. It never drops a
 * target to make room: a panel the reader cannot see is worse than a fan that
 * declines to open, because only one of the two is noticed.
 */
export function layoutFan(press, viewport, count, options = {}) {
  const config = { ...FAN_DEFAULTS, ...options };
  if (count <= 0) return undefined;
  const preferred = config.preferredBearingDeg ?? awayFromNearestEdge(press, viewport);

  // Seat once around the finger to find out which way this press actually
  // opens, then move the centre along *that* bearing.
  //
  // Shifting along the preferred bearing instead does not survive a rotated
  // arc. Near the bottom edge the arc tilts upward while a fixed shift still
  // goes left, and the far end of the fan swings back over the hand. Near the
  // left edge it is worse: the shift removes the room to open left, the arc
  // flips right, and the centre ends up on the far side of the finger from its
  // own targets. Re-seating along the winning side then oscillates, because
  // moving the centre back restores the room to open left.
  //
  // One forward pass — unshifted arc decides the direction, shifted arc is the
  // candidate — cannot oscillate and needs no iteration.
  const base = seat(press, viewport, count, config, 0, preferred);
  if (base === undefined || config.originOffsetPx === 0) return base;

  const shifted = seat(press, viewport, count, config, config.originOffsetPx, arcCentre(base));
  return shifted !== undefined && clearsTheHand(shifted) ? shifted : base;
}

/** Whether every disc sits at least as far from the finger as an unshifted one. */
function clearsTheHand(layout) {
  return layout.points.every((point) => (
    Math.hypot(point.x - layout.press.x, point.y - layout.press.y) >= layout.radius
  ));
}

/** The bearing the arc is centred on, from the fan's own centre. */
export function arcCentre(layout) {
  const first = layout.points[0].bearing;
  const last = layout.points[layout.points.length - 1].bearing;
  return normalize(first + angleDelta(first, last) / 2);
}

function seat(press, viewport, count, config, offset, offsetBearing) {
  const preferred = config.preferredBearingDeg ?? awayFromNearestEdge(press, viewport);
  const origin = offsetOrigin(press, viewport, offsetBearing, offset, config);

  for (const radius of radiiToTry(viewport, config)) {
    const runs = allowedRuns(origin, viewport, radius, config);
    if (runs.length === 0) continue;

    const required = (count - 1) * minSpacingDeg(radius, viewport, config);
    const run = chooseRun(runs, preferred, required);
    if (run.span < required) continue;

    const used = Math.max(required, Math.min(run.span, (count - 1) * config.spacingDeg));
    const centre = clampIntoRun(preferred, run, used);
    const step = count === 1 ? 0 : used / (count - 1);
    const first = normalize(centre - used / 2);

    const bearings = [];
    for (let index = 0; index < count; index += 1) bearings.push(normalize(first + index * step));

    const seated = (config.order === "ordinal" ? orderFromBottom(bearings) : bearings)
      .map((bearing) => {
        const radians = (bearing * Math.PI) / 180;
        return {
          bearing,
          x: origin.x + radius * Math.cos(radians),
          y: origin.y + radius * Math.sin(radians),
        };
      });
    if (!pointingGapsHold(press, seated, config)) continue;

    return { press, origin, radius, run, preferred, points: seated };
  }
  return undefined;
}

/**
 * The fan's centre: the press point, pushed along the preferred bearing.
 *
 * Clamped into the viewport, because an offset applied near an edge would put
 * the centre off screen and every radius would then be searching for room
 * outside the display.
 */
function offsetOrigin(press, viewport, preferred, offset, config) {
  if (offset === 0) return press;
  const radians = (preferred * Math.PI) / 180;
  const margin = config.marginPx;
  return {
    x: clamp(press.x + offset * Math.cos(radians), margin, viewport.width - margin),
    y: clamp(press.y + offset * Math.sin(radians), margin, viewport.height - margin),
  };
}

/**
 * Whether neighbouring targets are far enough apart *as the finger sees them*.
 *
 * An offset fan is further away, so it subtends a narrower angle from the
 * press point than its own arc suggests. Spacing measured on the arc would say
 * the targets are comfortably apart while the thumb has to resolve them within
 * a few degrees. This measures the angle the thumb actually works in.
 */
function pointingGapsHold(press, points, config) {
  const seen = points.map((point) => bearingOf(point.x - press.x, point.y - press.y));
  for (let index = 1; index < seen.length; index += 1) {
    if (angleDistance(seen[index - 1], seen[index]) < config.minPointingGapDeg) return false;
  }
  return true;
}

function clampIntoRun(preferred, run, used) {
  const half = used / 2;
  const offset = normalize(preferred - run.start);
  const inside = offset <= run.span;
  const clamped = inside ? Math.min(Math.max(offset, half), run.span - half) : Math.min(Math.max(run.span / 2, half), run.span - half);
  return normalize(run.start + clamped);
}

/**
 * Put the shortest thumb travel first.
 *
 * A rotating fan cannot promise that a target is always at two o'clock, so it
 * promises order instead: whichever way the arc has turned, target one is the
 * end nearest the bottom of the screen, and the list runs away from there. The
 * reader learns "inbox is the first one going up", which survives the rotation
 * that an angle does not.
 */
function orderFromBottom(bearings) {
  if (bearings.length < 2) return bearings;
  const down = 90;
  const headIsLower = angleDistance(bearings[0], down) <= angleDistance(bearings[bearings.length - 1], down);
  return headIsLower ? bearings : [...bearings].reverse();
}

/** Screen positions for a laid-out fan, in target order. */
export function fanPoints(layout) {
  return layout.points;
}

/**
 * Where the hovered target's name goes: just outside the arc, beside its disc.
 *
 * Not beside the thumb. A left-opening fan puts the space right of the thumb
 * under the reader's own hand, so a name pinned there is a name held behind a
 * palm. Outside the arc is open by construction — the arc opened into the
 * screen — and it labels the disc it names instead of floating near it.
 *
 * With nothing hovered the chip sits outside the middle of the arc, so the
 * cancel hint appears in the same place the names will.
 */
export function captionPoint(layout, viewport, hovered, options = {}) {
  const config = { ...FAN_DEFAULTS, ...options };
  const metrics = fanMetrics(viewport, config);
  const bearing = hovered === undefined ? arcCentre(layout) : layout.points[hovered].bearing;
  const radians = (bearing * Math.PI) / 180;
  // Clear the disc at its hovered scale, then clear the chip's own extent
  // along this bearing. Without the second term the chip sat on the disc it
  // was naming and hid the badge underneath it.
  const chipExtent = Math.abs(Math.cos(radians)) * CAPTION_HALF.x + Math.abs(Math.sin(radians)) * CAPTION_HALF.y;
  const reach = layout.radius + metrics.discPx * 0.58 + 4 + chipExtent;
  const margin = config.marginPx;
  return {
    x: clamp(layout.origin.x + reach * Math.cos(radians), CAPTION_HALF.x + margin, viewport.width - CAPTION_HALF.x - margin),
    y: clamp(layout.origin.y + reach * Math.sin(radians), CAPTION_HALF.y + margin, viewport.height - CAPTION_HALF.y - margin),
  };
}

/** Half the space the name chip needs, at the longest panel title in use. */
const CAPTION_HALF = { x: 38, y: 14 };

function clamp(value, low, high) {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * Which target the finger is on, or `undefined` for none.
 *
 * Nearest bearing wins rather than nearest point, so the finger does not have
 * to travel the full radius — a short push in the right direction selects.
 * That matters most in the grip this is for, where the thumb has little reach
 * and every millimetre of required travel is a millimetre it may not have.
 *
 * The bearing is measured from the press point, never from the fan's centre.
 * Those are different places once the fan is offset, and only one of them is
 * where the thumb is pivoting.
 */
export function selectionAt(layout, point, options = {}) {
  const config = { ...FAN_DEFAULTS, ...options };
  const dx = point.x - layout.press.x;
  const dy = point.y - layout.press.y;
  if (Math.hypot(dx, dy) < config.deadzonePx) return undefined;

  const bearing = bearingOf(dx, dy);
  let best;
  layout.points.forEach((target, index) => {
    const distance = angleDistance(bearing, bearingOf(target.x - layout.press.x, target.y - layout.press.y));
    if (best === undefined || distance < best.distance) best = { index, distance };
  });
  if (best === undefined || best.distance > config.slackDeg) return undefined;
  return best.index;
}
