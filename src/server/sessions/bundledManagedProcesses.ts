import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the managed-process Pi package that ships with Forgerie.
 *
 * Passing the package root to the SDK resource loader loads the package's
 * extensions and skill without depending on the user's Pi package settings.
 */
export function bundledManagedProcessesPackagePath(): string {
  return dirname(fileURLToPath(import.meta.resolve("@aliou/pi-processes/package.json")));
}
