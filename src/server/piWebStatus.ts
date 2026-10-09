import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PiWebCapability, PiWebComponentStatus, PiWebRuntimeComponent, PiWebRuntimeResponse, PiWebServiceComponent, PiWebVersionResponse } from "../shared/apiTypes.js";
import { effectivePiWebCapabilities, WEB_RUNTIME_CAPABILITIES } from "../shared/capabilities.js";
import { parsePiWebRuntimeComponent } from "../shared/piWebStatusParsing.js";
import { SessionDaemonClient } from "../sessiond/sessionDaemonClient.js";

interface RuntimeDaemon {
  request(method: string, path: string): Promise<{ statusCode: number; body: string }>;
}

const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
// Capture once: a running process must not claim the version installed later.
const runtimeVersion = installedPackageVersion();

function installedPackageVersion(): string {
  const value: unknown = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof value !== "object" || value === null || !("version" in value) || typeof value.version !== "string") {
    throw new Error(`Forgerie package metadata has no version: ${packagePath}`);
  }
  return value.version;
}

export function getPiWebRuntimeComponent(component: PiWebServiceComponent, capabilities: readonly PiWebCapability[] = []): PiWebRuntimeComponent {
  return { component, label: component === "web" ? "Web/UI" : "Session daemon", runtimeVersion, available: true, capabilities: [...capabilities] };
}

export async function getPiWebRuntime(daemon: RuntimeDaemon = new SessionDaemonClient()): Promise<PiWebRuntimeResponse> {
  const web = getPiWebRuntimeComponent("web", WEB_RUNTIME_CAPABILITIES);
  const sessiond = await sessiondRuntime(daemon);
  return { packageName: "forgerie", generatedAt: new Date().toISOString(), components: { web, sessiond }, capabilities: effectivePiWebCapabilities({ web, sessiond }) };
}

export async function getPiWebVersionStatus(daemon: RuntimeDaemon = new SessionDaemonClient()): Promise<PiWebVersionResponse> {
  const runtime = await getPiWebRuntime(daemon);
  const installedVersion = installedPackageVersion();
  const componentStatus = (component: PiWebRuntimeComponent): PiWebComponentStatus => ({
    component: component.component, label: component.label, available: component.available,
    ...(component.runtimeVersion === undefined ? {} : { runtimeVersion: component.runtimeVersion }),
    installedVersion, stale: component.available && component.runtimeVersion !== installedVersion,
    ...(component.error === undefined ? {} : { error: component.error }),
  });
  return { packageName: runtime.packageName, generatedAt: runtime.generatedAt,
    components: { web: componentStatus(runtime.components.web), sessiond: componentStatus(runtime.components.sessiond) } };
}

async function sessiondRuntime(daemon: RuntimeDaemon): Promise<PiWebRuntimeComponent> {
  try {
    const response = await daemon.request("GET", "/runtime");
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Runtime check returned HTTP ${String(response.statusCode)}`);
    const value: unknown = JSON.parse(response.body);
    const runtime = parsePiWebRuntimeComponent(value);
    if (runtime?.component !== "sessiond") throw new Error("Session daemon returned invalid runtime information");
    return runtime;
  } catch (error) {
    return { component: "sessiond", label: "Session daemon", available: false, capabilities: [], error: error instanceof Error ? error.message : String(error) };
  }
}
