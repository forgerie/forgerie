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

export function shellLayoutMode(availableWidth: number): ShellLayoutMode {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return "overlay";
  return availableWidth >= NAVIGATION_DOCK_MIN_WIDTH ? "docked" : "overlay";
}

export function shellLayoutModeClass(mode: ShellLayoutMode): string {
  return mode === "overlay" ? "overlay-navigation" : "docked-navigation";
}
