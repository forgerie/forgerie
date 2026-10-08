import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { activeForgerieProfile, forgerieGateway, type ForgerieProfile, type Gateway } from "../settings/forgerieProfile";
import { changeSchema, type ManagedPlugin, type PluginCatalog, type PluginChange } from "./pluginsApi";

const objectSchema = z.record(z.string(), z.unknown());
const packageSchema = z.union([z.string(), z.object({ source: z.string() }).passthrough()]);
const settingsSchema = z.object({ packages: z.array(packageSchema).default([]), extensions: z.array(z.string()).default([]),
  forgerieDisabledPackages: z.array(packageSchema).default([]),
}).passthrough();
const webConfigSchema = z.object({ plugins: z.record(z.string(), z.object({ enabled: z.boolean().optional(), settings: objectSchema.optional() }).passthrough()).default({}) }).passthrough();
const webListSchema = z.object({ plugins: z.array(z.object({ id: z.string(), source: z.string(), scope: z.string(), enabled: z.boolean() })) });
const pendingSchema = z.object({ stamp: z.array(z.string()), required: z.boolean() });
const packageJsonSchema = z.object({ name: z.string().optional(), version: z.string().optional(), description: z.string().optional() });
const builtins: readonly (readonly [string, string])[] = [
  ["pi-subagents", "Lets a session hand work to the agents in Settings."],
  ["pi-processes", "Runs dev servers, watchers, and other long commands in the background."],
  ["codemode", "Lets the model run several tool calls from one JavaScript script."],
  ["ask-user", "Lets the agent ask you a question in a browser form."],
];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const packageSource = (entry: z.infer<typeof packageSchema>) => typeof entry === "string" ? entry : entry.source;
const packageId = (source: string) => `package:${source}`;
const extensionId = (path: string) => `extension:${path}`;
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

export class PluginError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
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
    await exec("systemctl", ["--user", "restart", ...units], { timeout: 60_000 });
    await exec("systemctl", ["--user", "is-active", ...units], { timeout: 5000 });
  },
};

async function textAt(path: string): Promise<string> {
  try { return await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "{}";
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
 * The running gateway owns installs and Forgerie plugin discovery.
 */
export class PluginService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: {
    profile?: () => Promise<ForgerieProfile>;
    gateway?: Gateway;
    services?: PluginServices;
  } = {}) {}
  private get gateway() { return this.options.gateway ?? forgerieGateway; }
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
    const [settingsText, configText] = await Promise.all([textAt(settingsPath), textAt(profile.configPath)]);
    const settings = settingsSchema.parse(parseJson(settingsText, settingsPath));
    const config = webConfigSchema.parse(parseJson(configText, profile.configPath));
    return { profile, settingsPath, settingsText, configText, settings, config,
      revision: hash(JSON.stringify([profile.revision, settingsText, configText])) };
  }
  async list(): Promise<PluginCatalog> {
    const data = await this.snapshot();
    const { profile, settings, config } = data;
    const manager = new DefaultPackageManager({ cwd: profile.dir, agentDir: profile.dir,
      settingsManager: SettingsManager.create(profile.dir, profile.dir, { projectTrusted: false }) });
    const [resolved, web, services] = await Promise.all([manager.resolve(async () => "skip"), this.gateway("/api/plugins"), this.services.read()]);
    // Reads package.json as data. Locating a package never loads its code or installs a missing one.
    const describePackage = async (entry: z.infer<typeof packageSchema>, enabled: boolean): Promise<ManagedPlugin> => {
      const source = packageSource(entry);
      let path: string | undefined;
      try { path = manager.getInstalledPath(source, "user"); } catch { path = undefined; }
      let info: z.infer<typeof packageJsonSchema> = {};
      if (path) {
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
      ...webListSchema.parse(web).plugins.map((entry): ManagedPlugin => ({
        id: `forgerie:${entry.id}`, kind: "forgerie", name: entry.id, source: entry.source, description: "",
        enabled: config.plugins[entry.id]?.enabled !== false, settings: config.plugins[entry.id]?.settings ?? {},
      })),
      ...builtins.map(([name, description]): ManagedPlugin => ({
        id: `builtin:${name}`, kind: "builtin", name, source: "Forgerie", description,
        enabled: name === "codemode" ? config.codemode !== false : name === "ask-user" ? config.askUser !== false : true,
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
      if (change.type !== "add" && !plugin) throw new PluginError(404, "This plugin is no longer listed. Reload.");
      if (plugin?.kind === "builtin") throw new PluginError(403, "Built-in add-ons are part of Forgerie and are read-only.");
      if (change.type === "remove" && plugin?.kind !== "package") throw new PluginError(400, "Only Pi packages can be removed here. Turn extensions and browser plugins off instead.");
      if (change.type === "settings" && plugin?.kind !== "forgerie") throw new PluginError(400, "Only Forgerie browser plugins have settings here.");
      if (change.type === "add" && before.plugins.some((entry) => entry.kind === "package" && entry.source === change.source)) throw new PluginError(409, "This package is already listed. Turn it on to restore it.");
      // Mark before mutation: a partial install or interrupted write still needs a restart.
      const services = await this.services.read();
      const pendingPath = join(data.profile.dir, "forgerie-plugin-restart.json");
      const existing = pendingSchema.safeParse(parseJson(await textAt(pendingPath), pendingPath));
      if (!before.restartRequired || !existing.success) await atomicWrite(pendingPath, { required: true, stamp: services.stamp });
      if (change.type === "add") {
        await this.gateway("/api/pi-packages/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: change.source }) });
      } else if (plugin!.kind === "forgerie") {
        const id = plugin!.id.slice("forgerie:".length);
        const old = data.config.plugins[id] ?? {};
        const entry = change.type === "settings" ? { ...old, settings: change.settings } : change.type === "toggle" ? { ...old, enabled: change.enabled } : old;
        // Update only this entry through the existing server config route, retaining the other keys.
        const current = z.object({ config: objectSchema }).parse(await this.gateway("/api/config"));
        if (hash(await textAt(data.profile.configPath)) !== hash(data.configText)) throw new PluginError(409, "Forgerie config changed. Reload before saving.");
        await this.gateway("/api/config", { method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ config: { ...current.config, plugins: { ...data.config.plugins, [id]: entry } } }) });
      } else {
        const next = { ...data.settings };
        if (plugin!.kind === "package") {
          const source = plugin!.source;
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
          const path = plugin!.source;
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
  restart(revision: string): Promise<PluginCatalog> {
    return this.enqueue(async () => {
      const catalog = await this.list();
      if (catalog.revision !== revision) throw new PluginError(409, "Plugin settings changed. Reload before restarting.");
      if (!catalog.restartAvailable) throw new PluginError(503, "The local Forgerie services are unavailable. Restart Forgerie on its host.");
      await this.services.restart();
      // systemd's active state precedes gateway readiness. Check the actual profile and plugin API too.
      const deadline = Date.now() + 30_000;
      for (;;) {
        try { await this.list(); break; }
        catch (error) {
          if (Date.now() >= deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      await atomicWrite(join(catalog.profileDir, "forgerie-plugin-restart.json"), { required: false, stamp: [] });
      return this.list();
    });
  }
}
