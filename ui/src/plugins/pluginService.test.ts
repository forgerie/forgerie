import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { extensionName, PluginService, sourceName, type PluginServices } from "./pluginService";
import type { ForgerieProfile, Gateway } from "../settings/forgerieProfile";

let root: string;
let profile: ForgerieProfile;
let service: PluginService;
let stamp: string[];
let restarts: number;
let packagePath: string;
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
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
  const services: PluginServices = {
    read: async () => ({ available: true, stamp: [...stamp] }),
    restart: async () => { restarts += 1; stamp = ["web-2", "daemon-2"]; },
  };
  const gateway: Gateway = async (path, init) => {
    if (path === "/api/plugins") return { plugins: [ { id: "quota", source: "local", scope: "local", enabled: true }, { id: "other", source: "bundled", scope: "bundled", enabled: false } ] };
    if (path === "/api/config") {
      if (init?.method === "PUT") {
        const input = JSON.parse(String(init.body)) as { config: unknown };
        await json(profile.configPath, input.config);
      }
      return { path: profile.configPath, config: await readJson(profile.configPath) };
    }
    if (path === "/api/pi-packages/install") {
      const input = JSON.parse(String(init?.body)) as { source: string };
      const { manager, settingsManager } = piManager();
      await manager.installAndPersist(input.source);
      await settingsManager.flush();
      return {};
    }
    throw new Error(`Unexpected gateway path ${path}`);
  };
  service = new PluginService({ profile: async () => profile, gateway, services });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("plugin management", () => {
  it("lists real Pi resources, browser plugins, and built-ins without executing extension code", async () => {
    const catalog = await service.list();
    expect(catalog.profileDir).toBe(profile.dir);
    expect(catalog.plugins.map((entry) => entry.kind)).toEqual(["package", "extension", "forgerie", "forgerie", "builtin", "builtin", "builtin", "builtin"]);
    expect(catalog.plugins.find((entry) => entry.kind === "extension")).toMatchObject({ name: "loose", description: "", enabled: false });
    expect(catalog.restartRequired).toBe(false);
  });
  it("describes a package from its package.json, read as data", async () => {
    const catalog = await service.list();
    expect(catalog.plugins[0]).toMatchObject({ kind: "package", name: "@tests/test-plugin", source: packagePath, version: "1.2.3",
      description: "Adds a test tool.", installed: true, filtered: true });
    expect(catalog.plugins.filter((entry) => entry.kind === "forgerie").map((entry) => entry.description)).toEqual(["", ""]);
    expect(catalog.plugins.find((entry) => entry.id === "builtin:pi-subagents")?.description).toContain("agents in Settings");
    expect(catalog.home).not.toBe("");
  });
  it("names a configured package that is not on disk, without installing it", async () => {
    const settings = await readJson(join(profile.dir, "settings.json"));
    await json(join(profile.dir, "settings.json"), { ...settings, packages: [join(root, "nowhere")] });
    const catalog = await service.list();
    expect(catalog.plugins[0]).toMatchObject({ name: "nowhere", installed: false, description: "", filtered: false });
    expect(catalog.plugins[0]!.version).toBeUndefined();
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
    const id = catalog.plugins.find((entry) => entry.kind === "package")!.id;
    const off = await service.change(catalog.revision, { type: "toggle", id, enabled: false });
    expect((await readJson(join(profile.dir, "settings.json"))).packages).toEqual([]);
    expect(off.plugins.find((entry) => entry.id === id)?.enabled).toBe(false);
    const on = await service.change(off.revision, { type: "toggle", id, enabled: true });
    const restored = await readJson(join(profile.dir, "settings.json"));
    expect(restored.packages).toEqual(original.packages);
    expect(restored.arbitrary).toEqual({ preserve: true });
    expect(on.restartRequired).toBe(true);
    expect(await readJson(join(root, "global-pi", "settings.json"))).toEqual({ packages: ["do-not-touch"] });
  });
  it("uses exact extension overrides without deleting a wildcard or the extension", async () => {
    const catalog = await service.list();
    const entry = catalog.plugins.find((plugin) => plugin.kind === "extension")!;
    const on = await service.change(catalog.revision, { type: "toggle", id: entry.id, enabled: true });
    expect(on.plugins.find((plugin) => plugin.id === entry.id)?.enabled).toBe(true);
    const off = await service.change(on.revision, { type: "toggle", id: entry.id, enabled: false });
    expect(off.plugins.find((plugin) => plugin.id === entry.id)?.enabled).toBe(false);
    expect((await readJson(join(profile.dir, "settings.json"))).extensions).toEqual(["!extensions/*.ts", `-${entry.source}`]);
    expect(await readFile(entry.source, "utf8")).toContain("Do not execute");
  });
  it("edits one browser plugin without losing another plugin or config fields", async () => {
    const catalog = await service.list();
    const changed = await service.change(catalog.revision, { type: "settings", id: "forgerie:quota", settings: { five_hour: true, new_value: { x: 1 } } });
    const off = await service.change(changed.revision, { type: "toggle", id: "forgerie:quota", enabled: false });
    expect(off.plugins.find((entry) => entry.id === "forgerie:quota")?.enabled).toBe(false);
    const config = await readJson(profile.configPath);
    expect(config.port).toBe(8504);
    expect(config.plugins).toEqual({ quota: { enabled: false, settings: { five_hour: true, new_value: { x: 1 } }, custom: "keep" }, other: { enabled: false } });
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
    await expect(service.change(catalog.revision, { type: "toggle", id: "forgerie:quota", enabled: false })).rejects.toMatchObject({ status: 409 });
    const current = await service.list();
    await expect(service.change(current.revision, { type: "toggle", id: "builtin:pi-subagents", enabled: false })).rejects.toMatchObject({ status: 403 });
    await expect(service.change(current.revision, { type: "remove", id: "forgerie:quota" })).rejects.toMatchObject({ status: 400 });
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
