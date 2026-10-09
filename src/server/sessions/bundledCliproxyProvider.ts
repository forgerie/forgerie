import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DefaultPackageManager, SettingsManager, type LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

const PACKAGE_NAME = "@router-for-me/pi-cliproxyapi-provider";
type ProfileSettings = ReturnType<SettingsManager["getGlobalSettings"]>;
type Scope = "user" | "project";

export function bundledCliproxyProviderPackagePath(): string {
  return dirname(fileURLToPath(import.meta.resolve("@router-for-me/pi-cliproxyapi-provider/package.json")));
}

/**
 * Replace profile copies before Pi evaluates extension factories. Filtering only
 * LoadExtensionsResult is too late: a stray factory can remove the bundle's
 * queued provider registration or install process-wide protocol handlers.
 * Shadow only resource-discovery getters; reload and persistence still use the
 * real settings manager. Neither profile nor project settings are rewritten.
 */
export function bundledCliproxyProviderResources(cwd: string, agentDir: string): {
  settingsManager: SettingsManager;
  extensionsOverride: (result: LoadExtensionsResult) => LoadExtensionsResult;
} {
  const bundledRoot = bundledCliproxyProviderPackagePath();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const packages = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  const ignored = new Map<Scope, Set<string>>();

  const filterSettings = (settings: ProfileSettings, scope: Scope): ProfileSettings => {
    const roots = new Set<string>();
    ignored.set(scope, roots);
    const isProviderSource = (source: string): boolean => {
      const npmName = `npm:${PACKAGE_NAME}`;
      const path = packages.getInstalledPath(source.replace(/^[+-]/, ""), scope);
      const root = path === undefined ? undefined : providerPackageRoot(path);
      if (source !== npmName && !source.startsWith(`${npmName}@`) && root === undefined) return false;
      if (root !== bundledRoot && path !== bundledRoot) roots.add(root ?? path ?? agentDir);
      return true;
    };
    const extensions = (settings.extensions ?? []).filter((source) => !isProviderSource(source));
    // Pi also discovers files and package folders without a settings entry.
    const autoload = scope === "user" ? join(agentDir, "extensions") : join(cwd, ".pi", "extensions");
    if (existsSync(autoload)) {
      for (const entry of readdirSync(autoload)) {
        const path = join(autoload, entry);
        const root = providerPackageRoot(path);
        if (root === undefined) continue;
        if (root !== bundledRoot) roots.add(root);
        extensions.push(`!${path}${statSync(path).isDirectory() ? "/**" : ""}`);
      }
    }
    return {
      ...settings,
      packages: (settings.packages ?? []).filter((source) => !isProviderSource(typeof source === "string" ? source : source.source)),
      extensions,
    };
  };
  const globalSettings = settingsManager.getGlobalSettings.bind(settingsManager);
  const projectSettings = settingsManager.getProjectSettings.bind(settingsManager);
  settingsManager.getGlobalSettings = () => filterSettings(globalSettings(), "user");
  settingsManager.getProjectSettings = () => filterSettings(projectSettings(), "project");

  return {
    settingsManager,
    extensionsOverride: (result) => ({
      ...result,
      warnings: [
        ...(result.warnings ?? []),
        ...[...new Set([...ignored.values()].flatMap((roots) => [...roots]))].map((path) => ({
          path,
          warning: `Forgerie bundles ${PACKAGE_NAME} and ignored this copy from the Pi profile. Point the profile at ${bundledRoot} or remove it.`,
        })),
      ],
    }),
  };
}

function providerPackageRoot(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const resolved = realpathSync(path);
  let directory = statSync(resolved).isDirectory() ? resolved : dirname(resolved);
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        return typeof parsed === "object" && parsed !== null && "name" in parsed && parsed.name === PACKAGE_NAME ? directory : undefined;
      } catch {
        // Leave malformed packages to Pi's ordinary resource diagnostics.
        return undefined;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
