import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Load the pinned package's Pi extension without profile package settings. */
export function bundledWebAccessPackagePath(): string {
  return dirname(fileURLToPath(import.meta.resolve("pi-web-access/package.json")));
}
