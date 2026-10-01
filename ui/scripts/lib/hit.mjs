/**
 * Page-side source for a control's hit rectangle. Controls are drawn at the
 * assistant-ui homepage sizes and reach the 44 px touch size through an
 * invisible, absolutely positioned ::before centred on them (theme.css,
 * "Drawn small, pressed large"). The hit rectangle is the larger of the
 * element's box and that pseudo-element, around the same centre.
 *
 * Use inside an evaluated expression: `(${hitRect})(element)`.
 */
export const hitRect = `(node) => {
  const box = node.getBoundingClientRect();
  const before = getComputedStyle(node, "::before");
  const extends_ = before.content !== "none" && before.position === "absolute";
  const width = Math.max(box.width, extends_ ? parseFloat(before.width) || 0 : 0);
  const height = Math.max(box.height, extends_ ? parseFloat(before.height) || 0 : 0);
  const x = box.left + box.width / 2 - width / 2;
  const y = box.top + box.height / 2 - height / 2;
  return { x, y, width, height, right: x + width, bottom: y + height, drawn: { width: box.width, height: box.height } };
}`;
