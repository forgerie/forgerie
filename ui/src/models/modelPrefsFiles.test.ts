import { createServer } from "vite";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { modelPrefsApi, PrefsError, readPrefs, savePrefs, type ModelPrefsPaths } from "./modelPrefsFiles";

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof createServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function paths(settings?: Record<string, unknown>): Promise<ModelPrefsPaths> {
  const root = await mkdtemp(join(tmpdir(), "model-prefs-")); roots.push(root);
  await mkdir(join(root, "agent")); await mkdir(join(root, "config"));
  const result = { settings: join(root, "agent", "settings.json"), visible: join(root, "config", "visible-models.json") };
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
    const root = await mkdtemp(join(tmpdir(), "model-prefs-http-")); roots.push(root);
    const server = await createServer({ configFile: false, root, plugins: [modelPrefsApi(async () => files)], server: { port: 0, host: "127.0.0.1" } });
    servers.push(server);
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    const url = `http://127.0.0.1:${String(address.port)}/aui/model-prefs`;
    const read = await (await fetch(url)).json() as { revision: string };
    const put = (headers: Record<string, string> = {}) => fetch(url, { method: "PUT", headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ revision: read.revision, favorites: ["proxy/b"], visible: null }) });
    expect((await put({ origin: "https://elsewhere.example" })).status).toBe(403);
    const saved = await put();
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ favorites: ["proxy/b"] });
    expect((await put()).status).toBe(409);
  });
});
