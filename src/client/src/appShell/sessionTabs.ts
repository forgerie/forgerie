import type { QualifiedContributionId } from "../plugins/ids";

/**
 * Session-scoped tab sets.
 *
 * A tab is a workspace tool the user promoted to the main surface for one
 * session. The set is keyed by machine-scoped session key, so switching
 * sessions swaps tab sets and session B never sees session A's tabs. Chat is
 * not stored: it is the permanent implicit first tab of every session.
 */
export type SessionTabsBySession = Readonly<Record<string, readonly QualifiedContributionId[]>>;

export const SESSION_TABS_STORAGE_KEY = "pi-web-session-tabs";

export const NO_SESSION_TABS: SessionTabsBySession = {};

/** Adding an already-promoted tool is a no-op, not a duplicate tab. */
export function promoteSessionTab(tabs: SessionTabsBySession, sessionKey: string, tool: QualifiedContributionId): SessionTabsBySession {
  const current = tabs[sessionKey] ?? [];
  if (current.includes(tool)) return tabs;
  return { ...tabs, [sessionKey]: [...current, tool] };
}

/** Closing the last tab drops the session entry so storage does not collect empty keys. */
export function closeSessionTab(tabs: SessionTabsBySession, sessionKey: string, tool: QualifiedContributionId): SessionTabsBySession {
  const current = tabs[sessionKey];
  if (current?.includes(tool) !== true) return tabs;
  const remaining = current.filter((candidate) => candidate !== tool);
  if (remaining.length > 0) return { ...tabs, [sessionKey]: remaining };
  return Object.fromEntries(Object.entries(tabs).filter(([key]) => key !== sessionKey));
}

export function sessionTabsFor(tabs: SessionTabsBySession, sessionKey: string | undefined): readonly QualifiedContributionId[] {
  if (sessionKey === undefined) return [];
  return tabs[sessionKey] ?? [];
}

/**
 * What the main view may be, given a session's tabs.
 *
 * A tool holds the main surface only while it is one of the selected
 * session's tabs; anything else falls back to the conversation. This is the
 * rule that makes a session switch land on chat instead of another session's
 * promoted tool.
 */
export function reconciledMainView<View extends string>(tabs: SessionTabsBySession, sessionKey: string | undefined, view: View): View | "chat" {
  if (view === "chat" || view === "navigation") return view;
  const sessionTabs = sessionTabsFor(tabs, sessionKey);
  return sessionTabs.some((tab) => tab === view) ? view : "chat";
}

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export function readStoredSessionTabs(storage?: StorageReader): SessionTabsBySession {
  try {
    const raw = (storage ?? window.localStorage).getItem(SESSION_TABS_STORAGE_KEY);
    return raw === null ? NO_SESSION_TABS : parseSessionTabs(raw);
  } catch {
    return NO_SESSION_TABS;
  }
}

export function writeStoredSessionTabs(tabs: SessionTabsBySession, storage?: StorageWriter): void {
  try {
    (storage ?? window.localStorage).setItem(SESSION_TABS_STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // Ignore storage failures; the tabs still hold for this page lifetime.
  }
}

/** Unreadable storage falls back to no tabs rather than to guessed ones. */
function parseSessionTabs(raw: string): SessionTabsBySession {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return NO_SESSION_TABS;
    const tabs: Record<string, readonly QualifiedContributionId[]> = {};
    for (const [sessionKey, value] of Object.entries(parsed)) {
      const tools = parseToolList(value);
      if (tools.length > 0) tabs[sessionKey] = tools;
    }
    return tabs;
  } catch {
    return NO_SESSION_TABS;
  }
}

function parseToolList(value: unknown): readonly QualifiedContributionId[] {
  if (!Array.isArray(value)) return [];
  const tools: QualifiedContributionId[] = [];
  for (const entry of value) {
    if (isQualifiedContributionId(entry) && !tools.includes(entry)) tools.push(entry);
  }
  return tools;
}

function isQualifiedContributionId(value: unknown): value is QualifiedContributionId {
  return typeof value === "string" && /^[^:\s]+:[^:\s]+/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
