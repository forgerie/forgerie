import { DEFAULT_COLLAPSED, type Grouping } from "./board";

/** How the reader has arranged the picker. Local to this browser, not sensitive. */
export interface PickerPrefs {
  grouping: Grouping;
  /** Resets on every load: the archive is opt-in each time. */
  showArchived: boolean;
  /** Resets on every load too: the pinned cap is the default each visit. */
  allPinned: boolean;
  collapsed: ReadonlySet<string>;
}
export const PREFS_KEY = "forgerie.picker.v1";

export function readPrefs(storage: Pick<Storage, "getItem"> | undefined): PickerPrefs {
  const fallback: PickerPrefs = { grouping: "state", showArchived: false, allPinned: false, collapsed: DEFAULT_COLLAPSED };
  try {
    const stored: unknown = JSON.parse(storage?.getItem(PREFS_KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return fallback;
    const { grouping, collapsed } = stored as { grouping?: unknown; collapsed?: unknown };
    return {
      grouping: grouping === "project" ? "project" : "state",
      showArchived: false,
      allPinned: false,
      collapsed: Array.isArray(collapsed) ? new Set(collapsed.filter((key): key is string => typeof key === "string")) : DEFAULT_COLLAPSED,
    };
  } catch { return fallback; }
}

export function writePrefs(storage: Pick<Storage, "setItem"> | undefined, prefs: PickerPrefs): void {
  try { storage?.setItem(PREFS_KEY, JSON.stringify({ grouping: prefs.grouping, collapsed: [...prefs.collapsed] })); }
  catch { /* Full or blocked storage: the arrangement then lasts for this page only. */ }
}
