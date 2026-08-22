import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";
import { canonicalCodeFenceLanguage, CODE_FENCE_LANGUAGES, type CodeFenceLanguageName } from "../formatting/codeFenceLanguages";

const languageLoaders: Readonly<Record<CodeFenceLanguageName, () => Promise<LanguageSupport>>> = {
  bash: async () => {
    const { shell } = await import("@codemirror/legacy-modes/mode/shell");
    return new LanguageSupport(StreamLanguage.define(shell));
  },
  css: async () => (await import("@codemirror/lang-css")).css(),
  diff: async () => {
    const { diff } = await import("@codemirror/legacy-modes/mode/diff");
    return new LanguageSupport(StreamLanguage.define(diff));
  },
  go: async () => (await import("@codemirror/lang-go")).go(),
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true }),
  json: async () => (await import("@codemirror/lang-json")).json(),
  markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  sql: async () => {
    const { standardSQL } = await import("@codemirror/legacy-modes/mode/sql");
    return new LanguageSupport(StreamLanguage.define(standardSQL));
  },
  typescript: async () => (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true }),
  xml: async () => (await import("@codemirror/lang-html")).html(),
};

const composerCodeLanguageByName = new Map<CodeFenceLanguageName, LanguageDescription>(CODE_FENCE_LANGUAGES.map(({ name, aliases }) => [name, LanguageDescription.of({
  name,
  alias: aliases,
  load: languageLoaders[name],
})] as const));

/** Exact matching mirrors transcript support. Unknown tags never get a guessed grammar. */
export function composerCodeLanguage(info: string): LanguageDescription | null {
  const language = canonicalCodeFenceLanguage(info);
  return language === undefined ? null : composerCodeLanguageByName.get(language) ?? null;
}
