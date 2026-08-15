/**
 * Variant D — Knob. (Replaces Dial.)
 *
 * Dial had the right idea and the dullest possible input: travel up a fixed
 * distance, arrive at a fixed item. A thumb that can pivot, stir and circle
 * was being asked to behave like a scrollbar, and the list length was capped
 * by how far the thumb could reach.
 *
 * The Knob keeps what Dial was actually for — one target at a time, scrubbed,
 * so the order is taught rather than memorised — and changes the input to a
 * stir. Small circles around the press point advance the list, one detent per
 * 30 degrees. Circular motion has no end, so this is the only variant whose
 * capacity is not bounded by the screen: twelve panels is one turn, twenty-four
 * is two, and the footprint never changes.
 *
 * The nicest property is an accident of the maths. Leaving the dead zone in
 * *any* direction lands on item one, because the first contact defines zero.
 * A flick with no stir at all selects Inbox — so the most common action is
 * also the cheapest, and the stir is only paid for by people who want
 * something further down.
 *
 * The drawn ring is a hint, not a track. Selection reads bearing only, so a
 * lazy stir with a 20px radius works exactly as well as a broad one.
 */

import { angleDelta, bearingOf } from "../fan.js";
import { clamp } from "./shared.js";

/** Rotation per detent. Twelve items to a full turn. */
const STEP_DEG = 30;
const RING_RADIUS = 58;
const TICK_LENGTH = 9;
const MARGIN = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

const polar = (cx, cy, radius, deg) => {
  const radians = (deg * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
};

function line(className, x1, y1, x2, y2) {
  const node = document.createElementNS(SVG_NS, "line");
  node.setAttribute("class", className);
  node.setAttribute("x1", String(x1));
  node.setAttribute("y1", String(y1));
  node.setAttribute("x2", String(x2));
  node.setAttribute("y2", String(y2));
  return node;
}

export const knob = {
  id: "knob",
  title: "Knob",
  blurb: "Stir to scrub. Unbounded list, fixed footprint, flick alone picks Inbox.",
  uses: ["count", "deadzonePx", "side"],

  open({ press, viewport, targets, settings }) {
    const count = Math.min(settings.count, targets.length);
    const anchor = settings.side ?? 180;

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "knob");
    svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
    svg.setAttribute("width", String(viewport.width));
    svg.setAttribute("height", String(viewport.height));

    const track = document.createElementNS(SVG_NS, "circle");
    track.setAttribute("class", "knob-track");
    track.setAttribute("cx", String(press.x));
    track.setAttribute("cy", String(press.y));
    track.setAttribute("r", String(RING_RADIUS));
    svg.append(track);

    // One detent per item, rotating as a group under a fixed read head.
    const dial = document.createElementNS(SVG_NS, "g");
    dial.setAttribute("class", "knob-dial");
    const ticks = [];
    for (let index = 0; index < count; index += 1) {
      const bearing = anchor + index * STEP_DEG;
      const [x1, y1] = polar(press.x, press.y, RING_RADIUS - TICK_LENGTH / 2, bearing);
      const [x2, y2] = polar(press.x, press.y, RING_RADIUS + TICK_LENGTH / 2, bearing);
      const tick = line("knob-tick", x1, y1, x2, y2);
      dial.append(tick);
      ticks.push(tick);
    }
    svg.append(dial);

    const [hx1, hy1] = polar(press.x, press.y, RING_RADIUS - TICK_LENGTH, anchor);
    const [hx2, hy2] = polar(press.x, press.y, RING_RADIUS + TICK_LENGTH + 4, anchor);
    svg.append(line("knob-head", hx1, hy1, hx2, hy2));

    const chip = document.createElement("div");
    chip.className = "knob-chip idle";
    chip.style.left = `${clamp(press.x, MARGIN + 80, viewport.width - MARGIN - 80)}px`;
    chip.style.top = `${clamp(press.y - RING_RADIUS - 34, MARGIN + 22, viewport.height - MARGIN - 22)}px`;

    const glyph = document.createElement("span");
    glyph.className = "glyph";
    const name = document.createElement("span");
    name.className = "name";
    const badge = document.createElement("span");
    badge.className = "badge hidden";
    chip.append(glyph, name, badge);

    /**
     * Rotation carried across moves, so the stir accumulates instead of
     * reading absolute position. This makes `select` stateful — deliberately.
     * The state belongs to one gesture, the closure is that gesture, and an
     * unwrapped total is the only thing that survives crossing 0/360 without
     * jumping the list end to end.
     */
    let previous;
    let turned = 0;

    return {
      nodes: [svg, chip],
      select(candidate) {
        const dx = candidate.x - press.x;
        const dy = candidate.y - press.y;
        if (Math.hypot(dx, dy) < settings.deadzonePx) {
          // The centre is a genuine reset, not a pause. Coming back out starts
          // the list again rather than resuming somewhere unremembered.
          previous = undefined;
          turned = 0;
          return undefined;
        }

        const bearing = bearingOf(dx, dy);
        if (previous === undefined) previous = bearing;
        turned += angleDelta(previous, bearing);
        previous = bearing;
        return clamp(Math.round(turned / STEP_DEG), 0, count - 1);
      },
      paint(hovered) {
        dial.setAttribute("transform", `rotate(${-turned} ${press.x} ${press.y})`);
        ticks.forEach((tick, index) => { tick.classList.toggle("on", index === hovered); });

        const target = hovered === undefined ? undefined : targets[hovered];
        chip.classList.toggle("idle", target === undefined);
        glyph.textContent = target?.glyph ?? "\u00b7";
        const label = target?.label ?? "stir to choose";
        if (name.textContent !== label) name.textContent = label;
        badge.textContent = target?.badge ?? "";
        badge.classList.toggle("hidden", target?.badge === undefined);
      },
    };
  },
};
