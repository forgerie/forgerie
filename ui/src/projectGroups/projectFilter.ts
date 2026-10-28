import type { GroupCatalog } from "./projectGroupApi";

/**
 * The session list's project filter, as plain data. Its entries are every
 * group, then every project that is in no group. A project in a group is
 * reached through that group only. The reader chooses any number of entries;
 * the list shows the union of their projects, and with none chosen, every
 * project.
 */
export interface FilterEntry {
  /** `group:<id>` or `project:<id>`, so a group and a project with the same id stay apart. */
  value: string;
  kind: "group" | "project";
  label: string;
  /** For a group, its size; for a project, nothing. */
  detail: string;
  /** The whole name, or for a project its folder, for a label cut short. */
  title: string;
  projectIds: readonly string[];
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;
const byName = (left: { name: string }, right: { name: string }) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

export function filterEntries(catalog: GroupCatalog): FilterEntry[] {
  const grouped = new Set(catalog.groups.flatMap((group) => group.projectIds));
  return [
    ...catalog.groups.map((group): FilterEntry => ({ value: `group:${group.id}`, kind: "group", label: group.name,
      detail: plural(group.projectIds.length, "project"), title: group.name, projectIds: group.projectIds })),
    ...catalog.projects.filter((project) => !grouped.has(project.id)).sort(byName)
      .map((project): FilterEntry => ({ value: `project:${project.id}`, kind: "project", label: project.name, detail: "", title: project.path, projectIds: [project.id] })),
  ];
}

/** The chosen entries that still exist, in the menu's order. A stored id whose group or project went away is ignored. */
export function liveChoices(entries: readonly FilterEntry[], chosen: readonly string[]): FilterEntry[] {
  return entries.filter((entry) => chosen.includes(entry.value));
}

/** The projects the chosen entries cover together, or undefined for all projects when none is chosen. */
export function filterScope(chosen: readonly FilterEntry[]): string[] | undefined {
  if (chosen.length === 0) return undefined;
  return [...new Set(chosen.flatMap((entry) => entry.projectIds))];
}

/** The chosen entries, as a JSON list of entry values. */
export const FILTER_KEY = "forgerie.projectFilter";
/** Before multi-select: one group id. Read once into the new key. */
export const LEGACY_GROUP_KEY = "forgerie.projectGroup";
type ChoiceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/** The stored choices. Without the new key, the old single group becomes the one choice, so an existing filter survives the update. */
export function readChoices(storage: ChoiceStorage): string[] {
  const stored = storage.getItem(FILTER_KEY);
  if (stored !== null) {
    try { const value: unknown = JSON.parse(stored); return isStringList(value) ? value : []; }
    catch { return []; }
  }
  const legacy = storage.getItem(LEGACY_GROUP_KEY);
  return legacy ? [`group:${legacy}`] : [];
}

/** Stores the choices under the new key and drops the old one. No choice removes the key. */
export function writeChoices(storage: ChoiceStorage, chosen: readonly string[]): void {
  storage.removeItem(LEGACY_GROUP_KEY);
  if (chosen.length) storage.setItem(FILTER_KEY, JSON.stringify(chosen)); else storage.removeItem(FILTER_KEY);
}
