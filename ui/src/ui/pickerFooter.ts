/**
 * The session list's footer as a function of its own inner width. It holds the
 * app-wide places and the full-screen toggle. When the row runs out of room,
 * Settings gives up its word first (the gear is the best-known icon) and Full
 * screen moves into the list's ⋯ menu; then the places keep only their icons
 * and counts. No control leaves: each one stays a tap or two away.
 * Measured 2026-10-12 in Chromium at the Fold 8 sizes: Backlog with a two-digit count needs 111px, Triggers with
 * its chip 106px, the Settings gear 44px, and the gaps 8px, so the two named places fit from 268px. An 18rem list
 * has 271px inside. Below that the count chips truncate first. 25rem stays a guess: no list is that wide today.
 */
const REM = 16;
export const FOOTER_ALL_LABELS = 25 * REM;
export const FOOTER_ICONS_ONLY = 16.5 * REM;

export interface FooterPlan {
  /** Backlog and Triggers keep their words. */
  placeLabels: boolean;
  /** Settings keeps its word. */
  settingsLabel: boolean;
  /** Full screen as an icon in the footer, or as a checkbox item in the ⋯ menu. */
  fullScreen: "inline" | "menu";
}

export function footerPlan(innerWidth: number): FooterPlan {
  if (innerWidth >= FOOTER_ALL_LABELS) return { placeLabels: true, settingsLabel: true, fullScreen: "inline" };
  if (innerWidth >= FOOTER_ICONS_ONLY) return { placeLabels: true, settingsLabel: false, fullScreen: "menu" };
  return { placeLabels: false, settingsLabel: false, fullScreen: "menu" };
}
