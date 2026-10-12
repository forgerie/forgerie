import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Extension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { bundledSubagentsPackagePath } from "./bundledSubagents.js";
import { bundledWebAccessPackagePath } from "./bundledWebAccess.js";

const WEB_TOOLS = new Set(["web_search", "fetch_content", "get_search_content", "source_check"]);

/**
 * Keep one copy of each bundled extension package, without changing Pi's order.
 * Profile factories have already run; dropping their hooks/tools here cannot
 * undo factory side effects. Warnings tell users to remove those copies.
 */
export function preferBundledExtensions(result: LoadExtensionsResult): LoadExtensionsResult {
  const bundles = new Map([
    ["pi-subagents", bundledSubagentsPackagePath()],
    ["pi-web-access", bundledWebAccessPackagePath()],
  ]);
  const strayRoots = new Map<string, { name: string; bundledRoot: string }>();
  const strayPaths = new Set<string>();
  const extensions = result.extensions.filter((extension) => {
    const owner = bundledPackageOwner(extension, bundles);
    if (owner === undefined || owner.root === owner.bundledRoot) return true;
    strayRoots.set(owner.root, owner);
    strayPaths.add(extension.path);
    return false;
  });
  const warnings = [...(result.warnings ?? []), ...[...strayRoots].map(([root, { name, bundledRoot }]) => ({
    path: root,
    warning: `Forgerie bundles ${name} and ignored this copy from the Pi profile. Point the profile at ${bundledRoot} or remove it.`,
  }))];

  // Pi loads additional paths first and its runner keeps the first tool. Only
  // downgrade conflicts that actually name the bundle as the winning owner.
  const webRoot = bundledWebAccessPackagePath();
  const bundledConflicts = new Map<string, string>();
  for (const extension of extensions) {
    if (bundledPackageOwner(extension, bundles)?.root !== webRoot) continue;
    for (const name of extension.tools.keys()) {
      if (WEB_TOOLS.has(name)) bundledConflicts.set(`Tool "${name}" conflicts with ${extension.path}`, name);
    }
  }
  const errors = result.errors.filter((error) => {
    if (strayPaths.has(error.path)) return false;
    const name = bundledConflicts.get(error.error);
    if (name === undefined) return true;
    warnings.push({
      path: error.path,
      warning: `Forgerie bundles pi-web-access; tool "${name}" from ${error.path} was ignored in favor of ${webRoot}. This extension's other tools remain loaded.`,
    });
    return false;
  });
  if (strayRoots.size === 0 && errors.length === result.errors.length) return result;
  return { ...result, extensions, errors, warnings };
}

function bundledPackageOwner(extension: Extension, bundles: ReadonlyMap<string, string>): { name: string; root: string; bundledRoot: string } | undefined {
  if (extension.resolvedPath.startsWith("<")) return undefined;
  let directory = dirname(extension.resolvedPath);
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const name = packageName(manifest);
      const bundledRoot = name === undefined ? undefined : bundles.get(name);
      return name === undefined || bundledRoot === undefined ? undefined : { name, root: directory, bundledRoot };
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function packageName(manifest: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    return typeof parsed === "object" && parsed !== null && "name" in parsed && typeof parsed.name === "string"
      ? parsed.name
      : undefined;
  } catch {
    return undefined;
  }
}
