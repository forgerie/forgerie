/**
 * The decomposition gate (caliper-parts, "write the gate first").
 *
 * Every distinct visual unit the app renders is a real component with a part
 * beside it, at every layer, with one component per file and no visual
 * decision written twice. Reading a screen misses units. This gate does not.
 */
import { basename, dirname } from "node:path";
import { describe, test, expect } from "vitest";
import {
  componentFiles, componentLayer, componentPart, expectOnlyPending, LAYERS, partComponent, partFiles, partLayer,
  read, rel, resolveImport, runtimeImports, runtimeModules, systemComponents, cssFiles, classSelectors, classesRenderedBy,
  isPart, type Layer,
} from "./source";
import { existsSync } from "node:fs";

describe("every rendered unit is a component with a part beside it", () => {
  test("no component lacks a sibling part", () => {
    expectOnlyPending("component without part", componentFiles.filter((file) => !componentPart(file)).map(rel));
  });

  test("no part is orphaned from its component", () => {
    expectOnlyPending("part without component", partFiles.filter((part) => !existsSync(partComponent(part))).map(rel));
  });

  test("every part declares one of the five layers", () => {
    expectOnlyPending("part without layer", partFiles.filter((part) => !LAYERS.includes(partLayer(part) as Layer)).map(rel));
  });

  test("the app is decomposed at every layer", () => {
    const present = new Set(partFiles.map(partLayer));
    expectOnlyPending("layer without parts", LAYERS.filter((layer) => !present.has(layer)));
  });
});

describe("one file holds one component", () => {
  // A second PascalCase render function is a component nobody named, so it can
  // never be reviewed, reused or previewed. SCREAMING_CASE is a constant.
  const DECLARATION = /^(?:export )?(?:default )?(?:function|const) ([A-Z][a-z0-9][A-Za-z0-9]*)\b/gm;
  test("no file declares a second component", () => {
    expectOnlyPending("file with more than one component", componentFiles.flatMap((file) => {
      const names = [...read(file).matchAll(DECLARATION)].map((match) => match[1]!);
      return names.length > 1 ? [`${rel(file)}: ${names.join(", ")}`] : [];
    }));
  });
});

describe("no visual decision is written twice", () => {
  test("no className literal appears in two component files", () => {
    const owners = new Map<string, Set<string>>();
    for (const file of componentFiles) {
      for (const [, value] of read(file).matchAll(/className="([^"]+)"/g)) {
        owners.set(value!, (owners.get(value!) ?? new Set()).add(rel(file)));
      }
    }
    expectOnlyPending("className literal in two files", [...owners].filter(([, files]) => files.size > 1)
      .map(([value, files]) => `"${value}" in ${[...files].sort().join(", ")}`));
  });

  test("no class selector is defined in two stylesheets", () => {
    const owners = new Map<string, Set<string>>();
    for (const file of cssFiles) for (const name of classSelectors(file)) owners.set(name, (owners.get(name) ?? new Set()).add(rel(file)));
    expectOnlyPending("class selector in two stylesheets", [...owners].filter(([, files]) => files.size > 1)
      .map(([name, files]) => `.${name} in ${[...files].sort().join(", ")}`));
  });

  test("no class is rendered by two components", () => {
    const owners = new Map<string, Set<string>>();
    for (const file of componentFiles) for (const name of classesRenderedBy(file)) owners.set(name, (owners.get(name) ?? new Set()).add(rel(file)));
    expectOnlyPending("class rendered by two components", [...owners].filter(([, files]) => files.size > 1)
      .map(([name, files]) => `.${name} in ${[...files].sort().join(", ")}`));
  });
});

describe("composition points down", () => {
  const RANK: Record<Layer, number> = { page: 0, template: 1, organism: 2, molecule: 3, atom: 4 };
  test("no component imports a component of a higher layer", () => {
    expectOnlyPending("component imports a higher layer", componentFiles.flatMap((file) => {
      const from = componentLayer(file);
      if (!from) return [];
      return runtimeImports(file).flatMap((specifier) => {
        const target = resolveImport(file, specifier);
        const to = target && componentFiles.includes(target) ? componentLayer(target) : undefined;
        return to && RANK[to] < RANK[from] ? [`${rel(file)} (${from}) -> ${rel(target!)} (${to})`] : [];
      });
    }));
  });
});

describe("every system component has a consumer", () => {
  // A catalogue makes an orphan look finished. A part exists to review a
  // component, not to use it, so a part alone does not count as a consumer.
  test("every system component is imported by a module other than its part", () => {
    const consumed = new Set(runtimeModules.filter((file) => !isPart(file))
      .flatMap((file) => runtimeImports(file).map((specifier) => resolveImport(file, specifier))));
    expectOnlyPending("system component without consumer", systemComponents.filter((file) => !consumed.has(file)).map(rel));
  });

  test("each part sits in its component's folder", () => {
    expect(partFiles.filter((part) => dirname(part) !== dirname(partComponent(part))).map(rel)).toEqual([]);
    expect(partFiles.filter((part) => !/^[A-Z]/.test(basename(part))).map(rel)).toEqual([]);
  });
});
