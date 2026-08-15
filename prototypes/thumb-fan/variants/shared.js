/**
 * Pieces every variant needs, so a variant file contains only its own idea.
 *
 * A variant is one object:
 *
 *   { id, title, blurb, uses, open({ press, viewport, targets, settings }) }
 *
 * `open` builds the surface for a single gesture and returns
 * `{ nodes, select(point), paint(hovered) }`. Building once and painting
 * cheaply is not optional — rebuilding elements on every hover change replays
 * their entry animation and the whole surface blinks. See the README.
 */

export const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

/** A disc, pill, or row that a variant places itself. */
export function targetNode(target, className, { withName, withBadge = true } = {}) {
  const node = document.createElement("div");
  node.className = className;

  const glyph = document.createElement("span");
  glyph.className = "glyph";
  glyph.textContent = target.glyph;
  node.append(glyph);

  if (withName === true) {
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = target.label;
    node.append(name);
  }

  if (withBadge && target.badge !== undefined) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = target.badge;
    node.append(badge);
  }

  return node;
}

/**
 * The one name on screen, for variants that show names one at a time.
 *
 * Kept as a live object rather than rebuilt, and its text guarded, because
 * assigning the same string still replaces the text node.
 */
export function createCaption() {
  const node = document.createElement("div");
  node.className = "caption empty";
  node.textContent = "release to cancel";

  return {
    node,
    set(label) {
      const text = label ?? "release to cancel";
      node.className = `caption${label === undefined ? " empty" : ""}`;
      if (node.textContent !== text) node.textContent = text;
    },
    place({ x, y }) {
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
    },
  };
}

/** Toggle an `on` class across a node list without touching anything else. */
export function paintSelection(nodes, hovered) {
  nodes.forEach((node, index) => { node.classList.toggle("on", index === hovered); });
}

/**
 * Stagger a surface's entry without letting the stagger cause a blink.
 *
 * The delay is written once at build time. Nothing re-reads it, so a hover
 * change cannot restart it.
 */
export function stagger(nodes, stepMs = 16) {
  nodes.forEach((node, index) => { node.style.setProperty("--delay", `${index * stepMs}ms`); });
}
