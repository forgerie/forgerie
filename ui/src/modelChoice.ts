import type { SessionModel } from "./contracts";
import { isShown, resolveFavorites } from "./models/modelPrefs";
import type { ModelPrefs } from "@shared/modelPrefsContract";
import type { OptionGroup, OptionItem } from "./ui/OptionList";
import type { OptionDetail } from "./ui/OptionRow";

export type { SessionModel };

export interface ModelRow {
  /** `provider/id`, the identity Pi's model endpoint takes. */
  key: string;
  provider: string;
  id: string;
  label: string;
  /** Tells an alias apart from the dated snapshot behind it. */
  variant?: string;
  /** Named only in the enabled set, which mixes providers. */
  providerName?: string;
  context?: string;
  /** The model has no reasoning, so thinking levels do not apply. */
  plain: boolean;
  /** Off the shown list, and offered only because hidden models are on view. */
  hidden?: boolean;
  /** Pi's default: what a new session starts on. */
  isDefault?: boolean;
}
export interface ModelGroup { key: string; label: string; rows: ModelRow[] }

const FAVORITES_LABEL = "Favorites";
const PINNED_DATE = /-(\d{4})(\d{2})(\d{2})$/;
const ALIAS_SUFFIX = " (latest)";

export const modelKey = (model: Pick<SessionModel, "provider" | "id">) => `${model.provider ?? ""}/${model.id ?? ""}`;

type Pickable = SessionModel & { provider: string; id: string };
export interface MenuOptions {
  /** The app's lists. Absent: Pi's `scoped` flag marks favorites and every model is shown. */
  prefs?: (Pick<ModelPrefs, "favorites" | "visible"> & { defaultModel?: string | null | undefined }) | undefined;
  /** Offer models off the shown list too. */
  showHidden?: boolean | undefined;
  /** The session's model. It is always offered, so the menu can show what is in use. */
  activeKey?: string | undefined;
}
export interface ModelMenu { groups: ModelGroup[]; /** Models that match the search but are hidden. */ hidden: number }

/**
 * The picker's groups, in the order Pi sent the models. Favorites come first
 * as one named set, in the user's order, because they are the ones the user
 * chose to keep close. The server's order is kept after that: a later run of
 * one provider gets its own group rather than being merged into an earlier
 * one. A model off the shown list stays out unless `showHidden` is set. Models
 * without a provider and ID cannot be picked and are left out.
 */
export function modelMenu(models: readonly SessionModel[], query = "", options: MenuOptions = {}): ModelMenu {
  const needle = query.trim().toLowerCase();
  const pickable = models.filter((model): model is Pickable => !!model.provider && !!model.id);
  const { prefs } = options;
  const favorites: Pickable[] = prefs
    ? resolveFavorites(prefs.favorites, pickable).flatMap((favorite) => pickable.find((model) => modelKey(model) === favorite.key) ?? [])
    : pickable.filter((model) => model.scoped === true);
  const favoriteKeys = new Set(favorites.map(modelKey));
  const shown = (model: Pickable) => !prefs || isShown(prefs, favoriteKeys, modelKey(model)) || modelKey(model) === options.activeKey;
  const rest = pickable.filter((model) => !favoriteKeys.has(modelKey(model)) && matches(model, needle));
  const hidden = rest.filter((model) => !shown(model)).length;
  const groups: ModelGroup[] = [];
  const favoriteRows = favorites.filter((model) => matches(model, needle));
  const marked = (row: ModelRow): ModelRow => row.key === prefs?.defaultModel ? { ...row, isDefault: true } : row;
  if (favoriteRows.length > 0) groups.push({ key: "favorites", label: FAVORITES_LABEL, rows: favoriteRows.map((model) => marked(rowOf(model, true))) });
  for (const model of rest) {
    const off = !shown(model);
    if (off && !options.showHidden) continue;
    const row = marked({ ...rowOf(model, false), ...(off ? { hidden: true } : {}) });
    const previous = groups.at(-1);
    const key = `provider:${model.provider}`;
    if (previous && previous.key.startsWith(key)) previous.rows.push(row);
    else groups.push({ key: `${key}:${groups.length}`, label: providerLabel(model.provider), rows: [row] });
  }
  return { groups, hidden };
}

/** Where a list of model choices stands: the model in use, and a change in progress that blocks the others. */
export interface OptionState { activeKey?: string | undefined; changing?: string | undefined; blocked?: boolean | undefined }

/** One menu row as a choice in an option list: the same words wherever a model is offered. */
export function modelOption(row: ModelRow, state: OptionState = {}): OptionItem {
  const busy = state.changing === row.key;
  const current = row.key === state.activeKey;
  const details: OptionDetail[] = [
    ...(row.isDefault ? [{ text: "default", strong: true }] : []),
    ...(row.providerName ? [row.providerName] : []),
    ...(row.context ? [`${row.context} context`] : []),
    ...(row.plain ? ["no thinking"] : []),
    ...(row.hidden ? ["hidden"] : []),
    ...(busy ? ["Switching…"] : []),
  ];
  return { id: row.key, name: row.label, variant: row.variant, details, current, busy,
    tone: row.hidden ? "faint" : row.plain ? "quiet" : "plain", blocked: state.blocked === true && !current };
}

/** {@link modelMenu}'s groups as option groups. */
export const modelOptionGroups = (groups: readonly ModelGroup[], state: OptionState = {}): OptionGroup[] =>
  groups.map((group) => ({ key: group.key, label: group.label, options: group.rows.map((row) => modelOption(row, state)) }));

/** The command that shows or hides the models off the shown list. */
export const hiddenModelsLabel = (hidden: number, showing: boolean) =>
  showing ? "Hide models you do not show" : `Show ${String(hidden)} hidden ${hidden === 1 ? "model" : "models"}`;

/** {@link modelMenu}'s groups alone. */
export const modelGroups = (models: readonly SessionModel[], query = "", options: MenuOptions = {}): ModelGroup[] => modelMenu(models, query, options).groups;

function matches(model: SessionModel, needle: string): boolean {
  if (needle === "") return true;
  return [modelKey(model), model.provider, model.id, model.name, model.provider && providerLabel(model.provider)]
    .some((field) => field?.toLowerCase().includes(needle));
}

function rowOf(model: SessionModel & { provider: string; id: string }, namesProvider: boolean): ModelRow {
  const context = compactContextWindow(model.contextWindow);
  const variant = variantOf(model);
  return {
    key: modelKey(model), provider: model.provider, id: model.id, label: modelLabel(model),
    ...(variant ? { variant } : {}), ...(namesProvider ? { providerName: providerLabel(model.provider) } : {}), ...(context ? { context } : {}), plain: model.reasoning === false,
  };
}

/** The name a person reads. Pi's alias marker moves to the variant. */
export function modelLabel(model: SessionModel | undefined): string {
  const name = model?.name || model?.id || "No model";
  return name.endsWith(ALIAS_SUFFIX) ? name.slice(0, -ALIAS_SUFFIX.length) : name;
}

function variantOf(model: SessionModel): string | undefined {
  if (model.name?.endsWith(ALIAS_SUFFIX)) return "latest";
  const pinned = PINNED_DATE.exec(model.id ?? "");
  return pinned ? `${pinned[1]}-${pinned[2]}-${pinned[3]}` : undefined;
}

/** Context windows read in k and m. A decimal only below ten, where it carries real capacity. */
export function compactContextWindow(contextWindow: number | undefined): string | undefined {
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
  const scaled = (value: number) => value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  if (contextWindow >= 1_000_000) return `${scaled(contextWindow / 1_000_000)}m`;
  if (contextWindow >= 1_000) return `${scaled(contextWindow / 1_000)}k`;
  return String(Math.round(contextWindow));
}

/** Provider IDs are machine strings. A heading reads them as words. */
export function providerLabel(provider: string): string {
  return provider.split(/[-_\s]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** Pi's level names, as a person reads them. Unknown levels keep Pi's word. */
export function thinkingLabel(level: string): string {
  const known: Record<string, string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
  return known[level] ?? level;
}

/**
 * `/model` with optional search text. Pi's server has no `/model` command for
 * the web, so the composer opens the picker instead of sending it.
 */
export function modelCommandQuery(text: string): string | undefined {
  const match = /^\/model(?:\s+([\s\S]*))?$/u.exec(text.trim());
  return match ? (match[1] ?? "").trim() : undefined;
}
