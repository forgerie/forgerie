import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { modelChainsProblem, parseModelChoice, resolveModelChain, type ModelChains } from "../../shared/modelChains.js";
import { modelPrefsSaveSchema, type ModelPrefs, type ModelPrefsSave } from "../../shared/modelPrefsContract.js";
import { activeForgerieProfile, type Gateway } from "./forgerieProfile.js";
import { errorMessage, isErrnoCode, readJsonBody, refuseCrossSite, sendJson, SettingsHttpError } from "./http.js";
import type { Middleware } from "./routes.js";

/**
 * API for the app's model lists. Favorites are Pi's `enabledModels`
 * in the active profile's `settings.json`, so terminal Pi with the same profile
 * sees the same favorites. Shown models are Forgerie's own list, beside
 * Forgerie's config. The title model is the `sessionTitleModel` key in
 * Forgerie's config, which sessiond reads each time it writes a title. Model
 * chains are the `modelChains` key in the same file, which sessiond reads at
 * each child spawn and model switch.
 *
 *   GET /aui/model-prefs   the lists, the chains, and their revision
 *   PUT /aui/model-prefs   { revision, favorites, visible, defaultModel?, defaultThinkingLevel?, titleModel?, modelChains? }
 *                          (409 if the revision moved, 400 if the chains break the chain rules)
 */
export const MODEL_PREFS_PATH = "/aui/model-prefs";

export interface ModelPrefsPaths { settings: string; visible: string; config: string }
export class PrefsError extends SettingsHttpError {}

export async function defaultPrefsPaths(gateway: Gateway): Promise<ModelPrefsPaths> {
  const profile = await activeForgerieProfile(gateway);
  return { settings: join(profile.dir, "settings.json"), visible: join(dirname(profile.configPath), "visible-models.json"), config: profile.configPath };
}

const visibleFileSchema = z.object({ visible: z.array(z.string()) });
const settingsSchema = z.record(z.string(), z.unknown());

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch((error: unknown) => {
    if (isErrnoCode(error, "ENOENT")) return undefined;
    throw error;
  });
}
function parseSettings(text: string | undefined, path: string): Record<string, unknown> {
  if (text === undefined) return {};
  try { return settingsSchema.parse(JSON.parse(text.replace(/^\uFEFF/, ""))); }
  catch { throw new PrefsError(500, `${path} is not a JSON object. Fix it before you change favorites.`); }
}
const favoritesOf = (settings: Record<string, unknown>) => {
  const value = settings["enabledModels"];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};
const textOf = (value: unknown) => typeof value === "string" && value !== "" ? value : null;
/** Pi's default model, as one `provider/id` key. Pi needs both halves to use it. */
const defaultOf = (settings: Record<string, unknown>) => {
  const provider = textOf(settings["defaultProvider"]);
  const id = textOf(settings["defaultModel"]);
  return provider !== null && id !== null ? `${provider}/${id}` : null;
};
const revisionOf = (state: unknown) => createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 16);

function parseConfig(text: string | undefined, path: string): Record<string, unknown> {
  if (text === undefined) return {};
  try { return settingsSchema.parse(JSON.parse(text)); }
  catch { throw new PrefsError(500, `${path} is not a JSON object. Fix it before you change the title model or the model chains.`); }
}

/**
 * The chains as far as they are a map of text lists, in the file's order, and why the daemon ignores them, if it does.
 * A part that is not a text list is left out of the map; the problem still names it.
 */
function chainsOf(value: unknown): { chains: ModelChains; problem: string | null } {
  if (value === undefined) return { chains: {}, problem: null };
  const problem = modelChainsProblem(value) ?? null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { chains: {}, problem };
  // fromEntries keeps a key such as "__proto__" an own key.
  const chains: ModelChains = Object.fromEntries(Object.entries(value).flatMap(([name, entries]: [string, unknown]) =>
    Array.isArray(entries) ? [[name, entries.filter((entry): entry is string => typeof entry === "string")]] : []));
  return { chains, problem };
}

/** Writes a whole file through a temporary file, so a reader never sees half of it. */
async function replaceFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${String(process.pid)}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, path);
}

async function readVisible(path: string): Promise<string[] | null> {
  const text = await readText(path);
  if (text === undefined) return null;
  try { return visibleFileSchema.parse(JSON.parse(text)).visible; }
  catch { throw new PrefsError(500, `${path} is not a list of models. Fix or delete it.`); }
}

export async function readPrefs(paths: ModelPrefsPaths): Promise<ModelPrefs> {
  const [settingsText, visible, configText] = await Promise.all([readText(paths.settings), readVisible(paths.visible), readText(paths.config)]);
  const settings = parseSettings(settingsText, paths.settings);
  const favorites = favoritesOf(settings);
  const concreteDefault = defaultOf(settings);
  const defaultThinkingLevel = textOf(settings["defaultThinkingLevel"]);
  const config = parseConfig(configText, paths.config);
  const titleModel = textOf(config["sessionTitleModel"]);
  const defaultModelChain = textOf(config["defaultModelChain"]);
  const defaultModel = defaultModelChain ?? concreteDefault;
  const storedChains: unknown = config["modelChains"];
  const { chains: modelChains, problem: modelChainsProblem } = chainsOf(storedChains);
  // The stored value, not the map read from it: an edit to a part the map leaves out still moves the revision.
  return { revision: revisionOf({ favorites, visible, defaultModel: concreteDefault, defaultModelChain, defaultThinkingLevel, titleModel, chains: storedChains ?? null }),
    favorites, visible, defaultModel, defaultModelChain, defaultThinkingLevel, titleModel, modelChains, modelChainsProblem,
    favoritesPath: paths.settings, visiblePath: paths.visible, configPath: paths.config, home: homedir() };
}

/**
 * Pi's own settings lock: proper-lockfile's `<file>.lock` folder. Pi holds it
 * while it merges its changed fields into the file, so neither writer loses
 * the other's change.
 */
async function withSettingsLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  const lock = `${path}.lock`;
  for (let attempt = 1; ; attempt++) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (!isErrnoCode(error, "EEXIST") || attempt === 20) throw new PrefsError(503, "Pi is writing its settings. Try again.");
      // proper-lockfile treats a lock older than 10 seconds as left behind.
      const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => 0);
      if (age > 10_000) await rmdir(lock).catch(() => undefined);
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try { return await task(); }
  finally { await rmdir(lock).catch(() => undefined); }
}

export async function savePrefs(paths: ModelPrefsPaths, save: ModelPrefsSave): Promise<ModelPrefs> {
  const chainsProblem = save.modelChains === undefined ? undefined : modelChainsProblem(save.modelChains);
  if (chainsProblem !== undefined) throw new PrefsError(400, chainsProblem);
  return withSettingsLock(paths.settings, async () => {
    const current = await readPrefs(paths);
    if (current.revision !== save.revision) throw new PrefsError(409, "The model lists changed since this page read them. Reload to see the current lists.");
    let defaultChoice: ReturnType<typeof parseModelChoice> = null;
    const defaultChain = save.defaultModel === undefined ? current.defaultModelChain : save.defaultModel.includes("/") ? null : save.defaultModel;
    let selectedDefault = save.defaultModel;
    if (selectedDefault === undefined && save.modelChains !== undefined && current.defaultModelChain != null) {
      // Editing the first entry also updates terminal Pi. Deleting a referenced chain keeps its last concrete default.
      try { resolveModelChain(current.defaultModelChain, save.modelChains); selectedDefault = current.defaultModelChain; }
      catch { /* A deleted reference remains visible and fails explicitly on the next new session. */ }
    }
    if (selectedDefault !== undefined) {
      try {
        const entries = resolveModelChain(selectedDefault, save.modelChains ?? current.modelChains);
        defaultChoice = parseModelChoice(entries[0] ?? "");
        if (defaultChoice === null) throw new Error("Invalid default model");
      } catch (error) { throw new PrefsError(400, error instanceof Error ? error.message : "Invalid default model"); }
    }
    const favorites = [...new Set(save.favorites)];
    const favoritesChanged = JSON.stringify(favorites) !== JSON.stringify(current.favorites);
    const defaultChanged = selectedDefault !== undefined && (selectedDefault !== current.defaultModel || save.modelChains !== undefined);
    const levelChanged = save.defaultThinkingLevel !== undefined && save.defaultThinkingLevel !== current.defaultThinkingLevel;
    if (favoritesChanged || defaultChanged || levelChanged) {
      const text = await readText(paths.settings);
      const settings = parseSettings(text, paths.settings);
      // Pi drops an empty list rather than store one; an empty list would hide every model in Pi.
      if (favoritesChanged) { if (favorites.length === 0) delete settings["enabledModels"]; else settings["enabledModels"] = favorites; }
      if (defaultChanged && selectedDefault !== undefined) {
        if (defaultChoice === null) throw new PrefsError(400, "Invalid default model");
        settings["defaultProvider"] = defaultChoice.model.provider;
        settings["defaultModel"] = defaultChoice.model.modelId;
      }
      if (levelChanged) settings["defaultThinkingLevel"] = save.defaultThinkingLevel;
      await mkdir(dirname(paths.settings), { recursive: true });
      // Pi writes the file in place, which keeps its owner and mode. So does this.
      await writeFile(paths.settings, JSON.stringify(settings, null, 2), "utf8");
    }
    const visible = save.visible === null ? null : [...new Set(save.visible)];
    if (JSON.stringify(visible) !== JSON.stringify(current.visible)) {
      if (visible === null) {
        await unlink(paths.visible).catch((error: unknown) => { if (!isErrnoCode(error, "ENOENT")) throw error; });
      } else {
        await replaceFile(paths.visible, `${JSON.stringify({ visible }, null, 2)}\n`);
      }
    }
    const titleChanged = save.titleModel !== undefined && save.titleModel !== current.titleModel;
    const chainsChanged = save.modelChains !== undefined && (current.modelChainsProblem !== null || JSON.stringify(save.modelChains) !== JSON.stringify(current.modelChains));
    const defaultChainChanged = defaultChain !== current.defaultModelChain;
    if (titleChanged || chainsChanged || defaultChainChanged) {
      // Only these keys change. Every other key in Forgerie's config stays as it is.
      const config = parseConfig(await readText(paths.config), paths.config);
      if (defaultChainChanged) { if (defaultChain == null) delete config["defaultModelChain"]; else config["defaultModelChain"] = defaultChain; }
      if (titleChanged) { if (save.titleModel === null) delete config["sessionTitleModel"]; else config["sessionTitleModel"] = save.titleModel; }
      if (chainsChanged && save.modelChains !== undefined) {
        if (Object.keys(save.modelChains).length === 0) delete config["modelChains"]; else config["modelChains"] = save.modelChains;
      }
      await replaceFile(paths.config, `${JSON.stringify(config, null, 2)}\n`);
    }
    return readPrefs(paths);
  });
}

const limits = { maxBytes: 500_000, tooLarge: "Model lists are limited to 500 KB.", requireJsonType: true };

export function modelPrefsMiddleware(paths: () => Promise<ModelPrefsPaths>): Middleware {
  return (request, response, next) => {
    if (new URL(request.url ?? "/", "http://local").pathname !== MODEL_PREFS_PATH) { next(); return; }
    const handle = async () => {
      if (request.method === "GET") return readPrefs(await paths());
      if (request.method !== "PUT") throw new PrefsError(405, "Use GET or PUT.");
      refuseCrossSite(request, "Model changes must come from this app.");
      return savePrefs(await paths(), modelPrefsSaveSchema.parse(await readJsonBody(request, limits)));
    };
    handle().then((value) => { sendJson(response, 200, value); }).catch((error: unknown) => {
      sendJson(response, error instanceof SettingsHttpError ? error.status : error instanceof z.ZodError ? 400 : 500, { error: errorMessage(error) });
    });
  };
}

