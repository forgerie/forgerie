/**
 * Variant B — Labels.
 *
 * The proven disc arc, with every name attached to its disc and radiating
 * outward. This is the direct answer to the recognition failure: nothing has
 * to be learned, because nothing is hidden. The ordinal rule stops being a bet
 * and becomes a label you read.
 *
 * The names sit on a wider circle than the discs on purpose. Pills laid
 * directly on the disc arc collide, and no amount of spacing fixes it: on a
 * circle, equal angles give unequal vertical separation, so the ends of the
 * arc always flatten into the axis a wide box is widest in. Pushing the names
 * out to a larger radius buys arc length — the same angle covers more distance
 * further from the centre — which is the one thing that does fix it.
 *
 * The cost is footprint. This is the widest variant here, and it covers the
 * most of the transcript. Whether that matters depends on whether you read
 * behind the fan.
 */

import { fanPoints, layoutFan, selectionAt } from "../fan.js";
import { paintSelection, stagger, targetNode } from "./shared.js";

/** Names ride this far outside the disc arc. */
const NAME_OFFSET = 42;
const MARGIN = 10;
const NAME_BOX = { width: 96, height: 30 };

const clampInto = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

export const labels = {
  id: "labels",
  title: "Labels",
  blurb: "Every name on the arc. Nothing to learn, but it covers the most.",
  uses: ["count", "radiusPx", "originOffsetPx", "spacingDeg", "deadzonePx", "side", "order"],

  open({ press, viewport, targets, settings }) {
    const layout = layoutFan(press, viewport, settings.count, settings.fanOptions);
    if (layout === undefined) return undefined;

    const points = fanPoints(layout);
    const opensLeft = points.every((point) => point.x <= press.x);
    const nameRadius = layout.radius + NAME_OFFSET;

    const discNodes = [];
    const nameNodes = [];

    points.forEach((point, index) => {
      const disc = targetNode(targets[index], "disc", { withBadge: false });
      disc.style.left = `${point.x}px`;
      disc.style.top = `${point.y}px`;
      discNodes.push(disc);

      const radians = (point.bearing * Math.PI) / 180;
      const name = targetNode(targets[index], `name-chip ${opensLeft ? "to-left" : "to-right"}`, { withName: true, withBadge: true });
      name.querySelector(".glyph").remove();
      name.style.left = `${clampInto(
        layout.origin.x + nameRadius * Math.cos(radians),
        opensLeft ? MARGIN + NAME_BOX.width : MARGIN,
        opensLeft ? viewport.width - MARGIN : viewport.width - MARGIN - NAME_BOX.width,
      )}px`;
      name.style.top = `${clampInto(
        layout.origin.y + nameRadius * Math.sin(radians),
        MARGIN + NAME_BOX.height / 2,
        viewport.height - MARGIN - NAME_BOX.height / 2,
      )}px`;
      nameNodes.push(name);
    });

    stagger(discNodes);
    stagger(nameNodes);

    return {
      nodes: [...discNodes, ...nameNodes],
      select: (point) => selectionAt(layout, point, settings.fanOptions),
      paint(hovered) {
        paintSelection(discNodes, hovered);
        paintSelection(nameNodes, hovered);
      },
    };
  },
};
