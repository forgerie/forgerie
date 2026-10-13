import type { PluginReadme } from "@shared/pluginsContract";

type Repository = NonNullable<PluginReadme["repository"]>;
type Node = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: Node[] };

/**
 * The README without its opening title when the title only repeats the
 * plugin's name. The page already shows that name as its heading.
 */
export function readmeBody(text: string, names: readonly string[]): string {
  const match = /^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/u.exec(text);
  const title = match?.[1]?.trim().toLowerCase();
  return match && title && names.some((name) => name.trim().toLowerCase() === title) ? text.slice(match[0].length).replace(/^\s*\n/u, "") : text;
}

/** Where a README's own page lives on GitHub, for a link beside its heading. */
export function readmeUrl(readme: PluginReadme): string | undefined {
  return readme.repository && readme.file ? `${readme.repository.blob}${readme.repository.directory}${readme.file}` : undefined;
}

/**
 * A reference in the README, made absolute. Relative paths resolve against
 * the package's GitHub repository, as they do on GitHub: links to its pages,
 * images to its raw files. Without a repository, or for an in-page anchor,
 * there is nothing to open, so the answer is undefined.
 */
export function resolveReadmeReference(reference: string, kind: "link" | "image", repository: Repository | undefined): string | undefined {
  if (/^[a-z][a-z\d+.-]*:/iu.test(reference)) return reference;
  if (reference.startsWith("//")) return `https:${reference}`;
  if (reference.startsWith("#") || !repository || reference.trim() === "") return undefined;
  const path = reference.startsWith("/") ? reference.slice(1) : `${repository.directory}${reference}`;
  try { return new URL(path, kind === "image" ? repository.raw : repository.blob).href; } catch { return undefined; }
}

/**
 * Rehype step that runs before links are hardened. It resolves every link
 * and image, and drops a reference that cannot open, so the reader sees
 * plain text instead of a broken link or a "blocked" marker.
 */
export function rehypeReadmeReferences({ repository }: { repository: Repository | undefined }) {
  return (tree: Node) => {
    function visit(node: Node): void {
      const property = node.tagName === "a" ? "href" : node.tagName === "img" ? "src" : undefined;
      const reference = property ? node.properties?.[property] : undefined;
      if (property && node.properties && typeof reference === "string") {
        const resolved = resolveReadmeReference(reference, property === "src" ? "image" : "link", repository);
        if (resolved === undefined) delete node.properties[property];
        else node.properties[property] = resolved;
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}
