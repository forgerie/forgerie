import { defineLanguageFacet, Language, LanguageDescription, LanguageSupport, languageDataProp, ParseContext } from "@codemirror/language";
import type { Facet } from "@codemirror/state";
import { languages } from "@codemirror/language-data";
import { parser as commonmark, parseCode, type MarkdownParser } from "@lezer/markdown";
import type { EditorView } from "@codemirror/view";
import hljs from "highlight.js/lib/common";

/** The language word of a fence's info string: "ts" in "```ts title=x". */
export function codeFenceTag(info: string | undefined): string | undefined {
  return info?.match(/^[a-z0-9_+-]+/iu)?.[0]?.toLowerCase();
}

/**
 * The grammar for a draft's code fence. A draft colours exactly the fences the
 * transcript colours: highlight.js must know the tag. Unknown tags never get a
 * guessed grammar, so "javascript-extra" stays plain.
 */
export function composerCodeLanguage(info: string): LanguageDescription | null {
  const tag = codeFenceTag(info);
  const known = tag === undefined ? undefined : hljs.getLanguage(tag);
  if (tag === undefined || known === undefined) return null;
  return LanguageDescription.matchLanguageName(languages, tag, false)
    ?? LanguageDescription.matchLanguageName(languages, known.name ?? "", false);
}

type MarkdownEditing = typeof import("@codemirror/lang-markdown");
let editing: MarkdownEditing | undefined;
const ownFacet = defineLanguageFacet();

/**
 * CommonMark with fenced code parsed in its own grammar, as lang-markdown's
 * `markdown()` builds it. lang-markdown itself also brings the HTML, CSS, and
 * JavaScript grammars for inline HTML, so it loads after the bar draws. Once it
 * has, the language shares its data facet, and its list and quote commands
 * recognize the draft.
 */
export function composerMarkdown(): LanguageSupport {
  return markdownWith(editing?.commonmarkLanguage.data ?? ownFacet);
}

/** Loads the Markdown list and quote commands. Resolves to the language that they recognize. */
export async function loadMarkdownEditing(): Promise<LanguageSupport> {
  editing ??= await import("@codemirror/lang-markdown");
  return composerMarkdown();
}

/**
 * Continues a list item or quote on a new line. On an empty item it removes
 * the marker, so a second Enter ends the list instead of loosening it with a
 * blank line. False until the commands load.
 */
export const continueMarkup = (view: EditorView): boolean => editing?.insertNewlineContinueMarkupCommand({ nonTightLists: false })(view) ?? false;
/** Backspace removes list or quote markup as a unit. False until the commands load. */
export const deleteMarkup = (view: EditorView): boolean => editing?.deleteMarkupBackward(view) ?? false;

function markdownWith(data: Facet<{ [name: string]: unknown }>): LanguageSupport {
  // lang-markdown's parser carries its facet on the Document node. Before it loads, ours does.
  const base = editing ? editing.commonmarkLanguage.parser as MarkdownParser
    : commonmark.configure({ props: [languageDataProp.add({ Document: data })] });
  return new LanguageSupport(new Language(data, base.configure(parseCode({ codeParser })), [], "markdown"));
}

function codeParser(info: string) {
  const found = composerCodeLanguage(info);
  if (!found) return null;
  // A grammar that is still loading skips its block, then the editor parses it again.
  return found.support ? found.support.language.parser : ParseContext.getSkippingParser(found.load());
}
