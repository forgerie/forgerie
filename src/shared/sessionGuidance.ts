export interface SessionGuidanceEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export const SESSION_GUIDANCE_ENTRIES = [
  {
    id: "technical-english",
    name: "Technical English",
    description: "Use short, direct sentences and consistent terms.",
  },
] as const satisfies readonly SessionGuidanceEntry[];

export type SessionGuidanceId = (typeof SESSION_GUIDANCE_ENTRIES)[number]["id"];

export interface SessionGuidanceChange {
  readonly activeIds: string[];
  readonly changed: boolean;
}

const builtInIds: readonly SessionGuidanceId[] = SESSION_GUIDANCE_ENTRIES.map((entry) => entry.id);

export function isSessionGuidanceId(value: unknown): value is SessionGuidanceId {
  return typeof value === "string" && builtInIds.some((id) => id === value);
}

export function normalizeSessionGuidanceIds(
  value: unknown,
  knownIds: readonly string[] = builtInIds,
): string[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(knownIds);
  const seen = new Set<string>();
  const activeIds: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !known.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    activeIds.push(entry);
  }
  return activeIds;
}

export function setSessionGuidance(
  current: readonly string[],
  id: string,
  enabled: boolean,
  knownIds: readonly string[] = builtInIds,
): SessionGuidanceChange {
  if (!knownIds.includes(id)) return { activeIds: normalizeSessionGuidanceIds(current, knownIds), changed: false };
  const activeIds = normalizeSessionGuidanceIds(current, knownIds);
  const active = activeIds.includes(id);
  if (active === enabled) return { activeIds, changed: false };
  return {
    activeIds: enabled ? [...activeIds, id] : activeIds.filter((entry) => entry !== id),
    changed: true,
  };
}

export function sessionGuidanceSummary(
  activeIds: readonly string[],
  catalog: readonly SessionGuidanceEntry[] = SESSION_GUIDANCE_ENTRIES,
): string {
  const names = activeIds.flatMap((id) => {
    const entry = catalog.find((candidate) => candidate.id === id);
    return entry === undefined ? [] : [entry.name];
  });
  const first = names[0];
  if (first === undefined) return "Guidance";
  return names.length === 1 ? first : `${first} +${String(names.length - 1)}`;
}
