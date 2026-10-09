/**
 * Shared reading for the decomposition gates (ui/docs/decomposition.md).
 *
 * The gates read the source without running it, the way Caliper does. Each file
 * under src/ is one kind. The kind comes from its path and name, so a gate and a
 * reader agree on it without opening the file.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { expect } from "vitest";

export const UI_ROOT = resolve(import.meta.dirname, "..");
export const SRC = join(UI_ROOT, "src");
/** The shared space. Only system components and their logic live here. */
export const SYSTEM = join(SRC, "ui");
/** The two global stylesheets. The entry imports them; every other stylesheet belongs to one component. */
export const TOKENS_CSS = join(SYSTEM, "tokens.css");
export const BASE_CSS = join(SYSTEM, "base.css");
export const GLOBAL_CSS = [TOKENS_CSS, BASE_CSS];
export const ENTRY = join(SRC, "main.tsx");

export const LAYERS = ["page", "template", "organism", "molecule", "atom"] as const;
export type Layer = (typeof LAYERS)[number];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export const allFiles = walk(SRC).sort();
export const rel = (file: string) => relative(SRC, file);

const sourceCache = new Map<string, string>();
export function read(file: string): string {
  let text = sourceCache.get(file);
  if (text === undefined) { text = readFileSync(file, "utf8"); sourceCache.set(file, text); }
  return text;
}
/** CSS without comments, so explanatory prose never counts as a selector or a value. */
export const css = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, "");

export const isTest = (file: string) => /\.test\.tsx?$/.test(file) || basename(file) === "testSetup.ts";
export const isPart = (file: string) => file.endsWith(".part.tsx");
/** One binding per screen: the only files below the entry that read stores, contexts, or the network. */
export const isBinding = (file: string) => file.endsWith(".binding.tsx");
export const isFixture = (file: string) => file.split("/").includes("fixtures");
export const isSystemFile = (file: string) => file.startsWith(`${SYSTEM}/`);

/** A file that renders a surface of its own: a system component or a shape. */
export const componentFiles = allFiles.filter((file) => file.endsWith(".tsx")
  && !isPart(file) && !isTest(file) && !isBinding(file) && !isFixture(file) && file !== ENTRY);
export const systemComponents = componentFiles.filter(isSystemFile);
/** A shape arranges one screen with domain words. It lives in a feature folder, not in the shared space. */
export const shapeComponents = componentFiles.filter((file) => !isSystemFile(file));
export const bindingFiles = allFiles.filter(isBinding);
export const partFiles = allFiles.filter(isPart);
export const cssFiles = allFiles.filter((file) => file.endsWith(".css"));
export const runtimeModules = allFiles.filter((file) => /\.tsx?$/.test(file) && !isTest(file) && !file.endsWith(".d.ts"));

/** The layer a part declares: a literal `layer` export wins over the file-name suffix. */
export function partLayer(part: string): string | undefined {
  const exported = read(part).match(/^export const layer\s*=\s*"([a-z]+)"/m)?.[1];
  return exported ?? basename(part).split(".").at(-3);
}
/** The component a part sits beside: `Name.<layer>.part.tsx` shows `Name.tsx`. */
export const partComponent = (part: string) => join(dirname(part), `${basename(part).split(".")[0]}.tsx`);
export function componentPart(component: string): string | undefined {
  const name = basename(component, ".tsx");
  return partFiles.find((part) => dirname(part) === dirname(component) && basename(part).split(".")[0] === name);
}
export function componentLayer(component: string): Layer | undefined {
  const part = componentPart(component);
  const layer = part ? partLayer(part) : undefined;
  return LAYERS.includes(layer as Layer) ? (layer as Layer) : undefined;
}

const astCache = new Map<string, ts.SourceFile>();
export function ast(file: string): ts.SourceFile {
  let tree = astCache.get(file);
  if (!tree) {
    tree = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    astCache.set(file, tree);
  }
  return tree;
}
export function visit(node: ts.Node, each: (node: ts.Node) => void): void {
  each(node);
  node.forEachChild((child) => visit(child, each));
}

/** Runtime imports only. A type-only import describes data, not composition. */
export function runtimeImports(file: string): string[] {
  const specifiers: string[] = [];
  for (const statement of ast(file).statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      const onlyTypes = clause && !clause.name && named && ts.isNamedImports(named)
        && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly);
      if (onlyTypes) continue;
      specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
      specifiers.push((statement.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  visit(ast(file), (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
  });
  return specifiers;
}

/** Resolve a relative or `@shared` specifier to a file. A package import resolves to undefined. */
export function resolveImport(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else if (specifier.startsWith("@shared/")) base = resolve(UI_ROOT, "../src/shared", specifier.slice("@shared/".length));
  else return undefined;
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return base;
}

/** Imported binding names per module specifier, with type-only names dropped. */
export function importedNames(file: string): { specifier: string; names: string[] }[] {
  return ast(file).statements.filter(ts.isImportDeclaration).flatMap((statement) => {
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) return [];
    const names: string[] = [];
    if (clause.name) names.push(clause.name.text);
    const named = clause.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) if (!element.isTypeOnly) names.push(element.name.text);
    }
    return [{ specifier: (statement.moduleSpecifier as ts.StringLiteral).text, names }];
  });
}

/** Every class name a component can render: string literals anywhere inside its `className` attributes. */
export function classesRenderedBy(file: string): Set<string> {
  const classes = new Set<string>();
  visit(ast(file), (node) => {
    if (!ts.isJsxAttribute(node) || node.name.getText() !== "className" || !node.initializer) return;
    visit(node.initializer, (inner) => {
      if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
        for (const name of inner.text.split(/\s+/)) if (name) classes.add(name);
      } else if (ts.isTemplateExpression(inner)) {
        for (const text of [inner.head.text, ...inner.templateSpans.map((span) => span.literal.text)]) {
          for (const name of text.split(/\s+/)) if (/^[a-z][\w-]*$/.test(name)) classes.add(name);
        }
      }
    });
  });
  return classes;
}

/** Intrinsic (lower-case) JSX elements that carry their own styling decision. */
export function styledIntrinsics(file: string): string[] {
  const found: string[] = [];
  visit(ast(file), (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    const tag = node.tagName.getText();
    if (!/^[a-z]/.test(tag)) return;
    for (const property of node.attributes.properties) {
      if (ts.isJsxAttribute(property) && ["className", "style"].includes(property.name.getText())) found.push(`<${tag} ${property.name.getText()}>`);
    }
  });
  return found;
}

/** Selectors of a stylesheet, without at-rule headers. */
export const selectors = (file: string) => [...css(file).matchAll(/([^{}]+)\{/g)]
  .map((match) => match[1]!.trim()).filter((selector) => !selector.startsWith("@"));
export const classSelectors = (file: string) => [...new Set(selectors(file)
  .flatMap((selector) => [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]!)))];

export const cssImports = (file: string) => runtimeImports(file).filter((specifier) => specifier.endsWith(".css"))
  .map((specifier) => resolveImport(file, specifier) ?? specifier);

/**
 * The ratchet. Each gate compares its offenders with the inventory recorded in
 * pending.json when the gates were written. A new offender fails the gate. A
 * fixed offender that is still listed also fails, so the list only shrinks:
 * delete the entry in the same commit that fixes it. The gate is done when its
 * list is empty, and the final form is `expect(offenders).toEqual([])`.
 *
 * `npm run gates:record` rewrites pending.json from the current offenders. It
 * exists to record the starting inventory, and to rename entries after a file
 * moves. Check its diff: a recording must never add an offence.
 * `node gates/check-pending.mjs <base-ref>` fails if any gate's list grew.
 */
const PENDING_FILE = join(import.meta.dirname, "pending.json");
const readPending = () => JSON.parse(readFileSync(PENDING_FILE, "utf8")) as Record<string, string[]>;
const pending = readPending();
export function expectOnlyPending(gate: string, offenders: string[]): void {
  const sorted = [...new Set(offenders)].sort();
  if (process.env.GATES_RECORD === "1") {
    // Read again before each write: every gate file records into the one inventory.
    const recorded = readPending();
    if (sorted.length) recorded[gate] = sorted; else delete recorded[gate];
    writeFileSync(PENDING_FILE, `${JSON.stringify(Object.fromEntries(Object.entries(recorded).sort(([a], [b]) => a.localeCompare(b))), null, 1)}\n`);
    return;
  }
  expect(sorted, `${gate}: offenders differ from gates/pending.json`).toEqual(pending[gate] ?? []);
}
