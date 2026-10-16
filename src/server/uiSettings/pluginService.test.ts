import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { extensionName, githubRepository, PluginService, README_MAX_BYTES, sourceName, type PluginServices } from "./pluginService.js";
import type { ForgerieProfile, Gateway } from "./forgerieProfile.js";
import type { AppPluginManifest } from "../../shared/appPlugins.js";

let root: string;
let profile: ForgerieProfile;
let service: PluginService;
let stamp: string[];
let restarts: number;
let packagePath: string;
let services: PluginServices;
let gateway: Gateway;
const recordSchema = z.record(z.string(), z.unknown());
const readJson = async (path: string) => recordSchema.parse(JSON.parse(await readFile(path, "utf8")));
const json = (path: string, value: unknown) => writeFile(path, JSON.stringify(value));
const piManager = () => {
  const settingsManager = SettingsManager.create(profile.dir, profile.dir, { projectTrusted: false });
  return { settingsManager, manager: new DefaultPackageManager({ cwd: profile.dir, agentDir: profile.dir, settingsManager }) };
};
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "forgerie-plugins-"));
  profile = { dir: join(root, "owned-agent"), configPath: join(root, "config.json"), command: "pi", revision: "runtime-1" };
  await mkdir(join(profile.dir, "extensions"), { recursive: true });
  await mkdir(join(profile.dir, "agents"));
  await writeFile(join(profile.dir, "agents", "writer.md"), "---\nname: writer\n---\nWrite.\n");
  await mkdir(join(root, "global-pi"));
  await json(join(root, "global-pi", "settings.json"), { packages: ["do-not-touch"] });
  packagePath = join(root, "local-package");
  await mkdir(packagePath);
  await json(join(packagePath, "package.json"), { name: "@tests/test-plugin", version: "1.2.3", description: "  Adds a test tool.  ", pi: { extensions: ["index.ts"] } });
  await writeFile(join(packagePath, "index.ts"), "throw new Error('Listing must never execute plugin code');");
  await writeFile(join(profile.dir, "extensions", "loose.ts"), "throw new Error('Do not execute');");
  await json(join(profile.dir, "settings.json"), { packages: [{ source: packagePath, extensions: ["index.ts"], themes: [] }], extensions: ["!extensions/*.ts"], theme: "keep-me", arbitrary: { preserve: true } });
  await json(profile.configPath, { host: "127.0.0.1", port: 8504, plugins: { quota: { settings: { five_hour: false }, custom: "keep" }, other: { enabled: false } } });
  stamp = ["web-1", "daemon-1"]; restarts = 0;
  services = {
    read: () => Promise.resolve({ available: true, stamp: [...stamp] }),
    restart: () => { restarts += 1; stamp = ["web-2", "daemon-2"]; return Promise.resolve(); },
  };
  gateway = async (path, init) => {
    if (path === "/api/config") {
      if (init?.method === "PUT") {
        const input = z.object({ config: z.unknown() }).parse(JSON.parse(String(init.body)));
        await json(profile.configPath, input.config);
      }
      return { path: profile.configPath, config: await readJson(profile.configPath) };
    }
    if (path === "/api/pi-packages/install") {
      const input = z.object({ source: z.string() }).parse(JSON.parse(String(init?.body)));
      const { manager, settingsManager } = piManager();
      await manager.installAndPersist(input.source);
      await settingsManager.flush();
      return {};
    }
    throw new Error(`Unexpected gateway path ${path}`);
  };
  service = new PluginService({ profile: () => Promise.resolve(profile), gateway, services });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("plugin management", () => {
  it("lists real Pi resources, app plugins, and built-ins without executing extension code", async () => {
    const catalog = await service.list();
    expect(catalog.profileDir).toBe(profile.dir);
    expect(catalog.plugins.map((entry) => entry.kind)).toEqual(["package", "extension", "app", "app", "app", "builtin", "builtin", "builtin"]);
    expect(catalog.plugins.find((entry) => entry.kind === "extension")).toMatchObject({ name: "loose", description: "", enabled: false });
    expect(catalog.restartRequired).toBe(false);
  });
  it("keeps decision hints off by default and saves their master switch without restart", async () => {
    const catalog = await service.list();
    expect(catalog.plugins.find((entry) => entry.id === "app:decision-hints")).toMatchObject({ enabled: false, settings: { gateway_url: "", model: "fast", sensitivity: "normal" } });
    expect((await service.appStates()).plugins.find((entry) => entry.id === "decision-hints")?.enabled).toBe(false);
    const configured = await service.change(catalog.revision, { type: "settings", id: "app:decision-hints", settings: { gateway_url: "http://127.0.0.1:4000", model: "chosen", sensitivity: "high" } });
    const enabled = await service.change(configured.revision, { type: "toggle", id: "app:decision-hints", enabled: true });
    expect(enabled.restartRequired).toBe(false);
    expect((await service.appStates()).plugins.find((entry) => entry.id === "decision-hints")).toMatchObject({ enabled: true, settings: { model: "chosen", sensitivity: "high" } });
    await expect(service.change(enabled.revision, { type: "settings", id: "app:decision-hints", settings: { apiKey: "secret" } })).rejects.toMatchObject({ status: 400 });
    expect(JSON.stringify(await service.list())).not.toContain("secret");
  });
  it("describes a package from its package.json, read as data", async () => {
    const catalog = await service.list();
    expect(catalog.plugins[0]).toMatchObject({ kind: "package", name: "@tests/test-plugin", source: packagePath, version: "1.2.3",
      description: "Adds a test tool.", installed: true, filtered: true });
    expect(catalog.plugins.find((entry) => entry.id === "builtin:processes")?.description).toContain("long commands");
    expect(catalog.plugins.some((entry) => entry.id === "builtin:pi-subagents")).toBe(false);
    expect(catalog.home).not.toBe("");
  });
  it("names a configured package that is not on disk, without installing it", async () => {
    const settings = await readJson(join(profile.dir, "settings.json"));
    await json(join(profile.dir, "settings.json"), { ...settings, packages: [join(root, "nowhere")] });
    const catalog = await service.list();
    expect(catalog.plugins[0]).toMatchObject({ name: "nowhere", installed: false, description: "", filtered: false });
    expect(catalog.plugins[0]?.version).toBeUndefined();
  });
  it("reads a configured package's README as text, preferring Markdown and skipping symlinks", async () => {
    const id = `package:${packagePath}`;
    expect(await service.readme(id)).toEqual({ text: null, truncated: false });
    await writeFile(join(packagePath, "README"), "plain");
    await writeFile(join(packagePath, "readme.md"), "# test-plugin\n\nUse it.\n");
    expect(await service.readme(id)).toEqual({ text: "# test-plugin\n\nUse it.\n", file: "readme.md", truncated: false });
    await rm(join(packagePath, "readme.md"));
    await writeFile(join(root, "secret.txt"), "secret");
    await symlink(join(root, "secret.txt"), join(packagePath, "README.md"));
    expect(await service.readme(id)).toMatchObject({ text: "plain", file: "README" });
    await expect(service.readme(`package:${root}`)).rejects.toMatchObject({ status: 404 });
  });
  it("finds where a GitHub repository serves a README's relative files", async () => {
    const base = { blob: "https://github.com/o/r/blob/HEAD/", raw: "https://raw.githubusercontent.com/o/r/HEAD/", directory: "" };
    for (const url of ["o/r", "github:o/r", "git+https://github.com/o/r.git", "https://github.com/o/r", "git@github.com:o/r.git", "git://github.com/o/r.git", "git+ssh://git@github.com/o/r.git"]) {
      expect(githubRepository(url), url).toEqual(base);
    }
    expect(githubRepository({ url: "https://github.com/o/r", directory: "./packages/tool/" })).toEqual({ ...base, directory: "packages/tool/" });
    expect(githubRepository("https://gitlab.com/o/r")).toBeUndefined();
    expect(githubRepository("gitlab:o/r")).toBeUndefined();
    await writeFile(join(packagePath, "README.md"), "![shot](docs/shot.png)");
    await json(join(packagePath, "package.json"), { name: "@tests/test-plugin", repository: { type: "git", url: "git+https://github.com/o/r.git" } });
    expect((await service.readme(`package:${packagePath}`)).repository).toEqual(base);
  });
  it("stops a long README at the limit and says so", async () => {
    await writeFile(join(packagePath, "README.md"), `${"a".repeat(README_MAX_BYTES - 1)}é more`);
    const readme = await service.readme(`package:${packagePath}`);
    expect(readme.truncated).toBe(true);
    expect(readme.text).toBe("a".repeat(README_MAX_BYTES - 1));
  });
  it("derives a name from a source when there is no package.json", () => {
    expect(sourceName("npm:@router-for-me/pi-cliproxyapi-provider@1.4.18")).toBe("@router-for-me/pi-cliproxyapi-provider");
    expect(sourceName("npm:pi-goal@0.4.0")).toBe("pi-goal");
    expect(sourceName("npm:pi-goal")).toBe("pi-goal");
    expect(sourceName("git:github.com/someone/pi-tools@v2")).toBe("pi-tools");
    expect(sourceName("https://github.com/someone/pi-tools.git")).toBe("pi-tools");
    expect(sourceName("/home/me/code/pi-mobbin/")).toBe("pi-mobbin");
    expect(extensionName("/profile/extensions/startup-context.ts")).toBe("startup-context");
    expect(extensionName("/profile/extensions/direnv/index.ts")).toBe("direnv");
  });
  it("disables and restores the entire filtered package entry and preserves other settings", async () => {
    const original = await readJson(join(profile.dir, "settings.json"));
    const catalog = await service.list();
    const id = catalog.plugins.find((entry) => entry.kind === "package")?.id ?? "";
    const off = await service.change(catalog.revision, { type: "toggle", id, enabled: false });
    expect((await readJson(join(profile.dir, "settings.json")))["packages"]).toEqual([]);
    expect(off.plugins.find((entry) => entry.id === id)?.enabled).toBe(false);
    const on = await service.change(off.revision, { type: "toggle", id, enabled: true });
    const restored = await readJson(join(profile.dir, "settings.json"));
    expect(restored["packages"]).toEqual(original["packages"]);
    expect(restored["arbitrary"]).toEqual({ preserve: true });
    expect(on.restartRequired).toBe(true);
    expect(await readJson(join(root, "global-pi", "settings.json"))).toEqual({ packages: ["do-not-touch"] });
  });
  it("uses exact extension overrides without deleting a wildcard or the extension", async () => {
    const catalog = await service.list();
    const entry = catalog.plugins.find((plugin) => plugin.kind === "extension");
    if (entry === undefined) throw new Error("No extension listed.");
    const on = await service.change(catalog.revision, { type: "toggle", id: entry.id, enabled: true });
    expect(on.plugins.find((plugin) => plugin.id === entry.id)?.enabled).toBe(true);
    const off = await service.change(on.revision, { type: "toggle", id: entry.id, enabled: false });
    expect(off.plugins.find((plugin) => plugin.id === entry.id)?.enabled).toBe(false);
    expect((await readJson(join(profile.dir, "settings.json")))["extensions"]).toEqual(["!extensions/*.ts", `-${entry.source}`]);
    expect(await readFile(entry.source, "utf8")).toContain("Do not execute");
  });
  it("unregisters a package without deleting its code", async () => {
    const catalog = await service.list();
    await service.change(catalog.revision, { type: "remove", id: `package:${packagePath}` });
    expect((await service.list()).plugins.some((entry) => entry.source === packagePath)).toBe(false);
    expect(await readFile(join(packagePath, "index.ts"), "utf8")).toContain("Listing must never");
  });
  it("adds a real local package through Pi's existing install contract", async () => {
    const additional = join(root, "additional"); await mkdir(additional);
    await json(join(additional, "package.json"), { name: "additional", pi: { extensions: [] } });
    const catalog = await service.list();
    const added = await service.change(catalog.revision, { type: "add", source: additional });
    expect(added.plugins.some((entry) => entry.kind === "package" && entry.source.endsWith("additional"))).toBe(true);
  });
  it("rejects stale writes, built-in edits, invalid removals, and unknown targets", async () => {
    const catalog = await service.list();
    await json(profile.configPath, { port: 9999, plugins: {} });
    await expect(service.change(catalog.revision, { type: "toggle", id: "app:cliproxyapi-quota", enabled: false })).rejects.toMatchObject({ status: 409 });
    const current = await service.list();
    await expect(service.change(current.revision, { type: "toggle", id: "builtin:processes", enabled: false })).rejects.toMatchObject({ status: 403 });
    await expect(service.change(current.revision, { type: "remove", id: "app:cliproxyapi-quota" })).rejects.toMatchObject({ status: 400 });
    await expect(service.change(current.revision, { type: "toggle", id: "missing", enabled: false })).rejects.toMatchObject({ status: 404 });
  });
  it("retains the pending restart across reads and clears it only when both units restart", async () => {
    const catalog = await service.list();
    await service.change(catalog.revision, { type: "toggle", id: `package:${packagePath}`, enabled: false });
    expect((await service.list()).restartRequired).toBe(true);
    stamp = ["web-2", "daemon-1"];
    expect((await service.list()).restartRequired).toBe(true);
    stamp = ["web-2", "daemon-2"];
    expect((await service.list()).restartRequired).toBe(false);
    const now = await service.list();
    const restarted = await service.restart(now.revision);
    expect(restarts).toBe(1);
    expect(restarted.restartRequired).toBe(false);
  });
});

describe("plugins bundled with the browser app", () => {
  const meters: AppPluginManifest = { id: "quota", name: "Account meters", description: "Draws quota.", settings: [
    { type: "url", id: "endpoint", label: "Quota address", description: "", default: "https://router.example/quota" },
    { type: "boolean", id: "five_hour", label: "Five-hour window", description: "", default: true },
    { type: "boolean", id: "seven_day", label: "Seven-day window", description: "", default: true },
  ] };
  const bundled = () => new PluginService({ profile: () => Promise.resolve(profile), gateway, services, appPlugins: [meters] });
  it("takes over the original client plugin's id and keeps the settings saved under it", async () => {
    const catalog = await bundled().list();
    expect(catalog.plugins.filter((entry) => entry.id.endsWith(":quota"))).toEqual([{ id: "app:quota", kind: "app", name: "Account meters", source: "Forgerie",
      description: "Draws quota.", enabled: true, settings: { endpoint: "https://router.example/quota", five_hour: false, seven_day: true }, fields: meters.settings }]);
    expect(await bundled().appStates()).toEqual({ plugins: [{ id: "quota", enabled: true,
      settings: { endpoint: "https://router.example/quota", five_hour: false, seven_day: true } }] });
  });
  it("saves settings and the on switch without asking for a restart, storing only what differs from a default", async () => {
    const service = bundled();
    const catalog = await service.list();
    const saved = await service.change(catalog.revision, { type: "settings", id: "app:quota",
      settings: { endpoint: "http://127.0.0.1:8317/quota", five_hour: true, seven_day: false } });
    const off = await service.change(saved.revision, { type: "toggle", id: "app:quota", enabled: false });
    expect(off.restartRequired).toBe(false);
    expect((await readJson(profile.configPath))["plugins"]).toEqual({
      quota: { enabled: false, settings: { endpoint: "http://127.0.0.1:8317/quota", seven_day: false }, custom: "keep" }, other: { enabled: false } });
    expect((await service.appStates()).plugins[0]).toEqual({ id: "quota", enabled: false,
      settings: { endpoint: "http://127.0.0.1:8317/quota", five_hour: true, seven_day: false } });
  });
  it("refuses settings the plugin does not declare and writes nothing", async () => {
    const service = bundled();
    const catalog = await service.list();
    const before = await readFile(profile.configPath, "utf8");
    await expect(service.change(catalog.revision, { type: "settings", id: "app:quota", settings: { endpoint: "file:///etc/passwd" } }))
      .rejects.toMatchObject({ status: 400, message: "Quota address must be an http or https address." });
    await expect(service.change(catalog.revision, { type: "settings", id: "app:quota", settings: { stray: true } })).rejects.toMatchObject({ status: 400 });
    await expect(service.change(catalog.revision, { type: "remove", id: "app:quota" })).rejects.toMatchObject({ status: 400 });
    expect(await readFile(profile.configPath, "utf8")).toBe(before);
  });
});
