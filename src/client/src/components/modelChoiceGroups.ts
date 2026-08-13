import type { ComposerChoiceGroup, ComposerChoiceItem } from "./ComposerChoiceList";
import type { ComposerSelectableModel } from "../composerCapabilities";

/** The heading Pi's `enabledModels` scope earns, named after how it is reached. */
const SCOPE_LABEL = "Ctrl+P cycle";
const CATALOGUE_LABEL = "Other models";

/** A pinned provider snapshot ends in a date: `claude-haiku-4-5-20251001`. */
const PINNED_DATE = /-(\d{4})(\d{2})(\d{2})$/;
/** Pi appends this to the name of a moving alias. */
const ALIAS_SUFFIX = " (latest)";

/**
 * The rows of the model picker, in the order the server sent them.
 *
 * Two facts have to survive this function. Pi's scope decides what `Ctrl+P`
 * cycles through, so those models are named as a set rather than left to look
 * like the first few rows. And the server's order *is* the cycle order, so a
 * provider run is never merged with an earlier one — sorting by provider would
 * silently rewrite the sequence a keypress follows.
 */
export function modelChoiceGroups(models: readonly ComposerSelectableModel[]): ComposerChoiceGroup[] {
  const scoped = models.filter((model) => model.scoped === true);
  const rest = models.filter((model) => model.scoped !== true);
  if (scoped.length === 0) return providerGroups(rest);

  const catalogue = providerGroups(rest);
  const firstCatalogueGroup = catalogue[0];
  return [
    { label: SCOPE_LABEL, level: "section", count: scoped.length, items: scoped.map((model) => choiceItem(model, true)) },
    ...(firstCatalogueGroup === undefined
      ? []
      : [{ label: CATALOGUE_LABEL, level: "section" as const, count: rest.length, divider: true, items: [] }, ...catalogue]),
  ];
}

/**
 * Adjacent same-provider rows share a heading; a later run gets its own. Rows
 * are grouped by the provider id but headed by its display name, so a heading
 * and a row never name one provider two ways.
 */
function providerGroups(models: readonly ComposerSelectableModel[]): ComposerChoiceGroup[] {
  const groups: { provider: string; group: ComposerChoiceGroup }[] = [];
  for (const model of models) {
    const provider = model.provider ?? "";
    const item = choiceItem(model, false);
    const previous = groups.at(-1);
    if (previous?.provider === provider) {
      previous.group = { ...previous.group, items: [...previous.group.items, item] };
    } else {
      groups.push({ provider, group: { ...(provider === "" ? {} : { label: providerLabel(provider) }), level: "provider", items: [item] } });
    }
  }
  return groups.map((entry) => entry.group);
}

function choiceItem(model: ComposerSelectableModel, namesProvider: boolean): ComposerChoiceItem {
  const context = compactContextWindow(model.contextWindow);
  const provider = model.provider === undefined || model.provider === "" ? undefined : providerLabel(model.provider);
  const meta = namesProvider && provider !== undefined
    ? [provider, context].filter((part) => part !== undefined).join(" · ")
    : context;
  const variant = modelVariant(model);
  return {
    value: `${model.provider ?? ""}/${model.id ?? ""}`,
    label: modelLabel(model),
    ...(variant === undefined ? {} : { variant }),
    ...(meta === undefined || meta === "" ? {} : { meta }),
    ...(model.reasoning === false ? { muted: true } : {}),
  };
}

/** The name without the alias marker, which the variant states instead. */
function modelLabel(model: ComposerSelectableModel): string {
  const name = model.name === undefined || model.name === "" ? model.id ?? "no model" : model.name;
  return name.endsWith(ALIAS_SUFFIX) ? name.slice(0, -ALIAS_SUFFIX.length) : name;
}

/**
 * What separates two rows that otherwise read as the same model: a moving
 * alias, or the dated snapshot it currently points at.
 */
function modelVariant(model: ComposerSelectableModel): string | undefined {
  if (model.name?.endsWith(ALIAS_SUFFIX) === true) return "latest";
  const pinned = PINNED_DATE.exec(model.id ?? "");
  return pinned === null ? undefined : `${pinned[1] ?? ""}-${pinned[2] ?? ""}-${pinned[3] ?? ""}`;
}

/**
 * Six digits of context tell a reader nothing at a glance. Anything from a
 * thousand up is stated in `k` or `m`.
 */
function compactContextWindow(contextWindow: number | undefined): string | undefined {
  if (contextWindow === undefined || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;
  if (contextWindow >= 1_000_000) return `${scaled(contextWindow / 1_000_000)}m`;
  if (contextWindow >= 1_000) return `${scaled(contextWindow / 1_000)}k`;
  return String(Math.round(contextWindow));
}

/**
 * A decimal only below ten, where it carries real capacity: 8.2k rather than
 * 8k. Above ten it would only add noise, so 286384 reads 286k.
 */
function scaled(value: number): string {
  if (value >= 10) return String(Math.round(value));
  return value.toFixed(1).replace(/\.0$/, "");
}

/** Provider ids are machine strings; a row reads them as words. */
function providerLabel(provider: string): string {
  return provider
    .split(/[-_\s]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
