/**
 * The shell picks its layout from the space it actually has, not from device
 * classes. Thresholds are derived from what the content needs, so a foldable
 * that changes posture morphs between modes instead of flipping paradigms.
 *
 * "docked" — the navigation panel sits beside the session and both are usable.
 * "overlay" — the session owns the whole shell and navigation slides over it.
 */
export type ShellLayoutMode = "docked" | "overlay";

/** Below this a session list cannot show a readable label plus its actions. */
export const NAVIGATION_PANEL_MIN_WIDTH = 260;

/** Below this the transcript loses a comfortable measure and code blocks wrap badly. */
export const SESSION_COMFORTABLE_WIDTH = 560;

/** A panel only docks when it can do so without squeezing the session. */
export const NAVIGATION_DOCK_MIN_WIDTH = NAVIGATION_PANEL_MIN_WIDTH + SESSION_COMFORTABLE_WIDTH;

/** Below this the workspace panel cannot show a file tree or diff without truncating it. */
export const WORKSPACE_PANEL_MIN_WIDTH = 360;

/**
 * The narrowest shell that can hold the session and the workspace panel at once.
 *
 * Derived from what those two need, not from the three-pane shell: a reader who
 * has put the session list away can reasonably keep the workspace panel beside
 * the conversation well before the shell is wide enough for all three.
 */
export const WORKSPACE_DOCK_MIN_WIDTH = SESSION_COMFORTABLE_WIDTH + WORKSPACE_PANEL_MIN_WIDTH;

/**
 * Chrome stays resident only on a true multi-pane workspace — one wide enough
 * for navigation, the session, and the workspace panel at once. Anything
 * narrower is a single-surface shell where bands compete with the conversation
 * for the screen, so the conversation wins and the chrome is summoned.
 */
export const CHROME_RESIDENT_MIN_WIDTH = NAVIGATION_PANEL_MIN_WIDTH + SESSION_COMFORTABLE_WIDTH + WORKSPACE_PANEL_MIN_WIDTH;

export type ChromeDisclosure = "resident" | "summoned";

export function chromeDisclosure(availableWidth: number): ChromeDisclosure {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return "summoned";
  return availableWidth >= CHROME_RESIDENT_MIN_WIDTH ? "resident" : "summoned";
}

export function shellLayoutMode(availableWidth: number): ShellLayoutMode {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return "overlay";
  return availableWidth >= NAVIGATION_DOCK_MIN_WIDTH ? "docked" : "overlay";
}

export function shellLayoutModeClass(mode: ShellLayoutMode): string {
  return mode === "overlay" ? "overlay-navigation" : "docked-navigation";
}

export function chromeDisclosureClass(disclosure: ChromeDisclosure): string {
  return disclosure === "summoned" ? "chrome-summoned" : "chrome-resident";
}
