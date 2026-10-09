/**
 * CSS belongs to the component that uses it (caliper-parts invariant 7).
 * Caliper injects only the stylesheets the entry imports directly. Every other
 * style reaches a frame through the part's own imports, so a component styled
 * by somebody else's import looks right in the app and broken in Caliper.
 */
import { existsSync } from "node:fs";
import { describe, test } from "vitest";
import {
  BASE_CSS, LIBRARY_CLASS, classSelectors, classesRenderedBy, cssFiles, cssImports, css, ENTRY, expectOnlyPending, GLOBAL_CSS, rel,
  runtimeModules, selectors, TOKENS_CSS,
} from "./source";

const ownedFiles = cssFiles.filter((file) => !GLOBAL_CSS.includes(file));
const importersOf = (sheet: string) => runtimeModules.filter((module) => cssImports(module).includes(sheet));

describe("styles load through their owners", () => {
  test("no stylesheet uses @import", () => {
    expectOnlyPending("stylesheet with @import", cssFiles.filter((file) => /@import\b/.test(css(file))).map(rel));
  });

  test("the entry imports the global stylesheets and fonts, nothing else", () => {
    const sheets = cssImports(ENTRY).filter((sheet) => !sheet.startsWith("@fontsource"));
    const missing = GLOBAL_CSS.filter((sheet) => !sheets.includes(sheet)).map((sheet) => `missing ${rel(sheet)}`);
    const extra = sheets.filter((sheet) => !GLOBAL_CSS.includes(sheet)).map((sheet) => `extra ${sheet.startsWith("/") ? rel(sheet) : sheet}`);
    expectOnlyPending("entry stylesheet imports", [...missing, ...extra]);
  });

  test("each component stylesheet is imported only by its sibling component", () => {
    expectOnlyPending("stylesheet not owned by its sibling", ownedFiles.flatMap((file) => {
      const owner = file.replace(/\.css$/, ".tsx");
      const importers = importersOf(file);
      return existsSync(owner) && importers.length === 1 && importers[0] === owner
        ? [] : [`${rel(file)}: imported by ${importers.map(rel).join(", ") || "nothing"}`];
    }));
  });
});

describe("a stylesheet does not reach into another component", () => {
  test("every class in an owned stylesheet is rendered by its owner", () => {
    expectOnlyPending("class not rendered by the stylesheet's owner", ownedFiles.flatMap((file) => {
      const owner = file.replace(/\.css$/, ".tsx");
      if (!existsSync(owner)) return [];
      const rendered = classesRenderedBy(owner);
      return classSelectors(file).filter((name) => !rendered.has(name) && !LIBRARY_CLASS.test(name)).map((name) => `${rel(file)}: .${name}`);
    }));
  });

  test("owned selectors do not target arbitrary children", () => {
    expectOnlyPending("owned selector with a universal child", ownedFiles.flatMap((file) =>
      selectors(file).filter((selector) => /(^|[\s>+~,(])\*/.test(selector)).map((selector) => `${rel(file)}: ${selector}`)));
  });

  test("the global stylesheets hold no component classes", () => {
    // tokens.css names values. base.css styles bare elements. Classes belong to components.
    expectOnlyPending("class in a global stylesheet", [TOKENS_CSS, BASE_CSS].filter(existsSync)
      .flatMap((file) => classSelectors(file).map((name) => `${rel(file)}: .${name}`)));
  });
});
