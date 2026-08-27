/**
 * Finds grid containers that are silently stretching their rows.
 *
 * A grid that does not state align-content takes the initial value, which
 * behaves as stretch: every auto-sized row grows by an equal share of the
 * height the content did not use. Nothing in the stylesheet says so, and the
 * result reads as mysterious padding rather than as a layout decision.
 *
 * The probe is differential rather than static. It sets align-content: start
 * on a candidate, remeasures its children, and restores the previous value.
 * Only a container whose children actually move or resize is reported, so a
 * grid that happens to omit the property while its content already fills the
 * box is not noise. The engine decides, not a regex.
 *
 * The two kinds it can report differ in whether they are usually defects. A
 * spread pulls several rows apart, which reads as unexplained padding between
 * unrelated things. A fill grows one row to the height of its box, which is
 * how a grid centres a single child and is normally what the author wanted.
 *
 * Exported as source text because it runs inside the page over CDP.
 */
export const GRID_STRETCH_PROBE = String.raw`
(() => {
  const TOLERANCE_PX = 1;

  const describe = (element) => {
    const parts = [];
    let node = element;
    while (node) {
      const tag = node.tagName.toLowerCase();
      const classes = typeof node.className === "string" && node.className.trim() !== ""
        ? "." + node.className.trim().split(/\s+/).join(".")
        : "";
      parts.unshift(tag + classes);
      const parent = node.parentElement;
      if (parent) { node = parent; continue; }
      const root = node.getRootNode();
      node = root && root.host ? root.host : undefined;
      if (node) parts.unshift("::shadow");
    }
    return parts.slice(-4).join(" > ");
  };

  // Absolutely positioned children are not grid items, so they neither
  // contribute to row sizing nor move when the rows are packed.
  const gridItems = (element) =>
    Array.from(element.children).filter((child) => {
      const position = getComputedStyle(child).position;
      return position !== "absolute" && position !== "fixed";
    });

  const measure = (items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    return { top: box.top, height: box.height };
  });

  // The computed value resolves to the used size of every row, implicit ones
  // included, so it counts rows rather than items. A five-item single-row grid
  // is laid out across columns and has no rows to pull apart.
  const rowCount = (style) => {
    const tracks = style.gridTemplateRows.trim();
    if (tracks === "" || tracks === "none") return 1;
    return tracks.split(/\s+/).length;
  };

  const probe = (element) => {
    const style = getComputedStyle(element);
    if (style.display !== "grid" && style.display !== "inline-grid") return undefined;
    if (style.alignContent !== "normal" && style.alignContent !== "stretch") return undefined;

    const items = gridItems(element);
    if (items.length === 0) return undefined;

    const before = measure(items);
    const previous = element.style.alignContent;
    element.style.alignContent = "start";
    const after = measure(items);
    if (previous === "") element.style.removeProperty("align-content");
    else element.style.alignContent = previous;

    let spread = 0;
    let inflated = 0;
    for (let index = 0; index < before.length; index += 1) {
      spread = Math.max(spread, Math.abs(before[index].top - after[index].top));
      inflated = Math.max(inflated, before[index].height - after[index].height);
    }
    if (spread <= TOLERANCE_PX && inflated <= TOLERANCE_PX) return undefined;

    const rows = rowCount(style);
    return {
      // A single row cannot be pulled away from anything, so it can only have
      // been grown to fill the box.
      kind: rows > 1 && spread > TOLERANCE_PX ? "spread" : "fill",
      path: describe(element),
      rows,
      items: items.length,
      height: Math.round(element.getBoundingClientRect().height),
      spreadPx: Math.round(spread),
      grownPx: Math.round(inflated),
    };
  };

  const findings = [];
  const walk = (root) => {
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) walk(element.shadowRoot);
      const finding = probe(element);
      if (finding !== undefined) findings.push(finding);
    }
  };
  walk(document);
  return JSON.stringify(findings);
})()
`;
