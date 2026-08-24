/**
 * How much vertical space one inbox row takes, and what that means for the row.
 *
 * The second line of a row was carrying two very different things. For a
 * blocked, errored, or working session it carries a detail -- the question, the
 * error, the named wait -- and that text is the reason to look at the row at
 * all. For every other session it carries the location chip and nothing else,
 * because `renderRow` only computes a detail for those three states. In a list
 * where most sessions are open, that is a line per row for one repeated word.
 *
 * Dense gives the ordinary row its single line and puts the location on it.
 * Nothing is dropped: a row with a detail still takes the second line, so the
 * sessions that need reading are also the taller ones.
 */
export type InboxDensity = "dense" | "comfortable";

/**
 * The two shapes a row can take. Derived from the density and from whether the
 * row has a detail to report, never set directly, so the styles can select on
 * one attribute instead of reasoning about the combination.
 */
export type InboxRowShape = "one-line" | "two-line";

export const INBOX_DENSITY_STORAGE_KEY = "pi-web.inbox.density";

/** Dense by default: most rows have nothing to put on a second line. */
export const DEFAULT_INBOX_DENSITY: InboxDensity = "dense";

export type InboxDensityStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The shape a row takes.
 *
 * Comfortable always takes two lines, whether or not the row fills the second.
 * Dense takes one line unless the row has a detail, which never happens outside
 * the blocked, errored, and working states.
 */
export function inboxRowShape(density: InboxDensity, hasDetail: boolean): InboxRowShape {
  if (density === "comfortable") return "two-line";
  return hasDetail ? "two-line" : "one-line";
}

export function parseInboxDensity(value: string | null): InboxDensity | undefined {
  if (value === "dense") return "dense";
  if (value === "comfortable") return "comfortable";
  return undefined;
}

export function readInboxDensityPreference(storage = browserStorage()): InboxDensity | undefined {
  if (storage === undefined) return undefined;
  try {
    return parseInboxDensity(storage.getItem(INBOX_DENSITY_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function writeInboxDensityPreference(density: InboxDensity, storage = browserStorage()): void {
  if (storage === undefined) return;
  try {
    storage.setItem(INBOX_DENSITY_STORAGE_KEY, density);
  } catch {
    // Ignore storage failures. The choice still applies for this page.
  }
}

/** The density to start with: the stored choice, or dense when there is none. */
export function initialInboxDensity(storage = browserStorage()): InboxDensity {
  return readInboxDensityPreference(storage) ?? DEFAULT_INBOX_DENSITY;
}

function browserStorage(): InboxDensityStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
