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
 *
 * The title model is Forgerie's `sessionTitleModel` config key: the model that
 * writes a new session's title from its first prompt. `null` means each
 * session's own model writes it.
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
  /** Forgerie's `sessionTitleModel` as a `provider/id` key, or `null` for "the session's own model". */
  titleModel: z.string().nullable(),
  /** Where the lists live, for the settings page to name. */
  favoritesPath: z.string(),
  visiblePath: z.string(),
  configPath: z.string(),
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
  /** Absent: unchanged. `null`: each session's own model writes its title. */
  titleModel: z.string().regex(/^[^/\s]+\/\S+$/u).max(300).nullable().optional(),
});
export type ModelPrefsSave = z.infer<typeof modelPrefsSaveSchema>;
