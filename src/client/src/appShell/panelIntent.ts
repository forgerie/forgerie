import { CHROME_RESIDENT_MIN_WIDTH, NAVIGATION_DOCK_MIN_WIDTH, NAVIGATION_PANEL_MIN_WIDTH, SESSION_COMFORTABLE_WIDTH, WORKSPACE_DOCK_MIN_WIDTH, WORKSPACE_PANEL_MIN_WIDTH } from "./shellLayoutMode";

/**
 * What the user asked for, not what the shell decided. Space changes what a
 * panel looks like; it never rewrites the request behind it.
 *
 * "auto" — never touched. The measured width decides.
 * "pinned" — dock it wherever it fits.
 * "dismissed" — never dock it. Reachable on request only.
 */
export type PanelIntent = "auto" | "pinned" | "dismissed";

export type ShellPanel = "navigation" | "workspace";

export interface PanelIntents {
  readonly navigation: PanelIntent;
  readonly workspace: PanelIntent;
}

export interface DockedPanels {
  readonly navigation: boolean;
  readonly workspace: boolean;
}

export const DEFAULT_PANEL_INTENTS: PanelIntents = { navigation: "auto", workspace: "auto" };

/**
 * Cheapest panel first, so a shell that can only afford one dock gives it to the
 * panel that asks for least. The order is read from the content minimums rather
 * than declared, so it cannot drift from what the panels actually need.
 */
const PANEL_MIN_WIDTHS: Readonly<Record<ShellPanel, number>> = {
  navigation: NAVIGATION_PANEL_MIN_WIDTH,
  workspace: WORKSPACE_PANEL_MIN_WIDTH,
};

const PANELS_BY_COST: readonly ShellPanel[] = (["navigation", "workspace"] as const)
  .slice()
  .sort((left, right) => PANEL_MIN_WIDTHS[left] - PANEL_MIN_WIDTHS[right]);

/** The width at which a never-touched panel docks on its own. */
const AUTO_DOCK_MIN_WIDTHS: Readonly<Record<ShellPanel, number>> = {
  navigation: NAVIGATION_DOCK_MIN_WIDTH,
  workspace: CHROME_RESIDENT_MIN_WIDTH,
};

/**
 * The width below which docking this panel stops being reasonable.
 *
 * Read from what the panel and the session need together, not from the shell's
 * widest arrangement. A reader who has put the session list away can keep the
 * workspace panel beside the conversation long before there is room for all
 * three, and a posture that folds and unfolds should gain and lose that panel
 * on the same terms.
 *
 * Below the floor a pin stays a request: nothing docks, and the panel stays
 * reachable by gesture. A pin must never be able to hide a panel from its owner.
 */
const DOCK_FLOOR_WIDTHS: Readonly<Record<ShellPanel, number>> = {
  navigation: NAVIGATION_DOCK_MIN_WIDTH,
  workspace: WORKSPACE_DOCK_MIN_WIDTH,
};

/**
 * Which panels dock in the width available.
 *
 * A pin is a claim on space, not a promise of it: panels are seated while the
 * session keeps a readable measure, and one that cannot fit stays reachable on
 * request instead of squeezing the transcript. Explicit pins are seated before
 * never-touched panels, so a default never takes the last slot from a request.
 */
export function dockedPanels(availableWidth: number, intents: PanelIntents): DockedPanels {
  const docked = { navigation: false, workspace: false };
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return docked;

  let remaining = availableWidth - SESSION_COMFORTABLE_WIDTH;
  for (const panel of seatingOrder(availableWidth, intents)) {
    const cost = PANEL_MIN_WIDTHS[panel];
    if (remaining < cost) continue;
    docked[panel] = true;
    remaining -= cost;
  }
  return docked;
}

export function isDocked(availableWidth: number, intents: PanelIntents, panel: ShellPanel): boolean {
  return dockedPanels(availableWidth, intents)[panel];
}

/**
 * Whether pinning this panel could change anything at this width.
 *
 * Below its floor the shell has nowhere to put the panel, so a pin is stored
 * and nothing moves. A control that writes a preference and changes nothing is
 * a lie; the pin is offered only where it can act.
 */
export function canDockAt(availableWidth: number, panel: ShellPanel): boolean {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return false;
  return availableWidth >= DOCK_FLOOR_WIDTHS[panel];
}

/**
 * Toggling reads the shell rather than the stored value: the control says
 * "put this away" when the panel is on screen and "keep this" when it is not,
 * so one press always matches what the user sees.
 */
export function toggledIntent(availableWidth: number, intents: PanelIntents, panel: ShellPanel): PanelIntent {
  return isDocked(availableWidth, intents, panel) ? "dismissed" : "pinned";
}

/** Panels that want space, pins ahead of defaults, cheapest first within each. */
function seatingOrder(availableWidth: number, intents: PanelIntents): readonly ShellPanel[] {
  const seatable = PANELS_BY_COST.filter((panel) => availableWidth >= DOCK_FLOOR_WIDTHS[panel]);
  const pinned = seatable.filter((panel) => intents[panel] === "pinned");
  const automatic = seatable.filter((panel) => intents[panel] === "auto" && availableWidth >= AUTO_DOCK_MIN_WIDTHS[panel]);
  return [...pinned, ...automatic];
}
