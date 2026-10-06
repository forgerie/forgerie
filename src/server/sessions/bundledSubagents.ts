import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Extension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

const PACKAGE_NAME = "pi-subagents";

/**
 * Resolve the `pi-subagents` package that ships with Forgerie.
 *
 * Passing the package root to the SDK resource loader loads its extension,
 * skill, and prompts without depending on the user's Pi package settings.
 */
export function bundledSubagentsPackagePath(): string {
  // A literal specifier, so dependency analysis sees the bundled package.
  return dirname(fileURLToPath(import.meta.resolve("pi-subagents")));
}

/**
 * Keep only Forgerie's copy of `pi-subagents` in a hosted session.
 *
 * A Pi profile that loads the bundled path is deduplicated by Pi itself. A
 * profile that loads a different copy would register a second `subagent` tool
 * and second set of hooks on the same session, so that copy is dropped and the
 * session reports where it came from. Its module has already been evaluated by
 * then; the warning tells the user to point the profile at the bundled path.
 */
export function preferBundledSubagents(result: LoadExtensionsResult): LoadExtensionsResult {
  const bundledRoot = bundledSubagentsPackagePath();
  const strayRoots = new Set<string>();
  const extensions = result.extensions.filter((extension) => {
    const root = subagentsPackageRoot(extension);
    if (root === undefined || root === bundledRoot) return true;
    strayRoots.add(root);
    return false;
  });
  if (strayRoots.size === 0) return result;

  const strayPaths = new Set(result.extensions.filter((extension) => !extensions.includes(extension)).map((extension) => extension.path));
  return {
    ...result,
    extensions,
    // Pi reports the duplicate `subagent` tool as a conflict on the dropped copy.
    errors: result.errors.filter((error) => !strayPaths.has(error.path)),
    warnings: [
      ...(result.warnings ?? []),
      ...[...strayRoots].map((root) => ({
        path: root,
        warning: `Forgerie bundles ${PACKAGE_NAME} and ignored this copy from the Pi profile. Point the profile at ${bundledRoot} or remove it.`,
      })),
    ],
  };
}

function subagentsPackageRoot(extension: Extension): string | undefined {
  if (extension.resolvedPath.startsWith("<")) return undefined;
  let directory = dirname(extension.resolvedPath);
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) return packageName(manifest) === PACKAGE_NAME ? directory : undefined;
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
