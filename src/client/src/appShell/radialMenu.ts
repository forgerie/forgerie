/**
 * Where a radial menu's wedges sit, and which one a finger is pointing at.
 *
 * The wheel is the one summon surface whose directions never move. Every other
 * arrangement the shell could offer has to rotate to stay on screen, and a
 * rotating arrangement can only promise an order — "the first one going up" —
 * because its angles change with the press point. A full circle has no
 * direction it can rotate to, so a slot's bearing is the same on every press,
 * in every posture. That is what makes the gesture learnable by hand instead
 * of by reading.
 *
 * Three consequences follow, and all three are load-bearing:
 *
 * - The centre is never moved to make the wheel fit. Every bearing is measured
 *   from the finger, so moving the centre would change all of them at once.
 * - Selection is by bearing alone. Distance past the dead zone carries no
 *   meaning, so a wedge that ran off the edge of the screen is still reachable
 *   by flicking toward where it would have been.
 * - When the wheel cannot fit, it shrinks. Size is negotiable; direction is not.
 *
 * Screen coordinates: x right, y down. Bearings are degrees in [0, 360),
 * 0 = right, 90 = down, 180 = left, 270 = up.
 */

export interface RadialPoint {
  readonly x: number;
  readonly y: number;
}

export interface RadialViewport {
  readonly width: number;
  readonly height: number;
}

export interface RadialWedge {
  readonly slot: number;
  /** Bearing of the wedge's middle. Constant for a given slot. */
  readonly centre: number;
  readonly from: number;
  readonly to: number;
  /**
   * How far along its own ray this wedge's icon can sit and still be on
   * screen, or `undefined` when no such distance exists.
   */
  readonly glyphRadius: number | undefined;
}

export interface RadialLayout {
  readonly press: RadialPoint;
  readonly outer: number;
  readonly inner: number;
  readonly step: number;
  readonly wedges: readonly RadialWedge[];
}

export interface RadialConfig {
  /** The wheel's radius when there is room for it. */
  readonly preferredRadiusPx: number;
  /** Below this the wheel stops shrinking and starts clipping instead. */
  readonly minRadiusPx: number;
  /** Hub radius, as a share of the outer radius. */
  readonly innerShare: number;
  /** Keep-out band at the viewport edge. */
  readonly marginPx: number;
  /** Travel below which the finger has chosen nothing. */
  readonly deadzonePx: number;
  /** Bearing of slot zero. Left, for a right hand. */
  readonly anchorDeg: number;
}

export const RADIAL_MENU: RadialConfig = {
  preferredRadiusPx: 116,
  minRadiusPx: 62,
  innerShare: 0.42,
  marginPx: 10,
  deadzonePx: 26,
  anchorDeg: 180,
};

const normalize = (deg: number): number => ((deg % 360) + 360) % 360;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

function polar(centre: RadialPoint, radius: number, deg: number): RadialPoint {
  const radians = (deg * Math.PI) / 180;
  return { x: centre.x + radius * Math.cos(radians), y: centre.y + radius * Math.sin(radians) };
}

function onScreen(point: RadialPoint, viewport: RadialViewport, margin: number): boolean {
  return point.x >= margin && point.x <= viewport.width - margin
    && point.y >= margin && point.y <= viewport.height - margin;
}

/** Bearing from one point to another. */
export function radialBearing(from: RadialPoint, to: RadialPoint): number {
  return normalize((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

/**
 * The bearing a slot always points at.
 *
 * Exported because the keyboard path and any documentation of the wheel must
 * name the same direction the pointer path uses. Two copies of this arithmetic
 * would be two chances to disagree about where "west" is.
 */
export function radialSlotBearing(slot: number, count: number, config: RadialConfig = RADIAL_MENU): number {
  return normalize(config.anchorDeg + slot * (360 / count));
}

/**
 * The wheel for one press.
 *
 * Icons are walked *inward along their own ray* when the edge is close. That is
 * the only adjustment allowed: it leaves the wedge pointing exactly where it
 * always points. Sliding an icon sideways would aim it at a wedge it is not,
 * and pushing it into the hub would put it under the label. When neither the
 * mid-radius nor anything down to the hub is on screen, the icon is reported
 * as unplaceable and the caller draws no icon rather than a misleading one.
 */
export function radialLayout(
  press: RadialPoint,
  viewport: RadialViewport,
  count: number,
  overrides: Partial<RadialConfig> = {},
): RadialLayout | undefined {
  const config = { ...RADIAL_MENU, ...overrides };
  if (count < 2) return undefined;

  const room = Math.min(press.x, press.y, viewport.width - press.x, viewport.height - press.y) - config.marginPx;
  const outer = clamp(room, config.minRadiusPx, config.preferredRadiusPx);
  const inner = outer * config.innerShare;
  const step = 360 / count;

  const wedges: RadialWedge[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const centre = radialSlotBearing(slot, count, config);
    let glyphRadius: number | undefined;
    for (let radius = (inner + outer) / 2; radius >= inner; radius -= 3) {
      if (onScreen(polar(press, radius, centre), viewport, config.marginPx)) {
        glyphRadius = radius;
        break;
      }
    }
    wedges.push({ slot, centre, from: centre - step / 2, to: centre + step / 2, glyphRadius });
  }

  return { press, outer, inner, step, wedges };
}

/** Screen position of a wedge's icon, for a placeable wedge. */
export function radialGlyphPoint(layout: RadialLayout, wedge: RadialWedge): RadialPoint | undefined {
  if (wedge.glyphRadius === undefined) return undefined;
  return polar(layout.press, wedge.glyphRadius, wedge.centre);
}

/**
 * Which slot the finger is on, or `undefined` for none.
 *
 * Measured from the press point rather than the wheel's drawn centre. They are
 * the same point today and must stay the same point: the press is where the
 * thumb pivots, and the pivot is what the reader is aiming from.
 */
export function radialSelectionAt(
  layout: RadialLayout,
  point: RadialPoint,
  count: number,
  overrides: Partial<RadialConfig> = {},
): number | undefined {
  const config = { ...RADIAL_MENU, ...overrides };
  const dx = point.x - layout.press.x;
  const dy = point.y - layout.press.y;
  if (Math.hypot(dx, dy) < config.deadzonePx) return undefined;

  const step = 360 / count;
  const offset = normalize(radialBearing(layout.press, point) - config.anchorDeg + step / 2);
  return clamp(Math.floor(offset / step), 0, count - 1);
}

/**
 * An SVG donut sector.
 *
 * Sweep flag 1 is clockwise on screen, because y runs down. Kept here beside
 * the geometry rather than in the component so the shape and the hit test are
 * derived from one set of numbers.
 */
export function radialSectorPath(layout: RadialLayout, wedge: RadialWedge): string {
  const { press, inner, outer } = layout;
  const large = wedge.to - wedge.from > 180 ? "1" : "0";
  const a = polar(press, outer, wedge.from);
  const b = polar(press, outer, wedge.to);
  const c = polar(press, inner, wedge.to);
  const d = polar(press, inner, wedge.from);
  const outerRadius = String(outer);
  const innerRadius = String(inner);
  return `M${String(a.x)} ${String(a.y)} A${outerRadius} ${outerRadius} 0 ${large} 1 ${String(b.x)} ${String(b.y)}`
    + ` L${String(c.x)} ${String(c.y)} A${innerRadius} ${innerRadius} 0 ${large} 0 ${String(d.x)} ${String(d.y)} Z`;
}
