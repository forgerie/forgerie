import { z } from "zod";

/**
 * Which models the app offers, for every session at once. Two lists:
 *
 * - Favorites are Pi's own `enabledModels` setting (Pi calls them scoped
 *   models). They come first in the model menu, and Ctrl+P switches between
 *   them, as in Pi.
 * - Shown models are Forgerie's allow-list. A model that is not on it stays out
 *   of the menu, and so does a model a provider adds later. `null` means the
 *   list was never set, so every model is shown. A favorite is always shown.
 *
 * Pi's entries can carry a thinking level (`provider/id:high`), name a model
 * without its provider, or be a glob. This module reads all three. A glob is
 * kept as it is: this app does not edit it.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export const modelPrefsSchema = z.object({
  /** Changes when any list changes on disk. A save names the revision it read. */
  revision: z.string(),
  /** Pi's `enabledModels`, exactly as stored, in Pi's order. */
  favorites: z.array(z.string()),
  /** Forgerie's allow-list of `provider/id` keys, or `null` for "show every model". */
  visible: z.array(z.string()).nullable(),
  /** Pi's `defaultProvider` and `defaultModel` as one `provider/id` key: what a new session starts on. */
  defaultModel: z.string().nullable(),
  /** Pi's `defaultThinkingLevel`. */
  defaultThinkingLevel: z.string().nullable(),
  /** Where the lists live, for the settings page to name. */
  favoritesPath: z.string(),
  visiblePath: z.string(),
  home: z.string(),
});
export type ModelPrefs = z.infer<typeof modelPrefsSchema>;
export const modelPrefsSaveSchema = z.object({
  revision: z.string(),
  favorites: z.array(z.string().min(1).max(300)).max(500),
  visible: z.array(z.string().min(1).max(300)).max(5000).nullable(),
  /** Absent: unchanged. There is no "no default": Pi keeps one once it is set. */
  defaultModel: z.string().regex(/^[^/\s]+\/\S+$/u).max(300).optional(),
  defaultThinkingLevel: z.enum(THINKING_LEVELS).optional(),
});
export type ModelPrefsSave = z.infer<typeof modelPrefsSaveSchema>;

interface ModelId { provider?: string | undefined; id?: string | undefined }
export const keyOf = (model: ModelId) => `${model.provider ?? ""}/${model.id ?? ""}`;

/** One `enabledModels` entry, read the way Pi reads it. */
export interface FavoriteEntry {
  raw: string;
  /** Absent when the entry names a model by its ID alone. */
  provider?: string | undefined;
  id: string;
  level?: string | undefined;
  /** A glob this app keeps but does not edit. */
  pattern: boolean;
}

export function parseFavorite(raw: string): FavoriteEntry {
  const trimmed = raw.trim();
  const colon = trimmed.lastIndexOf(":");
  const suffix = colon === -1 ? "" : trimmed.slice(colon + 1);
  const level = (THINKING_LEVELS as readonly string[]).includes(suffix) ? suffix : undefined;
  const name = level ? trimmed.slice(0, colon) : trimmed;
  const pattern = /[*?[\]]/.test(name);
  const slash = name.indexOf("/");
  return slash === -1 ? { raw, id: name, level, pattern } : { raw, provider: name.slice(0, slash), id: name.slice(slash + 1), level, pattern };
}

function favoriteMatches(entry: FavoriteEntry, model: ModelId): boolean {
  if (entry.pattern) return false;
  return model.id === entry.id && (entry.provider === undefined || model.provider === entry.provider);
}

/** A favorite resolved against the models a session can use. */
export interface ResolvedFavorite { key: string; provider: string; id: string; level?: string | undefined; raw: string }

/**
 * Favorites that name an available model, in Pi's order, each once. An entry
 * without a provider takes the first model with its ID, as Pi does.
 */
export function resolveFavorites(favorites: readonly string[], models: readonly ModelId[]): ResolvedFavorite[] {
  const seen = new Set<string>();
  const resolved: ResolvedFavorite[] = [];
  for (const raw of favorites) {
    const entry = parseFavorite(raw);
    const model = models.find((candidate) => favoriteMatches(entry, candidate));
    if (!model?.provider || !model.id) continue;
    const key = keyOf(model);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ key, provider: model.provider, id: model.id, level: entry.level, raw });
  }
  return resolved;
}

/** True when the menu offers the model without "Show hidden models". */
export function isShown(prefs: Pick<ModelPrefs, "visible">, favoriteKeys: ReadonlySet<string>, key: string): boolean {
  return prefs.visible === null || favoriteKeys.has(key) || prefs.visible.includes(key);
}

/** The favorite Ctrl+P moves to: the next one after the current model, or the first. */
export function cycleTarget(favorites: readonly ResolvedFavorite[], currentKey: string | undefined, direction: 1 | -1): ResolvedFavorite | undefined {
  if (favorites.length === 0) return undefined;
  const index = favorites.findIndex((favorite) => favorite.key === currentKey);
  if (index === -1) return direction === 1 ? favorites[0] : favorites.at(-1);
  if (favorites.length === 1) return undefined;
  return favorites[(index + direction + favorites.length) % favorites.length];
}

/**
 * The lists a save writes. The default model and level are Pi's
 * `defaultProvider`/`defaultModel` and `defaultThinkingLevel`: what a new
 * session starts on. Absent: this change leaves them alone.
 */
export interface Lists {
  favorites: string[];
  visible: string[] | null;
  defaultModel?: string | null | undefined;
  defaultThinkingLevel?: string | null | undefined;
}

/**
 * A change from the settings page, applied to every list. Rules:
 * - Starring a model shows it.
 * - Hiding a model also removes its star.
 * - The first hide turns "show every model" into an allow-list of every
 *   model shown at that moment, less the one hidden.
 * - Unstarring keeps the model shown.
 * - The default model is always shown, and is a favorite whenever there are
 *   favorites. Pi does the same when it saves a default: with scoped models,
 *   a default outside them is never used. So a change cannot hide or unstar
 *   the default; choose another default first.
 * A favorite keeps its stored entry, so a thinking level on it survives.
 */
export type PrefsChange =
  | { type: "favorite"; key: string; on: boolean }
  | { type: "show"; keys: readonly string[]; on: boolean }
  | { type: "default"; key: string }
  | { type: "defaultLevel"; level: string };

export function applyChange(prefs: Lists, change: PrefsChange, models: readonly ModelId[]): Lists {
  const favoriteKeysOf = (favorites: readonly string[]) => new Set(resolveFavorites(favorites, models).map((favorite) => favorite.key));
  const withoutKeys = (favorites: readonly string[], keys: ReadonlySet<string>) => favorites.filter((raw) => {
    const entry = parseFavorite(raw);
    return !models.some((model) => keys.has(keyOf(model)) && favoriteMatches(entry, model));
  });
  const shownWith = (visible: string[] | null, key: string) => visible === null || visible.includes(key) ? visible : [...visible, key];
  const kept = { defaultModel: prefs.defaultModel, defaultThinkingLevel: prefs.defaultThinkingLevel };
  if (change.type === "defaultLevel") return { ...prefs, favorites: [...prefs.favorites], defaultThinkingLevel: change.level };
  if (change.type === "default") {
    const favorites = prefs.favorites.length === 0 || favoriteKeysOf(prefs.favorites).has(change.key) ? [...prefs.favorites] : [...prefs.favorites, change.key];
    return { ...kept, favorites, visible: shownWith(prefs.visible, change.key), defaultModel: change.key };
  }
  const locked = (key: string) => key === prefs.defaultModel;
  if (change.type === "favorite") {
    if (!change.on) {
      if (locked(change.key)) return { ...prefs };
      return { ...kept, favorites: withoutKeys(prefs.favorites, new Set([change.key])), visible: shownWith(prefs.visible, change.key) };
    }
    const favorites = favoriteKeysOf(prefs.favorites).has(change.key) ? [...prefs.favorites] : [...prefs.favorites, change.key];
    return { ...kept, favorites, visible: shownWith(prefs.visible, change.key) };
  }
  if (change.on) {
    if (prefs.visible === null) return { ...kept, favorites: [...prefs.favorites], visible: null };
    return { ...kept, favorites: [...prefs.favorites], visible: [...prefs.visible, ...change.keys.filter((key) => !prefs.visible?.includes(key))] };
  }
  const keys = new Set(change.keys.filter((key) => !locked(key)));
  const favorites = withoutKeys(prefs.favorites, keys);
  const base = prefs.visible ?? [...models.map(keyOf), ...favoriteKeysOf(prefs.favorites)];
  return { ...kept, favorites, visible: [...new Set(base)].filter((key) => !keys.has(key)) };
}

/** `provider/id` split at the first slash: a provider has none, an ID may. */
export function splitKey(key: string): { provider: string; id: string } | undefined {
  const slash = key.indexOf("/");
  return slash > 0 && slash < key.length - 1 ? { provider: key.slice(0, slash), id: key.slice(slash + 1) } : undefined;
}
