export interface CodeFenceLanguageDefinition {
  readonly name: string;
  readonly aliases: readonly string[];
}

/**
 * The fenced-language vocabulary shared by transcript and composer rendering.
 * Grammar implementations stay at their own boundaries so this metadata module
 * does not couple highlight.js to CodeMirror or force either engine to load.
 */
export const CODE_FENCE_LANGUAGES = [
  { name: "bash", aliases: ["sh", "shell"] },
  { name: "css", aliases: [] },
  { name: "diff", aliases: ["patch"] },
  { name: "go", aliases: ["golang"] },
  { name: "javascript", aliases: ["js", "jsx"] },
  { name: "json", aliases: [] },
  { name: "markdown", aliases: ["md", "mkd", "mkdown"] },
  { name: "python", aliases: ["py"] },
  { name: "rust", aliases: ["rs"] },
  { name: "sql", aliases: [] },
  { name: "typescript", aliases: ["ts", "tsx"] },
  { name: "xml", aliases: ["html", "xhtml", "svg"] },
] as const satisfies readonly CodeFenceLanguageDefinition[];

export type CodeFenceLanguageName = typeof CODE_FENCE_LANGUAGES[number]["name"];

const canonicalLanguageByTag = new Map<string, CodeFenceLanguageName>(CODE_FENCE_LANGUAGES.flatMap(({ name, aliases }) => [name, ...aliases].map((tag) => [tag, name] as const)));

export function codeFenceLanguageTag(info: string | undefined): string | undefined {
  return info?.match(/^[a-z0-9_+-]+/iu)?.[0]?.toLowerCase();
}

export function canonicalCodeFenceLanguage(info: string | undefined): CodeFenceLanguageName | undefined {
  const tag = codeFenceLanguageTag(info);
  return tag === undefined ? undefined : canonicalLanguageByTag.get(tag);
}
