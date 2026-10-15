import { BrowserFileAccess } from "../browserFileAccess.js";
import { dirname } from "node:path";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { PrefsError, readPrefs, savePrefs, type ModelPrefsPaths } from "./modelPrefsFiles.js";
import { registerUiSettingsRoutes } from "./routes.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function paths(settings?: Record<string, unknown>): Promise<ModelPrefsPaths> {
  const root = await mkdtemp(join(tmpdir(), "model-prefs-")); roots.push(root);
  await mkdir(join(root, "agent")); await mkdir(join(root, "config"));
  const result = { settings: join(root, "agent", "settings.json"), visible: join(root, "config", "visible-models.json"), config: join(root, "config", "config.json") };
  if (settings) await writeFile(result.settings, JSON.stringify(settings, null, 2), { mode: 0o600 });
  return result;
}
const exists = (path: string) => stat(path).then(() => true, () => false);

describe("model list files", () => {
  it("reads Pi's enabledModels as favorites, and no shown list as every model", async () => {
    const files = await paths({ theme: "dark", enabledModels: ["proxy/a", "proxy/b:high"] });
    expect(await readPrefs(files)).toMatchObject({ favorites: ["proxy/a", "proxy/b:high"], visible: null, favoritesPath: files.settings });
  });

  it("changes only enabledModels in Pi's settings, keeps the file's mode, and leaves no lock behind", async () => {
    const files = await paths({ theme: "dark", enabledModels: ["proxy/a"], packages: ["npm:x"] });
    const before = await readPrefs(files);
    const after = await savePrefs(files, { revision: before.revision, favorites: ["proxy/a", "proxy/c"], visible: ["proxy/a", "proxy/c"] });
    expect(after).toMatchObject({ favorites: ["proxy/a", "proxy/c"], visible: ["proxy/a", "proxy/c"] });
    expect(JSON.parse(await readFile(files.settings, "utf8"))).toEqual({ theme: "dark", enabledModels: ["proxy/a", "proxy/c"], packages: ["npm:x"] });
    expect((await stat(files.settings)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(files.visible, "utf8"))).toEqual({ visible: ["proxy/a", "proxy/c"] });
    expect(await exists(`${files.settings}.lock`)).toBe(false);
    expect(after.revision).not.toBe(before.revision);
  });

  it("reads and writes Pi's default model and level, splitting the provider at the first slash", async () => {
    const files = await paths({ defaultProvider: "proxy", defaultModel: "a", defaultThinkingLevel: "xhigh", theme: "dark" });
    const before = await readPrefs(files);
    expect(before).toMatchObject({ defaultModel: "proxy/a", defaultThinkingLevel: "xhigh" });
    const after = await savePrefs(files, { revision: before.revision, favorites: [], visible: null, defaultModel: "openrouter/openai/gpt-5", defaultThinkingLevel: "low" });
    expect(after).toMatchObject({ defaultModel: "openrouter/openai/gpt-5", defaultThinkingLevel: "low" });
    expect(JSON.parse(await readFile(files.settings, "utf8"))).toEqual({ defaultProvider: "openrouter", defaultModel: "openai/gpt-5", defaultThinkingLevel: "low", theme: "dark" });
    // A save without the defaults leaves them alone.
    await savePrefs(files, { revision: after.revision, favorites: ["proxy/a"], visible: null });
    expect(JSON.parse(await readFile(files.settings, "utf8"))).toMatchObject({ defaultProvider: "openrouter", defaultThinkingLevel: "low" });
  });

  it("drops enabledModels when no favorite is left, and the shown list when every model is shown again", async () => {
    const files = await paths({ enabledModels: ["proxy/a"] });
    await writeFile(files.visible, JSON.stringify({ visible: ["proxy/a"] }));
    const before = await readPrefs(files);
    await savePrefs(files, { revision: before.revision, favorites: [], visible: null });
    expect(JSON.parse(await readFile(files.settings, "utf8"))).toEqual({});
    expect(await exists(files.visible)).toBe(false);
  });

  it("reads and writes the title model as sessionTitleModel in Forgerie's config, and leaves its other keys alone", async () => {
    const files = await paths();
    await writeFile(files.config, JSON.stringify({ port: 8504, plugins: { relays: { enabled: true } }, sessionTitleModel: "proxy/small" }, null, 2));
    const before = await readPrefs(files);
    expect(before).toMatchObject({ titleModel: "proxy/small", configPath: files.config });
    const after = await savePrefs(files, { revision: before.revision, favorites: [], visible: null, titleModel: "openrouter/openai/gpt-5-nano" });
    expect(after.titleModel).toBe("openrouter/openai/gpt-5-nano");
    expect(after.revision).not.toBe(before.revision);
    expect(JSON.parse(await readFile(files.config, "utf8"))).toEqual({ port: 8504, plugins: { relays: { enabled: true } }, sessionTitleModel: "openrouter/openai/gpt-5-nano" });
    // A save without the title model leaves it alone; null hands titles back to each session's model.
    const kept = await savePrefs(files, { revision: after.revision, favorites: ["proxy/a"], visible: null });
    expect(kept.titleModel).toBe("openrouter/openai/gpt-5-nano");
    const cleared = await savePrefs(files, { revision: kept.revision, favorites: ["proxy/a"], visible: null, titleModel: null });
    expect(cleared.titleModel).toBeNull();
    expect(JSON.parse(await readFile(files.config, "utf8"))).toEqual({ port: 8504, plugins: { relays: { enabled: true } } });
    expect(await exists(`${files.config}.${String(process.pid)}.tmp`)).toBe(false);
  });

  it("reads no title model when Forgerie's config is missing, and refuses one that is not JSON", async () => {
    const files = await paths();
    expect((await readPrefs(files)).titleModel).toBeNull();
    await writeFile(files.config, "{ not json");
    await expect(readPrefs(files)).rejects.toMatchObject({ status: 500 });
  });

  it("refuses a save made from lists that changed since they were read", async () => {
    const files = await paths({ enabledModels: ["proxy/a"] });
    const before = await readPrefs(files);
    await writeFile(files.settings, JSON.stringify({ enabledModels: ["proxy/b"] }));
    await expect(savePrefs(files, { revision: before.revision, favorites: ["proxy/a", "proxy/c"], visible: null })).rejects.toMatchObject({ status: 409 });
    expect(JSON.parse(await readFile(files.settings, "utf8"))).toEqual({ enabledModels: ["proxy/b"] });
  });

  it("waits for Pi's settings lock and refuses a settings file that is not JSON", async () => {
    const files = await paths({ enabledModels: [] });
    await mkdir(`${files.settings}.lock`);
    const before = await readPrefs(files);
    const save = savePrefs(files, { revision: before.revision, favorites: ["proxy/a"], visible: null });
    setTimeout(() => { void rm(`${files.settings}.lock`, { recursive: true }); }, 60);
    await expect(save).resolves.toMatchObject({ favorites: ["proxy/a"] });
    await writeFile(files.settings, "{ not json");
    await expect(readPrefs(files)).rejects.toBeInstanceOf(PrefsError);
  });

  it("serves GET and PUT, and refuses a change from another site", async () => {
    const files = await paths({ enabledModels: ["proxy/a"] });
    const app = Fastify({ logger: false });
    await registerUiSettingsRoutes(app, { modelPrefsPaths: () => Promise.resolve(files), fileAccess: () => Promise.resolve(new BrowserFileAccess(dirname(files.settings))) });
    const read: { revision: string } = (await app.inject("/aui/model-prefs")).json();
    const put = async (headers: Record<string, string> = {}) => {
      const response = await app.inject({ method: "PUT", url: "/aui/model-prefs", headers: { "content-type": "application/json", host: "forgerie.test", ...headers },
        payload: JSON.stringify({ revision: read.revision, favorites: ["proxy/b"], visible: null }) });
      return { status: response.statusCode, json: () => Promise.resolve(response.json()) };
    };
    expect((await put({ origin: "https://elsewhere.example" })).status).toBe(403);
    const saved = await put();
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ favorites: ["proxy/b"] });
    expect((await put()).status).toBe(409);
    await app.close();
  });
});
