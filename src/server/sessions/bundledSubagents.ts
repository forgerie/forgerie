import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
