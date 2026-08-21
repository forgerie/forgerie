// PROTOTYPE DOM helpers. Shared plumbing only, never shared layout.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === false || value === null) continue;
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name.startsWith("on")) node.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === "dataset") for (const [key, entry] of Object.entries(value)) node.dataset[key] = entry;
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Append-only keyed list sync: keeps scroll position and lets rows animate in. */
export function syncList(container, items, key, create, update = () => {}) {
  const seen = new Set();
  for (const item of items) {
    const id = key(item);
    seen.add(id);
    let node = container.querySelector(`[data-key="${id}"]`);
    if (node === null) {
      node = create(item);
      node.dataset.key = id;
      container.append(node);
    }
    update(node, item);
  }
  for (const node of [...container.children]) {
    if (!seen.has(node.dataset.key)) node.remove();
  }
}

export function setFlag(node, name, value) {
  node.classList.toggle(name, Boolean(value));
}
