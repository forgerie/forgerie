import { openBrowserFile, BrowserFileAccess } from "../browserFileAccess.js";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { activeForgerieProfile, type ForgerieProfile, type Gateway } from "./forgerieProfile.js";
import { isErrnoCode, SettingsHttpError } from "./http.js";
import { changeSchema, type ManagedPlugin, type PluginCatalog, type PluginChange, type PluginReadme } from "../../shared/pluginsContract.js";
import { AppSettingsError, appPluginEnabled, resolveAppSettings, storedAppSettings, type AppPluginManifest, type AppPluginStates } from "../../shared/appPlugins.js";
import { APP_PLUGIN_MANIFESTS } from "../../shared/appPluginManifests.js";

const objectSchema = z.record(z.string(), z.unknown());
const packageSchema = z.union([z.string(), z.looseObject({ source: z.string() })]);
const settingsSchema = z.looseObject({ packages: z.array(packageSchema).default([]), extensions: z.array(z.string()).default([]),
  forgerieDisabledPackages: z.array(packageSchema).default([]),
});
const webConfigSchema = z.looseObject({ plugins: z.record(z.string(), z.looseObject({ enabled: z.boolean().optional(), settings: objectSchema.optional() })).default({}) });
const pendingSchema = z.object({ stamp: z.array(z.string()), required: z.boolean() });
const packageJsonSchema = z.object({ name: z.string().optional(), version: z.string().optional(), description: z.string().optional() });
const builtins: readonly (readonly [string, string])[] = [
  ["processes", "Runs long commands as session-owned managed processes."],
  ["codemode", "Lets the model run several tool calls from one JavaScript script."],
  ["ask-user", "Lets the agent ask you a question in a browser form."],
];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const packageSource = (entry: z.infer<typeof packageSchema>) => typeof entry === "string" ? entry : entry.source;
const packageId = (source: string) => `package:${source}`;
const extensionId = (path: string) => `extension:${path}`;
const appId = (id: string) => `app:${id}`;
const exec = promisify(execFile);

/** A name for a source with no readable package.json: the npm name, the repository, or the folder. */
export function sourceName(source: string): string {
  if (source.startsWith("npm:")) {
    const spec = source.slice("npm:".length);
    const version = spec.indexOf("@", 1);
    return version > 0 ? spec.slice(0, version) : spec;
  }
  const last = source.replace(/[/\\]+$/u, "").split(/[/\\:]/u).at(-1) ?? "";
  const remote = /^(git:|git@|[a-z+]+:\/\/)/u.test(source);
  return (remote ? last.replace(/@[^@]*$/u, "").replace(/\.git$/u, "") : last) || source;
}
/** A loose extension is named by its file, or by its folder when the file is an index. */
export function extensionName(path: string): string {
  const file = basename(path);
  return (/^index\.[cm]?[jt]s$/u.test(file) ? basename(dirname(path)) : file.replace(/\.[cm]?[jt]s$/u, "")) || file;
}
const units = ["forgerie-web.service", "forgerie-sessiond.service"];
/** The most README text the page shows. Longer files stop here, and the reply says so. */
export const README_MAX_BYTES = 512 * 1024;
const readmeName = /^readme(?:\.(?:md|markdown|mdown|txt))?$/iu;
/** `README.md` before `README.markdown` before a bare `README`, so the Markdown file wins when a package ships several. */
const readmeRank = (name: string) => /\.md$/iu.test(name) ? 0 : /\.(?:markdown|mdown)$/iu.test(name) ? 1 : /^readme$/iu.test(name) ? 2 : 3;

const repositorySchema = z.object({ repository: z.union([z.string(), z.object({ url: z.string(), directory: z.string().optional() })]).optional() }).catch({});
/**
 * Where a package's GitHub repository serves files, from package.json's
 * `repository`. Other hosts get nothing: their URL layouts differ.
 */
export function githubRepository(repository: string | { url: string; directory?: string | undefined } | undefined): PluginReadme["repository"] {
  if (repository === undefined) return undefined;
  const url = typeof repository === "string" ? repository : repository.url;
  const match = /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/u.exec(url)
    ?? /^(?:git\+)?(?:https?|git|ssh):\/\/(?:[^@/]+@)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:#.*)?$/u.exec(url)
    ?? /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/u.exec(url);
  const owner = match?.[1];
  const name = match?.[2];
  if (owner === undefined || name === undefined) return undefined;
  const directory = typeof repository === "string" ? "" : (repository.directory ?? "").replace(/^[./]+|\/+$/gu, "");
  return { blob: `https://github.com/${owner}/${name}/blob/HEAD/`, raw: `https://raw.githubusercontent.com/${owner}/${name}/HEAD/`,
    directory: directory === "" ? "" : `${directory}/` };
}

/**
 * The README in a package folder, read as text. Only a regular file counts:
 * a symlink could point anywhere on this host, so it is skipped.
 */
export async function readReadme(folder: string, browserFiles?: BrowserFileAccess): Promise<PluginReadme> {
  let names: string[];
  try { names = await readdir(folder); } catch { return { text: null, truncated: false }; }
  for (const name of names.filter((entry) => readmeName.test(entry)).sort((a, b) => readmeRank(a) - readmeRank(b))) {
    const path = join(folder, name);
    const info = await lstat(path).catch(() => undefined);
    if (info?.isFile() !== true) continue;
    if (browserFiles !== undefined && !await browserFiles.isReadable(path)) continue;
    const handle = await openBrowserFile(path, browserFiles);
    try {
      const buffer = Buffer.alloc(Math.min(info.size, README_MAX_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const truncated = info.size > README_MAX_BYTES;
      const decoded = buffer.subarray(0, bytesRead).toString("utf8");
      // A cut can split a multi-byte character. The decoder turns the broken tail into U+FFFD; drop it.
      let repository: PluginReadme["repository"];
      try { repository = githubRepository(repositorySchema.parse(JSON.parse(await readFile(join(folder, "package.json"), "utf8"))).repository); }
      catch { repository = undefined; }
      return { text: truncated ? decoded.replace(/\uFFFD+$/u, "") : decoded, file: name, truncated, ...(repository ? { repository } : {}) };
    } finally { await handle.close(); }
  }
  return { text: null, truncated: false };
}

export class PluginError extends SettingsHttpError {}
export interface PluginServices {
  read(): Promise<{ available: boolean; stamp: string[] }>;
  restart(): Promise<void>;
}
export const localPluginServices: PluginServices = {
  async read() {
    try {
      const { stdout } = await exec("systemctl", ["--user", "show", ...units, "--property=ActiveEnterTimestampMonotonic", "--value"], { timeout: 5000 });
      const stamp = stdout.trim().split(/\s+/u);
      return { available: stamp.length === units.length && stamp.every((value) => /^\d+$/u.test(value) && value !== "0"), stamp };
    } catch { return { available: false, stamp: [] }; }
  },
  async restart() {
    // This server is forgerie-web itself. A plain restart would kill the request
    // before it answers, so a transient systemd timer restarts both units a
    // moment later, outside this process's cgroup.
    await exec("systemd-run", ["--user", "--collect", "--on-active=1", "systemctl", "--user", "restart", ...units], { timeout: 10_000 });
  },
};

const packageManager = (profile: ForgerieProfile) => new DefaultPackageManager({ cwd: profile.dir, agentDir: profile.dir,
  settingsManager: SettingsManager.create(profile.dir, profile.dir, { projectTrusted: false }) });

async function textAt(path: string, browserFiles?: BrowserFileAccess): Promise<string> {
  try {
    const file = await openBrowserFile(path, browserFiles);
    try { return await file.readFile("utf8"); } finally { await file.close(); }
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) return "{}";
    throw error;
  }
}
function parseJson(text: string, path: string): unknown {
  try { return JSON.parse(text); } catch { throw new PluginError(500, `Cannot read ${path} as JSON. Repair it before editing plugins.`); }
}
async function atomicWrite(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}

/** Owns profile-only edits, full-entry disable/restore, stale-write checks, and restart evidence.
 * Uses Pi's resolver without loading extension code or installing missing sources.
 * The running gateway owns installs and Pi package installs.
 */
export class PluginService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: {
    profile?: () => Promise<ForgerieProfile>;
    gateway: Gateway;
    services?: PluginServices;
    /** Plugins bundled with the browser app. Defaults to the shipped list. */
    appPlugins?: readonly AppPluginManifest[];
  }) {}
  private get gateway() { return this.options.gateway; }
  private get appPlugins() { return this.options.appPlugins ?? APP_PLUGIN_MANIFESTS; }
  private get services() { return this.options.services ?? localPluginServices; }
  private profile() { return this.options.profile ? this.options.profile() : activeForgerieProfile(this.gateway); }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async snapshot() {
    const profile = await this.profile();
    const settingsPath = join(profile.dir, "settings.json");
    const browserFiles = new BrowserFileAccess(profile.dir);
    await browserFiles.assertReadable(settingsPath);
    await browserFiles.assertReadable(profile.configPath);
    const [settingsText, configText] = await Promise.all([textAt(settingsPath, browserFiles), textAt(profile.configPath, browserFiles)]);
    const settings = settingsSchema.parse(parseJson(settingsText, settingsPath));
    const config = webConfigSchema.parse(parseJson(configText, profile.configPath));
    return { profile, settingsPath, settingsText, configText, settings, config,
      revision: hash(JSON.stringify([profile.revision, settingsText, configText])) };
  }
  /** Check the same non-secret catalog revision used by plugin edits; return the daemon profile revision. */
  async requireRevision(revision: string): Promise<string> {
    const data = await this.snapshot();
    if (data.revision !== revision) throw new SettingsHttpError(409, "Settings or the active profile changed. Reload before changing the gateway key.");
    return data.profile.revision;
  }
  /**
   * What the browser app needs to render its bundled plugins: on or off, and
   * every setting resolved. Reads Forgerie's config only, so the app can ask
   * on every load without resolving Pi packages or reading service state.
   */
  async appStates(): Promise<AppPluginStates> {
    const { config } = await this.snapshot();
    return { plugins: this.appPlugins.map((manifest) => ({ id: manifest.id, enabled: appPluginEnabled(manifest, config.plugins[manifest.id]),
      settings: { ...resolveAppSettings(manifest, config.plugins[manifest.id]?.settings) } })) };
  }
  /**
   * A configured Pi package's README. Only a package in this profile's list can
   * be read, so an id cannot name an arbitrary folder. Never loads its code.
   */
  async readme(id: string): Promise<PluginReadme> {
    const { profile, settings } = await this.snapshot();
    const entry = [...settings.packages, ...settings.forgerieDisabledPackages].find((candidate) => packageId(packageSource(candidate)) === id);
    if (entry === undefined) throw new PluginError(404, "That package is not in this profile's plugin list.");
    let path: string | undefined;
    try { path = packageManager(profile).getInstalledPath(packageSource(entry), "user"); } catch { path = undefined; }
    return path === undefined ? { text: null, truncated: false } : readReadme(path, new BrowserFileAccess(profile.dir));
  }
  async list(): Promise<PluginCatalog> {
    const data = await this.snapshot();
    const { profile, settings, config } = data;
    const manager = packageManager(profile);
    const [resolved, services] = await Promise.all([manager.resolve(() => Promise.resolve("skip")), this.services.read()]);
    // Reads package.json as data. Locating a package never loads its code or installs a missing one.
    const describePackage = async (entry: z.infer<typeof packageSchema>, enabled: boolean): Promise<ManagedPlugin> => {
      const source = packageSource(entry);
      let path: string | undefined;
      try { path = manager.getInstalledPath(source, "user"); } catch { path = undefined; }
      let info: z.infer<typeof packageJsonSchema> = {};
      if (path !== undefined) {
        try { info = packageJsonSchema.catch({}).parse(JSON.parse(await readFile(join(path, "package.json"), "utf8"))); } catch { info = {}; }
      }
      return { id: packageId(source), kind: "package", name: info.name ?? sourceName(source), source, enabled,
        description: info.description?.trim() ?? "", version: info.version, installed: path !== undefined,
        filtered: typeof entry !== "string" && Object.keys(entry).some((key) => key !== "source") };
    };
    const parked = settings.forgerieDisabledPackages.filter((entry) => !settings.packages.some((active) => packageSource(active) === packageSource(entry)));
    const packages = await Promise.all([...settings.packages.map((entry) => describePackage(entry, true)), ...parked.map((entry) => describePackage(entry, false))]);
    const plugins: ManagedPlugin[] = [
      ...packages,
      ...resolved.extensions.filter((entry) => entry.metadata.origin === "top-level" && entry.metadata.scope === "user" && !entry.path.startsWith("builtin:")).map((entry): ManagedPlugin => ({
        id: extensionId(entry.path), kind: "extension", name: extensionName(entry.path), source: entry.path, enabled: entry.enabled, description: "" })),
      ...this.appPlugins.map((manifest): ManagedPlugin => ({
        id: appId(manifest.id), kind: "app", name: manifest.name, source: "Forgerie", description: manifest.description,
        enabled: appPluginEnabled(manifest, config.plugins[manifest.id]), settings: { ...resolveAppSettings(manifest, config.plugins[manifest.id]?.settings) },
        fields: [...manifest.settings],
      })),
      ...builtins.map(([name, description]): ManagedPlugin => ({
        id: `builtin:${name}`, kind: "builtin", name, source: "Forgerie", description,
        enabled: name === "codemode" ? config["codemode"] !== false : name === "ask-user" ? config["askUser"] !== false : true,
      })),
    ];
    const pendingPath = join(profile.dir, "forgerie-plugin-restart.json");
    const pending = pendingSchema.safeParse(parseJson(await textAt(pendingPath), pendingPath));
    // Both services must have restarted, not only web. An external restart clears the notice too.
    const restartRequired = pending.success && pending.data.required && (!services.available ||
      services.stamp.some((stamp, index) => stamp === pending.data.stamp[index]) || pending.data.stamp.length !== services.stamp.length);
    return { profileDir: profile.dir, configPath: profile.configPath, home: homedir(), revision: data.revision,
      plugins, restartRequired, restartAvailable: services.available };
  }
  change(revision: string, rawChange: PluginChange): Promise<PluginCatalog> {
    return this.enqueue(async () => {
      const change = changeSchema.parse(rawChange);
      const before = await this.list();
      if (revision !== before.revision) throw new PluginError(409, "Plugin settings changed since you opened them. Reload before saving.");
      const data = await this.snapshot();
      if (data.revision !== revision) throw new PluginError(409, "Plugin settings changed. Reload before saving.");
      const plugin = change.type === "add" ? undefined : before.plugins.find((entry) => entry.id === change.id);
      if (change.type !== "add" && plugin === undefined) throw new PluginError(404, "This plugin is no longer listed. Reload.");
      if (plugin?.kind === "builtin") throw new PluginError(403, "Built-in add-ons are part of Forgerie and are read-only.");
      if (change.type === "remove" && plugin?.kind !== "package") throw new PluginError(400, "Only Pi packages can be removed here. Turn extensions and app plugins off instead.");
      if (change.type === "settings" && plugin?.kind !== "app") throw new PluginError(400, "Only Forgerie app plugins have settings here.");
      if (change.type === "add" && before.plugins.some((entry) => entry.kind === "package" && entry.source === change.source)) throw new PluginError(409, "This package is already listed. Turn it on to restore it.");
      if (plugin?.kind === "app") {
        // The browser app reads these on its next load and after each save. No service holds them, so nothing restarts.
        const manifest = this.appPlugins.find((entry) => appId(entry.id) === plugin.id);
        if (manifest === undefined) throw new PluginError(404, "This plugin is no longer listed. Reload.");
        const old = data.config.plugins[manifest.id] ?? {};
        let settings: Record<string, unknown> | undefined;
        try { settings = change.type === "settings" ? storedAppSettings(manifest, change.settings) : undefined; }
        catch (error) { if (error instanceof AppSettingsError) throw new PluginError(400, error.message); throw error; }
        await this.writeWebEntry(data, manifest.id, settings !== undefined ? { ...old, settings } : change.type === "toggle" ? { ...old, enabled: change.enabled } : old);
        return this.list();
      }
      // Mark before mutation: a partial install or interrupted write still needs a restart.
      const services = await this.services.read();
      const pendingPath = join(data.profile.dir, "forgerie-plugin-restart.json");
      const existing = pendingSchema.safeParse(parseJson(await textAt(pendingPath), pendingPath));
      if (!before.restartRequired || !existing.success) await atomicWrite(pendingPath, { required: true, stamp: services.stamp });
      if (change.type === "add") {
        await this.gateway("/api/pi-packages/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: change.source }) });
      } else if (plugin === undefined) {
        throw new PluginError(404, "This plugin is no longer listed. Reload.");
      } else {
        const next = { ...data.settings };
        if (plugin.kind === "package") {
          const source = plugin.source;
          const active = next.packages.find((entry) => packageSource(entry) === source);
          const parked = next.forgerieDisabledPackages.find((entry) => packageSource(entry) === source);
          next.packages = next.packages.filter((entry) => packageSource(entry) !== source);
          next.forgerieDisabledPackages = next.forgerieDisabledPackages.filter((entry) => packageSource(entry) !== source);
          if (change.type === "toggle") {
            if (change.enabled) next.packages.push(active ?? parked ?? source);
            else next.forgerieDisabledPackages.push(active ?? parked ?? source);
          }
          // Remove means unregister, not delete shared local code or run npm uninstall on a live package.
        } else if (change.type === "toggle") {
          const path = plugin.source;
          const local = relative(data.profile.dir, path).split(sep).join("/");
          next.extensions = next.extensions.filter((pattern) => ![ `+${path}`, `-${path}`, `+${local}`, `-${local}` ].includes(pattern));
          next.extensions.push(`${change.enabled ? "+" : "-"}${path}`);
        }
        await mkdir(data.profile.dir, { recursive: true });
        // The same lock convention Pi uses. Publish by rename while holding it.
        const release = await lockfile.lock(data.settingsPath, { realpath: false });
        try {
          if (hash(await textAt(data.settingsPath)) !== hash(data.settingsText)) throw new PluginError(409, "Pi settings changed. Reload before saving.");
          await atomicWrite(data.settingsPath, next);
        } finally { await release(); }
      }
      return this.list();
    });
  }
  /** Update one `plugins[id]` entry through the server's config route, retaining the other keys. */
  private async writeWebEntry(data: { profile: { configPath: string }; configText: string; config: { plugins: Record<string, unknown> } }, id: string, entry: Record<string, unknown>) {
    const current = z.object({ config: objectSchema }).parse(await this.gateway("/api/config"));
    if (hash(await textAt(data.profile.configPath)) !== hash(data.configText)) throw new PluginError(409, "Forgerie config changed. Reload before saving.");
    await this.gateway("/api/config", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { ...current.config, plugins: { ...data.config.plugins, [id]: entry } } }) });
  }
  restart(revision: string): Promise<PluginCatalog> {
    return this.enqueue(async () => {
      const catalog = await this.list();
      if (catalog.revision !== revision) throw new PluginError(409, "Plugin settings changed. Reload before restarting.");
      if (!catalog.restartAvailable) throw new PluginError(503, "The local Forgerie services are unavailable. Restart Forgerie on its host.");
      // The restart takes this server down too, so the browser waits for it to
      // come back. The pending notice clears once both units carry new stamps.
      await this.services.restart();
      return this.list();
    });
  }
}
