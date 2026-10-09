import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { modelPrefsSaveSchema, type ModelPrefs, type ModelPrefsSave } from "../../shared/modelPrefsContract.js";
import { activeForgerieProfile, type Gateway } from "./forgerieProfile.js";
import { errorMessage, isErrnoCode, readJsonBody, refuseCrossSite, sendJson, SettingsHttpError } from "./http.js";
import type { Middleware } from "./routes.js";

/**
 * API for the app's model lists. Favorites are Pi's `enabledModels`
 * in the active profile's `settings.json`, so terminal Pi with the same profile
 * sees the same favorites. Shown models are Forgerie's own list, beside
 * Forgerie's config.
 *
 *   GET /aui/model-prefs   both lists and their revision
 *   PUT /aui/model-prefs   { revision, favorites, visible } (409 if the revision moved)
 */
export const MODEL_PREFS_PATH = "/aui/model-prefs";

export interface ModelPrefsPaths { settings: string; visible: string }
export class PrefsError extends SettingsHttpError {}

export async function defaultPrefsPaths(gateway: Gateway): Promise<ModelPrefsPaths> {
  const profile = await activeForgerieProfile(gateway);
  return { settings: join(profile.dir, "settings.json"), visible: join(dirname(profile.configPath), "visible-models.json") };
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

async function readVisible(path: string): Promise<string[] | null> {
  const text = await readText(path);
  if (text === undefined) return null;
  try { return visibleFileSchema.parse(JSON.parse(text)).visible; }
  catch { throw new PrefsError(500, `${path} is not a list of models. Fix or delete it.`); }
}

export async function readPrefs(paths: ModelPrefsPaths): Promise<ModelPrefs> {
  const [settingsText, visible] = await Promise.all([readText(paths.settings), readVisible(paths.visible)]);
  const settings = parseSettings(settingsText, paths.settings);
  const favorites = favoritesOf(settings);
  const defaultModel = defaultOf(settings);
  const defaultThinkingLevel = textOf(settings["defaultThinkingLevel"]);
  return { revision: revisionOf({ favorites, visible, defaultModel, defaultThinkingLevel }), favorites, visible, defaultModel, defaultThinkingLevel,
    favoritesPath: paths.settings, visiblePath: paths.visible, home: homedir() };
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
  return withSettingsLock(paths.settings, async () => {
    const current = await readPrefs(paths);
    if (current.revision !== save.revision) throw new PrefsError(409, "The model lists changed since this page read them. Reload to see the current lists.");
    const favorites = [...new Set(save.favorites)];
    const favoritesChanged = JSON.stringify(favorites) !== JSON.stringify(current.favorites);
    const defaultChanged = save.defaultModel !== undefined && save.defaultModel !== current.defaultModel;
    const levelChanged = save.defaultThinkingLevel !== undefined && save.defaultThinkingLevel !== current.defaultThinkingLevel;
    if (favoritesChanged || defaultChanged || levelChanged) {
      const text = await readText(paths.settings);
      const settings = parseSettings(text, paths.settings);
      // Pi drops an empty list rather than store one; an empty list would hide every model in Pi.
      if (favoritesChanged) { if (favorites.length === 0) delete settings["enabledModels"]; else settings["enabledModels"] = favorites; }
      if (defaultChanged && save.defaultModel !== undefined) {
        // The schema makes sure there is a slash. The provider ends at the first one; an ID may hold more.
        const slash = save.defaultModel.indexOf("/");
        settings["defaultProvider"] = save.defaultModel.slice(0, slash);
        settings["defaultModel"] = save.defaultModel.slice(slash + 1);
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
        await mkdir(dirname(paths.visible), { recursive: true });
        const temp = `${paths.visible}.${String(process.pid)}.tmp`;
        await writeFile(temp, `${JSON.stringify({ visible }, null, 2)}\n`, "utf8");
        await rename(temp, paths.visible);
      }
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

