import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectivePiWebConfig } from "./config.js";
import { SessionDaemonClient } from "./sessiond/sessionDaemonClient.js";
import { parsePiWebComponentStatus, parsePiWebVersionResponse } from "./shared/piWebStatusParsing.js";
import type { PiWebComponentStatus } from "./shared/apiTypes.js";

export function packageVersion(): string {
  const path = join(dirname(dirname(fileURLToPath(import.meta.url))), "package.json");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value !== "object" || value === null || !("version" in value) || typeof value.version !== "string") throw new Error(`Package metadata has no version: ${path}`);
  return value.version;
}

/** Local diagnostics only: no npm registry, package installation, or service mutation. */
export async function printPiWebVersionReport(): Promise<boolean> {
  console.log(`Forgerie installed: ${packageVersion()}`);
  try {
    const { config } = effectivePiWebConfig();
    const host = config.host === "0.0.0.0" || config.host === "::" || config.host === undefined ? "127.0.0.1" : config.host;
    const urlHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    const response = await fetch(`http://${urlHost}:${String(config.port ?? 8504)}/api/pi-web/version`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const parsed = parsePiWebVersionResponse(await response.json());
    if (parsed === undefined) throw new Error("Web server returned invalid version information");
    printComponent(parsed.components.web);
    printComponent(parsed.components.sessiond);
    return parsed.components.web.available && parsed.components.sessiond.available;
  } catch (error) {
    console.log(`Web/UI: unavailable — ${error instanceof Error ? error.message : String(error)}`);
    try {
      const response = await new SessionDaemonClient({ requestTimeoutMs: 2000 }).request("GET", "/health");
      const value: unknown = JSON.parse(response.body);
      const version = typeof value === "object" && value !== null && "version" in value ? parsePiWebComponentStatus(value.version) : undefined;
      if (response.statusCode !== 200 || version === undefined) throw new Error("Invalid session daemon health response", { cause: error });
      printComponent(version);
    } catch (daemonError) {
      console.log(`Session daemon: unavailable — ${daemonError instanceof Error ? daemonError.message : String(daemonError)}`);
    }
    return false;
  }
}

function printComponent(component: PiWebComponentStatus): void {
  console.log(`${component.label}: ${component.available ? component.runtimeVersion ?? "unknown version" : "unavailable"}${component.stale ? " (restart needed)" : ""}`);
  if (component.error !== undefined) console.log(`  ${component.error}`);
}
