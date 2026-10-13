/**
 * CSS belongs to the component that uses it (caliper-parts invariant 7).
 * Caliper injects only the stylesheets the entry imports directly. Every other
 * style reaches a frame through the part's own imports, so a component styled
 * by somebody else's import looks right in the app and broken in Caliper.
 */
import { existsSync } from "node:fs";
import ts from "typescript";
import { describe, test } from "vitest";
import {
  ast, BASE_CSS, LIBRARY_CLASS, classSelectors, classesRenderedBy, componentFiles, cssFiles, cssImports, css, ENTRY, expectOnlyPending, GLOBAL_CSS, rel,
  resolveImport, runtimeModules, selectors, TOKENS_CSS,
} from "./source";

const ownedFiles = cssFiles.filter((file) => !GLOBAL_CSS.includes(file));
// Parse each module once, not once per stylesheet: the per-sheet scan outgrew the test timeout.
const sheetsByModule = new Map(runtimeModules.map((module) => [module, cssImports(module)]));
const importersOf = (sheet: string) => runtimeModules.filter((module) => sheetsByModule.get(module)!.includes(sheet));

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

describe("a component loads the styles it renders", () => {
  // A lazy chunk carries only the CSS its own modules import. A class styled by a sheet that some other screen imports
  // looks right in the dev server (which loads every sheet) and after that screen has opened, and unstyled before:
  // the Triggers page drew SettingsFrame with no padding until Settings or Backlog had been opened once.
  /** Modules this one loads with it: static imports only. A dynamic import() is a later chunk, not a guarantee. */
  const staticImports = (file: string) => ast(file).statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) return [(statement.moduleSpecifier as ts.StringLiteral).text];
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) return [(statement.moduleSpecifier as ts.StringLiteral).text];
    return [];
  }).map((specifier) => resolveImport(file, specifier)).filter((target): target is string => target !== undefined);
  const loadedWith = new Map<string, Set<string>>();
  /** Every stylesheet that is loaded whenever this module is: its own imports and those of everything it imports. */
  function sheetsLoadedWith(file: string): Set<string> {
    const known = loadedWith.get(file);
    if (known) return known;
    const sheets = new Set<string>();
    loadedWith.set(file, sheets);
    for (const target of staticImports(file)) {
      if (target.endsWith(".css")) sheets.add(target);
      else if (runtimeModules.includes(target)) for (const sheet of sheetsLoadedWith(target)) sheets.add(sheet);
    }
    return sheets;
  }
  const always = new Set([...GLOBAL_CSS, ...cssImports(ENTRY)]);
  const definedIn = new Map<string, string[]>();
  for (const sheet of cssFiles) for (const name of classSelectors(sheet)) definedIn.set(name, [...(definedIn.get(name) ?? []), sheet]);

  test("every class a component renders is styled by a sheet that loads with it", () => {
    expectOnlyPending("class styled by a sheet the component does not load", componentFiles.flatMap((file) => {
      const loaded = sheetsLoadedWith(file);
      return [...classesRenderedBy(file)].filter((name) => {
        const sheets = definedIn.get(name);
        return sheets !== undefined && !LIBRARY_CLASS.test(name) && !sheets.some((sheet) => always.has(sheet) || loaded.has(sheet));
      }).map((name) => `${rel(file)}: .${name}`);
    }));
  });
});
