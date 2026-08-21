import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { marked } from "marked";

type CodeLanguage = readonly [name: string, language: LanguageFn];

const codeHighlighter = hljs.newInstance();
const codeLanguages: readonly CodeLanguage[] = [
  ["bash", bash],
  ["css", css],
  ["diff", diff],
  ["go", go],
  ["javascript", javascript],
  ["json", json],
  ["markdown", markdown],
  ["python", python],
  ["rust", rust],
  ["sql", sql],
  ["typescript", typescript],
  ["xml", xml],
];
for (const [name, language] of codeLanguages) codeHighlighter.registerLanguage(name, language);
codeHighlighter.registerAliases("shell", { languageName: "bash" });

interface StringCacheBudget {
  characters: number;
  readonly maximumCharacters: number;
  readonly maximumEntries: number;
  readonly maximumEntryCharacters: number;
}

const MAX_HIGHLIGHTED_CODE_CHARACTERS = 5_000;
const MAX_HIGHLIGHTED_CODE_CHARACTERS_PER_MARKDOWN = 10_000;
const highlightedCodeCache = new Map<string, string>();
const highlightedCodeCacheBudget: StringCacheBudget = {
  characters: 0,
  maximumCharacters: 1_000_000,
  maximumEntries: 100,
  maximumEntryCharacters: 1_000_000,
};
const markdownHtmlCache = new Map<string, string>();
const markdownHtmlCacheBudget: StringCacheBudget = {
  characters: 0,
  maximumCharacters: 2_000_000,
  maximumEntries: 300,
  maximumEntryCharacters: 500_000,
};

export function toSafeMarkdownHtml(text: string): string {
  const cached = markdownHtmlCache.get(text);
  if (cached !== undefined) return cached;
  const renderer = markdownRenderer();
  const html = marked.parse(text, { async: false, breaks: true, gfm: true, renderer });
  const safeHtml = sanitizeHtml(html);
  rememberString(markdownHtmlCache, markdownHtmlCacheBudget, text, safeHtml);
  return safeHtml;
}

function markdownRenderer() {
  let remainingHighlightCharacters = MAX_HIGHLIGHTED_CODE_CHARACTERS_PER_MARKDOWN;
  const renderer = new marked.Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.code = ({ text, lang, raw }) => {
    const rendered = renderCodeBlock(text, lang, raw, remainingHighlightCharacters);
    remainingHighlightCharacters -= rendered.highlightedCharacters;
    return rendered.html;
  };
  return renderer;
}

interface RenderedCodeBlock {
  readonly highlightedCharacters: number;
  readonly html: string;
}

function renderCodeBlock(text: string, info: string | undefined, raw: string, remainingHighlightCharacters: number): RenderedCodeBlock {
  const code = `${text.replace(/\n$/u, "")}\n`;
  const language = codeFenceLanguage(info);
  if (language === undefined) return { highlightedCharacters: 0, html: `<pre><code>${escapeHtml(code)}</code></pre>\n` };
  if (code.length > remainingHighlightCharacters || !canHighlightCode(language, code, raw)) {
    return { highlightedCharacters: 0, html: `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>\n` };
  }
  const highlighted = highlightedCode(language, code);
  return {
    highlightedCharacters: code.length,
    html: `<pre><code class="hljs language-${language}">${highlighted}</code></pre>\n`,
  };
}

// Highlighting runs synchronously during Lit render. Large, cumulative, or
// still-open fences stay plain so streaming output cannot monopolize the UI thread.
function canHighlightCode(language: string, code: string, raw: string): boolean {
  return code.length <= MAX_HIGHLIGHTED_CODE_CHARACTERS
    && codeHighlighter.getLanguage(language) !== undefined
    && hasClosingCodeFence(raw);
}

function highlightedCode(language: string, code: string): string {
  const cacheKey = `${language}\u0000${code}`;
  const cached = highlightedCodeCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const highlighted = codeHighlighter.highlight(code, { language, ignoreIllegals: true }).value;
  rememberString(highlightedCodeCache, highlightedCodeCacheBudget, cacheKey, highlighted);
  return highlighted;
}

function hasClosingCodeFence(raw: string): boolean {
  const opening = /^ {0,3}(`{3,}|~{3,})/u.exec(raw)?.[1];
  const contentStart = raw.indexOf("\n");
  if (opening === undefined || contentStart < 0) return false;
  const marker = opening[0];
  if (marker === undefined) return false;
  const closing = new RegExp(`(?:^|\\n) {0,3}${marker}{${String(opening.length)},}[\\t ]*\\r?(?:\\n|$)`, "u");
  return closing.test(raw.slice(contentStart + 1));
}

function rememberString(cache: Map<string, string>, budget: StringCacheBudget, key: string, value: string): void {
  const entryCharacters = key.length + value.length;
  if (entryCharacters > budget.maximumEntryCharacters) return;
  const previous = cache.get(key);
  if (previous !== undefined) {
    cache.delete(key);
    budget.characters -= key.length + previous.length;
  }
  cache.set(key, value);
  budget.characters += entryCharacters;
  while (cache.size > budget.maximumEntries || budget.characters > budget.maximumCharacters) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) return;
    const oldestValue = cache.get(oldestKey);
    cache.delete(oldestKey);
    budget.characters -= oldestKey.length + (oldestValue?.length ?? 0);
  }
}

function codeFenceLanguage(info: string | undefined): string | undefined {
  return info?.match(/^[a-z0-9_+-]+/iu)?.[0]?.toLowerCase();
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const TABLE_SCROLL_CLASS = "table-scroll";

function sanitizeHtml(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, style, iframe, object, embed").forEach((node) => { node.remove(); });
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if ((name === "href" || name === "src") && !isSafeUrl(attribute.value)) element.removeAttribute(attribute.name);
    }
    if (element.tagName === "A") {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noreferrer noopener");
    }
  });
  wrapTablesInScrollRegions(template.content);
  return template.innerHTML;
}

// Markdown tables stay at their natural width and scroll horizontally instead of
// being squeezed into the chat column, which is unreadable on narrow screens.
function wrapTablesInScrollRegions(root: DocumentFragment): void {
  root.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains(TABLE_SCROLL_CLASS) === true) return;
    const wrapper = document.createElement("div");
    wrapper.className = TABLE_SCROLL_CLASS;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Table");
    wrapper.setAttribute("tabindex", "0");
    table.before(wrapper);
    wrapper.append(table);
  });
}

function isSafeUrl(url: string): boolean {
  if (url.startsWith("#") || url.startsWith("/")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
