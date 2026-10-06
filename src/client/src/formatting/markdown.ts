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
import { canonicalCodeFenceLanguage, CODE_FENCE_LANGUAGES, codeFenceLanguageTag, type CodeFenceLanguageName } from "./codeFenceLanguages";

const codeHighlighter = hljs.newInstance();
const codeLanguageGrammars: Readonly<Record<CodeFenceLanguageName, LanguageFn>> = {
  bash,
  css,
  diff,
  go,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
};
for (const { name, aliases } of CODE_FENCE_LANGUAGES) {
  codeHighlighter.registerLanguage(name, codeLanguageGrammars[name]);
  if (aliases.length > 0) codeHighlighter.registerAliases([...aliases], { languageName: name });
}

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
  const languageTag = codeFenceLanguageTag(info);
  if (languageTag === undefined) return { highlightedCharacters: 0, html: `<pre><code>${escapeHtml(code)}</code></pre>\n` };
  const language = canonicalCodeFenceLanguage(languageTag);
  if (language === undefined || code.length > remainingHighlightCharacters || !canHighlightCode(code, raw)) {
    return { highlightedCharacters: 0, html: `<pre><code class="language-${languageTag}">${escapeHtml(code)}</code></pre>\n` };
  }
  const highlighted = highlightedCode(language, code);
  return {
    highlightedCharacters: code.length,
    html: `<pre><code class="hljs language-${languageTag}">${highlighted}</code></pre>\n`,
  };
}

// Highlighting runs synchronously during Lit render. Large, cumulative, or
// still-open fences stay plain so streaming output cannot monopolize the UI thread.
function canHighlightCode(code: string, raw: string): boolean {
  return code.length <= MAX_HIGHLIGHTED_CODE_CHARACTERS && hasClosingCodeFence(raw);
}

/**
 * Highlighted HTML for one block of code shown outside markdown, such as a
 * script a tool ran. Same highlighter, cache, and size limit as a fenced
 * block; code past the limit is escaped instead of highlighted.
 */
export function highlightedCodeHtml(language: CodeFenceLanguageName, code: string): string {
  return code.length > MAX_HIGHLIGHTED_CODE_CHARACTERS ? escapeHtml(code) : highlightedCode(language, code);
}

function highlightedCode(language: CodeFenceLanguageName, code: string): string {
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

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const TABLE_SCROLL_CLASS = "table-scroll";
const CELL_VALUE_CLASS = "cell-value";

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
  prepareTables(template.content);
  return template.innerHTML;
}

// A markdown table keeps its natural width rather than being squeezed into the
// chat column. Where that width does not fit, the table is laid out as one card
// per row instead -- see formatting/tableReflow.ts -- and the scroll region here
// is what a reader gets when that measurement cannot run.
function prepareTables(root: DocumentFragment): void {
  root.querySelectorAll("table").forEach((table) => {
    labelBodyCells(table);
    keepCellContentTogether(table);
    keepTableSemanticsWhenStacked(table);
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

// A stacked row has no header row above it to read across, so each cell carries
// its own heading. The heading is written here, while the table structure is
// still known, and the style sheet decides whether to show it.
function labelBodyCells(table: HTMLTableElement): void {
  const headings = [...table.querySelectorAll("thead th")].map((heading) => heading.textContent.trim());
  if (headings.length === 0) return;
  // The first column names the record, so a stacked record reads it as a title
  // and does not repeat its heading. The heading is not dropped: it is written
  // once above the records, where it says what the titles are.
  //
  // A two-column table is that case twice over. Its records are a title and one
  // value, so the value's heading would be printed once per record while saying
  // the same word every time -- the noise that made a stacked table something to
  // skip rather than read. Both headings go above the records instead, and the
  // records are left as title and meaning.
  const carriedHeadings = headings.filter((heading) => heading !== "");
  const carryBothHeadings = headings.length === 2 && carriedHeadings.length === 2;
  const recordLabel = carryBothHeadings ? carriedHeadings.join(" \u00b7 ") : headings[0];
  if (recordLabel !== undefined && recordLabel !== "") {
    table.querySelector("tbody")?.setAttribute("data-record-label", recordLabel);
  }
  table.querySelectorAll("tbody tr").forEach((row) => {
    [...row.children].forEach((cell, index) => {
      const heading = headings[index];
      if (heading === undefined || heading === "") return;
      if (carryBothHeadings && index > 0) return;
      cell.setAttribute("data-label", heading);
    });
  });
}

// A stacked cell is one box beside its heading, so what the cell holds has to
// be one box too.
//
// Stacking lays the record out as a grid and the cell borrows its tracks. Every
// child of a grid box is a grid item, so a cell written as `code` plus a few
// words became two items: the code took the value track and the words fell into
// the heading track on the next line. The reader saw one sentence torn in half
// and filed under the wrong heading. One wrapper makes the cell's contents a
// single item again, and inline content inside it stays inline.
function keepCellContentTogether(table: HTMLTableElement): void {
  table.querySelectorAll("tbody td").forEach((cell) => {
    if (cell.childNodes.length === 0) return;
    if (cell.firstElementChild?.classList.contains(CELL_VALUE_CLASS) === true && cell.childNodes.length === 1) return;
    const value = document.createElement("span");
    value.className = CELL_VALUE_CLASS;
    value.append(...cell.childNodes);
    cell.append(value);
  });
}

// Stacking replaces the table display types with block boxes, which drops the
// implicit table roles with them. Naming the roles the elements already have
// changes nothing while the table is a table, and keeps a stacked table
// navigable as a table.
const TABLE_ELEMENT_ROLES: Readonly<Record<string, string>> = {
  TABLE: "table",
  THEAD: "rowgroup",
  TBODY: "rowgroup",
  TFOOT: "rowgroup",
  TR: "row",
  TH: "columnheader",
  TD: "cell",
};

function keepTableSemanticsWhenStacked(table: HTMLTableElement): void {
  for (const element of [table, ...table.querySelectorAll("thead, tbody, tfoot, tr, th, td")]) {
    const role = TABLE_ELEMENT_ROLES[element.tagName];
    if (role !== undefined) element.setAttribute("role", role);
  }
}

function isSafeUrl(url: string): boolean {
  if (url.startsWith("#") || url.startsWith("/")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}
