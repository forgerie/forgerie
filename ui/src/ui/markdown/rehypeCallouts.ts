import { readCalloutMarker } from "./richBlockSyntax";

// The few hast shapes this plugin touches. Kept local so the renderer does not
// depend on unified's type packages directly.
type HastText = { type: "text"; value: string };
type HastElement = { type: "element"; tagName: string; properties: Record<string, unknown>; children: HastNode[] };
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const isElement = (node: HastNode | undefined, tagName?: string): node is HastElement =>
  node?.type === "element" && (tagName === undefined || (node as HastElement).tagName === tagName);
const isText = (node: HastNode | undefined): node is HastText => node?.type === "text";
const isBlank = (node: HastNode) => isText(node) && node.value.trim() === "";

/**
 * Turns GitHub alert blockquotes (`> [!WARNING]`) into callouts. It removes
 * the marker and records the kind as `data-callout` on the blockquote, which
 * the `blockquote` component reads. Runs after sanitizing, so the attribute
 * comes only from this plugin and never from the reply's own text.
 */
export function rehypeCallouts() {
  return (tree: HastNode) => { visit(tree); };
}

function visit(node: HastNode): void {
  if (isElement(node, "blockquote")) markCallout(node);
  if ("children" in node) for (const child of node.children ?? []) visit(child);
}

function markCallout(quote: HastElement): void {
  const paragraph = quote.children.find((child) => !isBlank(child));
  // Streaming repair drops an unfinished "[!WAR" entirely, which leaves the
  // quote empty until the marker completes.
  if (paragraph === undefined || (isElement(paragraph, "p") && paragraph.children.every(isBlank))) {
    quote.properties["dataCallout"] = "pending";
    return;
  }
  if (!isElement(paragraph, "p")) return;
  const first = paragraph.children[0];
  if (!isText(first)) return;
  const marker = readCalloutMarker(first.value);
  if (marker === undefined) return;
  if (marker.type === "partial") {
    quote.properties["dataCallout"] = "pending";
    paragraph.children.shift();
  } else {
    quote.properties["dataCallout"] = marker.kind;
    first.value = first.value.slice(marker.length);
    if (first.value === "") paragraph.children.shift();
  }
  // A marker on its own line leaves a line break or nothing behind it.
  while (paragraph.children[0] !== undefined && (isBlank(paragraph.children[0]) || isElement(paragraph.children[0], "br"))) paragraph.children.shift();
  if (paragraph.children.length === 0) quote.children.splice(quote.children.indexOf(paragraph), 1);
}
