/**
 * Not a gate: a report for the CSS split (ui/docs/decomposition.md, "Tokens and CSS").
 * Run with CSS_OWNERS=1. It writes, for every class a stylesheet defines, the components
 * that render it, to /tmp/css-owners.json. Without the variable it does nothing.
 */
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { classSelectors, classesRenderedBy, componentFiles, cssFiles, rel } from "./source";

test.runIf(process.env.CSS_OWNERS === "1")("report which components render each class", () => {
  const renderers = new Map<string, string[]>();
  for (const file of componentFiles) for (const name of classesRenderedBy(file)) renderers.set(name, [...(renderers.get(name) ?? []), rel(file)]);
  const report = Object.fromEntries(cssFiles.map((sheet) => [rel(sheet),
    Object.fromEntries(classSelectors(sheet).map((name) => [name, renderers.get(name) ?? []]))]));
  writeFileSync("/tmp/css-owners.json", `${JSON.stringify(report, null, 1)}\n`);
});
