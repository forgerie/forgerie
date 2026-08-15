/**
 * Variant A — Discs.
 *
 * The original idea, with the critique's legibility findings applied: resting
 * discs carry a border that clears 3:1 against the scrim, the scrim is heavy
 * enough that the transcript stops competing, and the dead zone is no longer
 * drawn as a circle that reads as a sixth, empty target.
 *
 * Position: fastest to point at, hardest to learn. Five glyphs and one name.
 */

import { captionPoint, fanPoints, layoutFan, selectionAt } from "../fan.js";
import { createCaption, paintSelection, stagger, targetNode } from "./shared.js";

export const discs = {
  id: "discs",
  title: "Discs",
  blurb: "Icon arc, one name at a time. Fastest to point at, hardest to learn.",
  uses: ["count", "radiusPx", "originOffsetPx", "spacingDeg", "deadzonePx", "side", "order"],

  open({ press, viewport, targets, settings }) {
    const layout = layoutFan(press, viewport, settings.count, settings.fanOptions);
    if (layout === undefined) return undefined;

    const points = fanPoints(layout);
    const caption = createCaption();
    const discNodes = points.map((point, index) => {
      const node = targetNode(targets[index], "disc");
      node.style.left = `${point.x}px`;
      node.style.top = `${point.y}px`;
      return node;
    });
    stagger(discNodes);

    return {
      nodes: [...discNodes, caption.node],
      select: (point) => selectionAt(layout, point, settings.fanOptions),
      paint(hovered) {
        paintSelection(discNodes, hovered);
        caption.set(hovered === undefined ? undefined : targets[hovered].label);
        caption.place(captionPoint(layout, viewport, hovered));
      },
    };
  },
};
