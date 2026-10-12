import { THINKING_LEVELS, type ModelPrefs } from "@shared/modelPrefsContract";

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
 * session starts on. The title model is Forgerie's `sessionTitleModel`: what
 * writes a new session's title, or `null` for each session's own model.
 * Absent: this change leaves them alone.
 */
export interface Lists {
  favorites: string[];
  visible: string[] | null;
  defaultModel?: string | null | undefined;
  defaultThinkingLevel?: string | null | undefined;
  titleModel?: string | null | undefined;
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
  | { type: "defaultLevel"; level: string }
  /** The title model is not on the lists: hiding or unstarring a model leaves it alone. */
  | { type: "titleModel"; key: string | null };

export function applyChange(prefs: Lists, change: PrefsChange, models: readonly ModelId[]): Lists {
  const favoriteKeysOf = (favorites: readonly string[]) => new Set(resolveFavorites(favorites, models).map((favorite) => favorite.key));
  const withoutKeys = (favorites: readonly string[], keys: ReadonlySet<string>) => favorites.filter((raw) => {
    const entry = parseFavorite(raw);
    return !models.some((model) => keys.has(keyOf(model)) && favoriteMatches(entry, model));
  });
  const shownWith = (visible: string[] | null, key: string) => visible === null || visible.includes(key) ? visible : [...visible, key];
  const kept = { defaultModel: prefs.defaultModel, defaultThinkingLevel: prefs.defaultThinkingLevel, titleModel: prefs.titleModel };
  if (change.type === "defaultLevel") return { ...prefs, favorites: [...prefs.favorites], defaultThinkingLevel: change.level };
  if (change.type === "titleModel") return { ...prefs, favorites: [...prefs.favorites], titleModel: change.key };
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

/**
 * Who writes a new session's title, by the session daemon's rule:
 * - `unset`: no title model is chosen, so each session's own model writes it.
 * - `unavailable`: no signed-in provider offers the chosen model, so each
 *   session's own model writes it.
 * - `chosen`: the chosen model writes it.
 */
export type TitleModelState = "unset" | "unavailable" | "chosen";

export function titleModelState(titleModel: string | null | undefined, models: readonly ModelId[]): TitleModelState {
  if (!titleModel) return "unset";
  return models.some((model) => keyOf(model) === titleModel) ? "chosen" : "unavailable";
}

/** The words Settings → Models shows for the title model. */
export const TITLE_MODEL_COPY = {
  label: "Session titles",
  empty: "Session's model",
  clear: "Use the session's model",
  unset: "Each session's own model writes its title from the first prompt. Choose a small, fast model to spend less on titles.",
  /** Shown around the model's key, in code. */
  unavailable: ["No signed-in provider offers ", ", so each session's own model writes its title."],
  chosen: "Writes the title of each new session from its first prompt. A change applies to the next new session.",
} as const;

/** `provider/id` split at the first slash: a provider has none, an ID may. */
export function splitKey(key: string): { provider: string; id: string } | undefined {
  const slash = key.indexOf("/");
  return slash > 0 && slash < key.length - 1 ? { provider: key.slice(0, slash), id: key.slice(slash + 1) } : undefined;
}
