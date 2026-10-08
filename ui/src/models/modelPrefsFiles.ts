import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { z } from "zod";
import { activeForgerieProfile } from "../settings/forgerieProfile";
import { modelPrefsSaveSchema, type ModelPrefs, type ModelPrefsSave } from "./modelPrefs";

/**
 * Dev-server API for the app's model lists. Favorites are Pi's `enabledModels`
 * in the active profile's `settings.json`, so terminal Pi with the same profile
 * sees the same favorites. Shown models are Forgerie's own list, beside
 * Forgerie's config. Lives in the Vite server, like the Agents and Plugins
 * APIs, until this client ships with Forgerie's server.
 *
 *   GET /aui/model-prefs   both lists and their revision
 *   PUT /aui/model-prefs   { revision, favorites, visible } (409 if the revision moved)
 */
export const MODEL_PREFS_PATH = "/aui/model-prefs";

export interface ModelPrefsPaths { settings: string; visible: string }
export class PrefsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function defaultPrefsPaths(): Promise<ModelPrefsPaths> {
  const profile = await activeForgerieProfile();
  return { settings: join(profile.dir, "settings.json"), visible: join(dirname(profile.configPath), "visible-models.json") };
}

const visibleFileSchema = z.object({ visible: z.array(z.string()) });
const settingsSchema = z.record(z.string(), z.unknown());

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}
function parseSettings(text: string | undefined, path: string): Record<string, unknown> {
  if (text === undefined) return {};
  try { return settingsSchema.parse(JSON.parse(text.replace(/^\uFEFF/, ""))); }
  catch { throw new PrefsError(500, `${path} is not a JSON object. Fix it before you change favorites.`); }
}
const favoritesOf = (settings: Record<string, unknown>) => {
  const value = settings.enabledModels;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};
const revisionOf = (favorites: readonly string[], visible: readonly string[] | null) =>
  createHash("sha256").update(JSON.stringify({ favorites, visible })).digest("hex").slice(0, 16);

async function readVisible(path: string): Promise<string[] | null> {
  const text = await readText(path);
  if (text === undefined) return null;
  try { return visibleFileSchema.parse(JSON.parse(text)).visible; }
  catch { throw new PrefsError(500, `${path} is not a list of models. Fix or delete it.`); }
}

export async function readPrefs(paths: ModelPrefsPaths): Promise<ModelPrefs> {
  const [settingsText, visible] = await Promise.all([readText(paths.settings), readVisible(paths.visible)]);
  const favorites = favoritesOf(parseSettings(settingsText, paths.settings));
  return { revision: revisionOf(favorites, visible), favorites, visible, favoritesPath: paths.settings, visiblePath: paths.visible, home: homedir() };
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
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 20) throw new PrefsError(503, "Pi is writing its settings. Try again.");
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
    if (JSON.stringify(favorites) !== JSON.stringify(current.favorites)) {
      const text = await readText(paths.settings);
      const settings = parseSettings(text, paths.settings);
      // Pi drops an empty list rather than store one; an empty list would hide every model in Pi.
      if (favorites.length === 0) delete settings.enabledModels; else settings.enabledModels = favorites;
      await mkdir(dirname(paths.settings), { recursive: true });
      // Pi writes the file in place, which keeps its owner and mode. So does this.
      await writeFile(paths.settings, JSON.stringify(settings, null, 2), "utf8");
    }
    const visible = save.visible === null ? null : [...new Set(save.visible)];
    if (JSON.stringify(visible) !== JSON.stringify(current.visible)) {
      if (visible === null) {
        await unlink(paths.visible).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
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

async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new PrefsError(415, "Send JSON.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 500_000) throw new PrefsError(413, "Model lists are limited to 500 KB.");
    chunks.push(chunk as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PrefsError(400, "The request body is not JSON."); }
}

export function modelPrefsMiddleware(paths: () => Promise<ModelPrefsPaths>) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (new URL(request.url ?? "/", "http://local").pathname !== MODEL_PREFS_PATH) { next(); return; }
    const send = (status: number, value: unknown) => {
      response.statusCode = status;
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(value));
    };
    const handle = async () => {
      if (request.method === "GET") return readPrefs(await paths());
      if (request.method !== "PUT") throw new PrefsError(405, "Use GET or PUT.");
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) throw new PrefsError(403, "Model changes must come from this app.");
      return savePrefs(await paths(), modelPrefsSaveSchema.parse(await body(request)));
    };
    handle().then((value) => send(200, value)).catch((error: unknown) => send(error instanceof PrefsError ? error.status : error instanceof z.ZodError ? 400 : 500,
      { error: error instanceof Error ? error.message : String(error) }));
  };
}

export function modelPrefsApi(paths: () => Promise<ModelPrefsPaths> = defaultPrefsPaths): Plugin {
  const middleware = modelPrefsMiddleware(paths);
  return { name: "forgerie-model-prefs", configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
