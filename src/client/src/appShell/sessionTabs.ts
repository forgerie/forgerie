import { SESSION_TABS_PER_SESSION_LIMIT } from "../../../shared/apiTypes";
import type { QualifiedContributionId } from "../plugins/ids";

/**
 * Session-scoped tab sets.
 *
 * A tab is a workspace tool the user promoted to the main surface for one
 * session. The set lives on the session record itself (`SessionInfo.tabs`),
 * which the server owns: it merges the set into listings, broadcasts
 * `session.tabs` changes, and reconciles records away when their session
 * disappears. The client holds no store of its own, so leftovers cannot
 * accumulate here. Chat is not stored: it is the permanent implicit first
 * tab of every session.
 */
export interface SessionTabsSource {
  tabs?: string[];
}

/** Storage key of the retired browser-local tab store; removed on startup. */
export const LEGACY_SESSION_TABS_STORAGE_KEY = "pi-web-session-tabs";

/** The session's promoted tools, narrowed to well-formed contribution ids. */
export function sessionTabsOf(session: SessionTabsSource | undefined): readonly QualifiedContributionId[] {
  const tabs = session?.tabs;
  if (tabs === undefined) return [];
  return tabs.filter(isQualifiedContributionId);
}

/** Adding an already-promoted tool is a no-op, not a duplicate tab; a full band refuses more. */
export function promotedSessionTabs(tabs: readonly string[], tool: QualifiedContributionId): string[] {
  if (tabs.includes(tool) || tabs.length >= SESSION_TABS_PER_SESSION_LIMIT) return [...tabs];
  return [...tabs, tool];
}

export function closedSessionTabs(tabs: readonly string[], tool: QualifiedContributionId): string[] {
  return tabs.filter((candidate) => candidate !== tool);
}

/**
 * What the main view may be, given a session's tabs.
 *
 * A tool holds the main surface only while it is one of the selected
 * session's tabs; anything else falls back to the conversation. This is the
 * rule that makes a session switch land on chat instead of another session's
 * promoted tool, and that returns a surface whose tab another device closed.
 */
export function reconciledMainView<View extends string>(tabs: readonly QualifiedContributionId[], view: View): View | "chat" {
  if (view === "chat" || view === "navigation") return view;
  return tabs.some((tab) => tab === view) ? view : "chat";
}

/**
 * Delete the retired localStorage tab store. Tab sets are server-owned now;
 * there is deliberately no import of the old data, so this shim never grows
 * into migration code that outlives its one user.
 */
export function removeLegacySessionTabsStorage(storage: Pick<Storage, "removeItem"> = window.localStorage): void {
  try {
    storage.removeItem(LEGACY_SESSION_TABS_STORAGE_KEY);
  } catch {
    // Unavailable storage has nothing to clean.
  }
}

function isQualifiedContributionId(value: string): value is QualifiedContributionId {
  return /^[^:\s]+:[^:\s]+/u.test(value);
}
