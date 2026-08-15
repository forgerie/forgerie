/**
 * Variant C — Column.
 *
 * No arc at all. A list appears beside the thumb and selection is pure
 * vertical position: slide up, slide down, release. It takes the stated
 * preference — that up-and-down feels natural and left-to-right does not —
 * literally, instead of approximating it with a mostly-vertical curve.
 *
 * Every name is visible, so there is nothing to learn, and a list beside a
 * finger is a metaphor people already own. The cost is that it is a menu: it
 * looks like software, where the arc looks like a gesture. It also gives up
 * the arc's forgiveness, since a row is a band rather than a wedge.
 */

import { clamp, paintSelection, stagger, targetNode } from "./shared.js";

const ROW_HEIGHT = 46;
const MENU_WIDTH = 168;
const MARGIN = 10;
/** Space between the finger and the near edge of the list. */
const GAP = 18;

export const column = {
  id: "column",
  title: "Column",
  blurb: "A list beside the thumb. Pure up and down, every name visible.",
  uses: ["count", "deadzonePx", "side"],

  open({ press, viewport, targets, settings }) {
    const count = Math.min(settings.count, targets.length);
    const height = count * ROW_HEIGHT;
    if (height + MARGIN * 2 > viewport.height) return undefined;

    // Left unless the thumb is too close to the left edge to fit the list.
    const wantsLeft = settings.side !== 0;
    const fitsLeft = press.x - GAP - MENU_WIDTH >= MARGIN;
    const fitsRight = press.x + GAP + MENU_WIDTH <= viewport.width - MARGIN;
    const onLeft = wantsLeft ? fitsLeft || !fitsRight : !(fitsRight || !fitsLeft);

    const left = onLeft ? press.x - GAP - MENU_WIDTH : press.x + GAP;
    const top = clamp(press.y - height / 2, MARGIN, viewport.height - MARGIN - height);

    // Bottom row first, so the shortest travel is target one — the same
    // ordinal promise the arc variants make.
    const ordered = settings.order === "ordinal"
      ? targets.slice(0, count).reverse()
      : targets.slice(0, count);

    const frame = document.createElement("div");
    frame.className = `column-menu ${onLeft ? "to-left" : "to-right"}`;
    frame.style.left = `${left}px`;
    frame.style.top = `${top}px`;
    frame.style.width = `${MENU_WIDTH}px`;

    const rows = ordered.map((target) => {
      const node = targetNode(target, "row", { withName: true });
      node.style.height = `${ROW_HEIGHT}px`;
      return node;
    });
    stagger(rows, 14);
    frame.append(...rows);

    // Row index in render order; the caller's index space is the same list, so
    // an ordinal reversal has to be undone before reporting a selection.
    const toTargetIndex = (row) => (settings.order === "ordinal" ? count - 1 - row : row);

    return {
      nodes: [frame],
      select(point) {
        const dx = point.x - press.x;
        const dy = point.y - press.y;
        if (Math.hypot(dx, dy) < settings.deadzonePx) return undefined;
        // Moving away from the list is the cancel, so the finger never has to
        // travel back through the rows to escape.
        if (onLeft ? dx > settings.deadzonePx : dx < -settings.deadzonePx) return undefined;

        const row = Math.round((point.y - top - ROW_HEIGHT / 2) / ROW_HEIGHT);
        return toTargetIndex(clamp(row, 0, count - 1));
      },
      paint(hovered) {
        paintSelection(rows, hovered === undefined ? undefined : toTargetIndex(hovered));
      },
    };
  },
};
