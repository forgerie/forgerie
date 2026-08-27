/**
 * Reads the app's design tokens from the one place that defines them.
 *
 * The token block is inlined in the client's index.html on purpose: it carries
 * the fallback palette that paints before a theme loads, and a linked
 * stylesheet would show the flash it exists to prevent. That makes it awkward
 * to import, which is exactly why a harness is tempted to keep its own copy.
 *
 * A copy would be worse than awkward. Every transcript measurement depends on
 * these values -- the gutter, the reading measure, the space ramp -- and a
 * stale copy does not fail loudly. It quietly measures a layout the app does
 * not have. This reads the real block instead.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const APP_INDEX_HTML = "src/client/index.html";
const STYLE_BLOCK = /<style>([\s\S]*?)<\/style>/;

export async function readAppTokenCss(repoRoot = process.cwd()) {
  const html = await readFile(resolve(repoRoot, APP_INDEX_HTML), "utf8");
  const match = STYLE_BLOCK.exec(html);
  if (match === null) throw new Error(`No <style> block in ${APP_INDEX_HTML}; the token source moved.`);
  const css = match[1];
  // A guard against a silent half-match: without the gutter and the measure,
  // the transcript's padding shorthand is invalid and computes to zero, and
  // every box measured downstream is wrong by the padding.
  for (const token of ["--calm-gutter", "--calm-measure", "--pi-text-sm"]) {
    if (!css.includes(`${token}:`)) throw new Error(`Token ${token} missing from ${APP_INDEX_HTML}; the token source moved.`);
  }
  return css;
}

/** Injects the app tokens into a harness page built by Vite. */
export function appTokensPlugin(repoRoot = process.cwd()) {
  return {
    name: "forgerie-app-tokens",
    async transformIndexHtml(html) {
      const css = await readAppTokenCss(repoRoot);
      return html.replace("</head>", `<style>${css}</style></head>`);
    },
  };
}
