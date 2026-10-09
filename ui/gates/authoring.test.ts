/**
 * The authoring gate (caliper-parts): each part and component is written so
 * that Caliper can show it and a reviewer can trust it, and every visual
 * decision is a token.
 */
import { basename } from "node:path";
import { describe, test } from "vitest";
import ts from "typescript";
import {
  allFiles, ast, cssBlocks, cssFiles, css, expectOnlyPending, isFixture, isTest, partComponent, partFiles, read, rel, TOKENS_CSS, visit,
} from "./source";

describe("every part is authored for Caliper", () => {
  test("each part default-exports a function component", () => {
    expectOnlyPending("part without default function", partFiles.filter((part) => !/^export default function [A-Z]/m.test(read(part))).map(rel));
  });

  test("each part imports and renders the component it sits beside", () => {
    expectOnlyPending("part does not render its component", partFiles.filter((part) => {
      const name = basename(partComponent(part), ".tsx");
      const source = read(part);
      return !new RegExp(`from "\\./${name}"`).test(source) || !new RegExp(`<${name}[\\s/>]`).test(source);
    }).map(rel));
  });

  test("part metadata is literal", () => {
    // Caliper reads parts without running them. A computed value is ignored or rejected.
    expectOnlyPending("part with computed metadata", partFiles.flatMap((part) =>
      [...read(part).matchAll(/^export const (name|note|layer|composition|expectations|checks)\s*=\s*(.)/gm)]
        .filter(([, key, first]) => (["name", "note", "layer"].includes(key!) ? first !== "\"" : first !== "{"))
        .map(([, key]) => `${rel(part)}: ${key}`)));
  });

  test("parts and fixtures are deterministic", () => {
    const scenarios = allFiles.filter((file) => (file.endsWith(".part.tsx") || isFixture(file)) && !isTest(file));
    expectOnlyPending("scenario reads the clock or randomness", scenarios.flatMap((file) =>
      [...read(file).matchAll(/Math\.random|Date\.now|performance\.now|new Date\(\s*\)|crypto\.randomUUID/g)].map((match) => `${rel(file)}: ${match[0]}`)));
  });
});

describe("visual decisions live in tokens", () => {
  // A colour or length stated literally instead of named. color-mix() derives a
  // colour, and a derived colour is a decision, so it lives in tokens.css too.
  const RAW_CSS = /#[0-9a-fA-F]{3,8}\b|(?<![\w-])\d*\.?\d+px\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/g;
  test("no stylesheet outside tokens.css states a raw colour or pixel value", () => {
    expectOnlyPending("raw value in a stylesheet", cssFiles.filter((file) => file !== TOKENS_CSS)
      .flatMap((file) => [...css(file).matchAll(RAW_CSS)].map((match) => `${rel(file)}: ${match[0]}`)));
  });

  test("no component or part states a raw colour or pixel value", () => {
    const sources = allFiles.filter((file) => file.endsWith(".tsx") && !isTest(file));
    expectOnlyPending("raw value in a component", sources.flatMap((file) =>
      [...read(file).matchAll(/["'`][^"'`\n]*?(#[0-9a-fA-F]{3,8}\b|\d+px\b)/g)].map((match) => `${rel(file)}: ${match[1]}`)));
  });

  test("an inline style sets only custom properties", () => {
    // An inline style beats every class, so a decision there cannot be reviewed or overridden.
    // A custom property hands a measured value (a drag offset, an image size) to the stylesheet.
    const sources = allFiles.filter((file) => file.endsWith(".tsx") && !isTest(file));
    expectOnlyPending("inline style beyond custom properties", sources.flatMap((file) => {
      const offences: string[] = [];
      visit(ast(file), (node) => {
        if (!ts.isJsxAttribute(node) || node.name.getText() !== "style") return;
        const expression = node.initializer && ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
        const literal = expression && ts.isObjectLiteralExpression(expression) ? expression : undefined;
        const onlyCustom = literal?.properties.every((property) => ts.isPropertyAssignment(property)
          && ts.isStringLiteral(property.name) && property.name.text.startsWith("--"));
        if (!onlyCustom) offences.push(`${rel(file)}:${ast(file).getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      });
      return offences;
    }));
  });
});

describe("design inputs are addressable knobs", () => {
  test("no selector declares the same custom property twice", () => {
    expectOnlyPending("custom property declared twice", cssFiles.flatMap((file) => {
      // Caliper keys a knob by property and selector, so two declarations in one context share a key.
      // The same selector inside another at-rule, such as the dark scheme, is a different context.
      const seen = new Map<string, number>();
      for (const { context, selector, body } of cssBlocks(file)) {
        for (const [, property] of body.matchAll(/(--[\w-]+)\s*:/g)) {
          const key = `${context ? `${context} ` : ""}${selector} ${property}`;
          seen.set(key, (seen.get(key) ?? 0) + 1);
        }
      }
      return [...seen].filter(([, count]) => count > 1).map(([key]) => `${rel(file)}: ${key}`);
    }));
  });
});
