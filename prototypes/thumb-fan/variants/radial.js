/**
 * Variant E — Radial.
 *
 * A true pie menu: the full circle, divided into equal wedges, centred on the
 * press. The only variant here whose directions never move.
 *
 * Every other variant rotates its arc to stay on screen, and that rotation is
 * what forced the ordinal promise — "target one is nearest the bottom" — in
 * place of an angular one. A full circle never has to rotate, because there is
 * no direction it can rotate *to*. So Inbox is west, every time, on every
 * press, in every posture. That is the strongest muscle memory available in
 * this set, and it is available on the first day rather than the tenth.
 *
 * Two costs, both real:
 *
 * 1. It contradicts the stated preference. A wheel needs left, right, up and
 *    down; the thumb was said to prefer up and down. Half the wedges sit in
 *    directions that were called unnatural.
 * 2. Near an edge it clips, and clipping cannot be designed away — see
 *    {@link radialGeometry}. Selection still works, because a bearing does not
 *    need to be visible to be flicked toward, but an icon that cannot be drawn
 *    is an icon nobody will discover. `check-fan.mjs --radial-sweep` reports
 *    how much of the screen pays that price.
 */

import { bearingOf } from "../fan.js";
import { clamp } from "./shared.js";

const PREFERRED_RADIUS = 116;
/** Below this the wheel stops shrinking and starts clipping instead. */
const MIN_RADIUS = 62;
const INNER_SHARE = 0.42;
const MARGIN = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

const point = (cx, cy, radius, deg) => {
  const radians = (deg * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
};

const onScreen = (x, y, viewport) => x >= MARGIN && x <= viewport.width - MARGIN
  && y >= MARGIN && y <= viewport.height - MARGIN;

/**
 * The wheel for one press: size, wedge bearings, and where each icon can go.
 *
 * Pure, and exported, so the coverage sweep in `check-fan.mjs` measures the
 * geometry that actually ships rather than a copy of it.
 *
 * Three things are deliberately *not* done to make a clipped wheel fit:
 *
 * - The centre is never moved. Every bearing is measured from the finger, and
 *   moving the centre changes all of them. Fixed bearings are the whole point.
 * - An icon is never slid sideways. That would point it at a wedge it is not.
 * - An icon is never pushed into the hub. A glyph overlapping the hub label
 *   reads as a mistake, and a wrong-looking icon is worse than a missing one.
 *
 * What is allowed is walking an icon *inward along its own ray*, which keeps
 * its direction exactly right. When even the inner edge is off screen, the
 * icon is reported as unplaceable and simply not drawn.
 */
export function radialGeometry({ press, viewport, count, anchor }) {
  const room = Math.min(press.x, press.y, viewport.width - press.x, viewport.height - press.y) - MARGIN;
  const outer = clamp(room, MIN_RADIUS, PREFERRED_RADIUS);
  const inner = outer * INNER_SHARE;
  const step = 360 / count;

  const wedges = [];
  for (let index = 0; index < count; index += 1) {
    const centre = anchor + index * step;
    let glyphRadius;
    for (let radius = (inner + outer) / 2; radius >= inner; radius -= 3) {
      const [x, y] = point(press.x, press.y, radius, centre);
      if (onScreen(x, y, viewport)) { glyphRadius = radius; break; }
    }
    wedges.push({ centre, from: centre - step / 2, to: centre + step / 2, glyphRadius });
  }

  return { outer, inner, step, wedges };
}

/** A donut sector. Sweep flag 1 is clockwise on screen, where y runs down. */
function sectorPath(cx, cy, inner, outer, from, to) {
  const large = to - from > 180 ? 1 : 0;
  const [ax, ay] = point(cx, cy, outer, from);
  const [bx, by] = point(cx, cy, outer, to);
  const [dx, dy] = point(cx, cy, inner, to);
  const [ex, ey] = point(cx, cy, inner, from);
  return `M${ax} ${ay} A${outer} ${outer} 0 ${large} 1 ${bx} ${by}`
    + ` L${dx} ${dy} A${inner} ${inner} 0 ${large} 0 ${ex} ${ey} Z`;
}

export const radial = {
  id: "radial",
  title: "Radial",
  blurb: "A real pie menu. Directions never move \u2014 Inbox is always west.",
  uses: ["count", "deadzonePx", "side"],

  open({ press, viewport, targets, settings }) {
    const count = Math.min(settings.count, targets.length);
    if (count < 2) return undefined;

    const anchor = settings.side ?? 180;
    const { outer, inner, step, wedges } = radialGeometry({ press, viewport, count, anchor });

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "radial");
    svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
    svg.setAttribute("width", String(viewport.width));
    svg.setAttribute("height", String(viewport.height));

    const sectors = [];
    const glyphs = [];

    wedges.forEach((wedge, index) => {
      const sector = document.createElementNS(SVG_NS, "path");
      sector.setAttribute("class", "wedge");
      sector.setAttribute("d", sectorPath(press.x, press.y, inner, outer, wedge.from, wedge.to));
      sector.style.setProperty("--delay", `${index * 16}ms`);
      svg.append(sector);
      sectors.push(sector);

      // A reserved slot keeps its direction and goes dark. Hiding it instead
      // would leave a gap that invites the wheel to re-pack, and re-packing
      // moves every direction after it — the one thing this variant forbids.
      if (targets[index].available === false) sector.classList.add("off");

      if (wedge.glyphRadius === undefined) {
        glyphs.push(undefined);
        return;
      }
      const [gx, gy] = point(press.x, press.y, wedge.glyphRadius, wedge.centre);
      const glyph = document.createElementNS(SVG_NS, "text");
      glyph.setAttribute("class", "wedge-glyph");
      glyph.setAttribute("x", String(gx));
      glyph.setAttribute("y", String(gy));
      glyph.setAttribute("text-anchor", "middle");
      glyph.setAttribute("dominant-baseline", "central");
      glyph.textContent = targets[index].glyph;
      if (targets[index].available === false) glyph.classList.add("off");
      svg.append(glyph);
      glyphs.push(glyph);
    });

    // The name sits in the hub, which is empty by construction and is where the
    // eye already is.
    const hub = document.createElement("div");
    hub.className = "radial-hub idle";
    hub.style.left = `${press.x}px`;
    hub.style.top = `${press.y}px`;
    hub.style.width = `${inner * 2 - 8}px`;
    hub.style.height = `${inner * 2 - 8}px`;

    const hubName = document.createElement("span");
    hubName.className = "name";
    hubName.textContent = "cancel";
    hub.append(hubName);

    return {
      nodes: [svg, hub],
      select(candidate) {
        const dx = candidate.x - press.x;
        const dy = candidate.y - press.y;
        if (Math.hypot(dx, dy) < settings.deadzonePx) return undefined;
        // Bearing alone. Distance past the dead zone is irrelevant, so a wedge
        // that ran off the edge of the screen is still reachable by flicking
        // toward where it would have been.
        const offset = (((bearingOf(dx, dy) - anchor + step / 2) % 360) + 360) % 360;
        return clamp(Math.floor(offset / step), 0, count - 1);
      },
      paint(hovered) {
        sectors.forEach((sector, index) => { sector.classList.toggle("on", index === hovered); });
        for (const [index, glyph] of glyphs.entries()) glyph?.classList.toggle("on", index === hovered);
        const target = hovered === undefined ? undefined : targets[hovered];
        hub.classList.toggle("idle", hovered === undefined);
        hub.classList.toggle("off", target?.available === false);
        // Naming an empty slot still teaches its direction, so the label is
        // shown and qualified rather than withheld.
        const label = target === undefined
          ? "cancel"
          : (target.available === false ? `${target.label} \u00b7 none` : target.label);
        if (hubName.textContent !== label) hubName.textContent = label;
      },
    };
  },
};
