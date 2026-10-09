import { UNAVAILABLE_FILE_ORIGIN } from "./linkScope";

type Node = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };

/** Resolve references before hardening. The hardener otherwise drops the host of // URLs and rewrites ./ references against the app root. */
export function rehypeLinkBase({ origin }: { origin: string }) {
  return (tree: Node) => {
    function visit(node: Node): void {
      const property = node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : undefined;
      const reference = property && node.properties?.[property];
      if (property && node.properties && typeof reference === "string" && !reference.startsWith("#")) {
        try {
          const url = new URL(reference, origin);
          const relative = !/^[a-z][a-z\d+.-]*:/iu.test(reference) && !reference.startsWith("/");
          // A relative file must not escape the registered preview route through ../.
          node.properties[property] = relative && origin.includes("/preview/") && !url.href.startsWith(origin)
            ? UNAVAILABLE_FILE_ORIGIN : url.href;
        } catch { delete node.properties[property]; }
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}
