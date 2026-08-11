import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_INTENTS, dockedPanels, toggledIntent, type PanelIntents } from "./panelIntent";
import { CHROME_RESIDENT_MIN_WIDTH, NAVIGATION_DOCK_MIN_WIDTH, WORKSPACE_DOCK_MIN_WIDTH } from "./shellLayoutMode";

/** CSS-pixel viewport widths for the acceptance device, see AGENTS.md. */
const FOLD8 = {
  unfoldedPortrait: 739,
  unfoldedLandscape: 979,
  foldedPortrait: 499,
  foldedLandscape: 789,
} as const;

const DESKTOP = 1440;

describe("dockedPanels", () => {
  it("docks nothing on a shell that only affords one surface", () => {
    for (const width of [FOLD8.foldedPortrait, FOLD8.foldedLandscape, FOLD8.unfoldedPortrait]) {
      expect(dockedPanels(width, DEFAULT_PANEL_INTENTS)).toEqual({ navigation: false, workspace: false });
    }
  });

  it("leaves a pin inert where no panel can dock, so a phone has no layout to be surprised by", () => {
    const everythingPinned: PanelIntents = { navigation: "pinned", workspace: "pinned" };

    for (const intents of [DEFAULT_PANEL_INTENTS, everythingPinned, dismissed()]) {
      expect(dockedPanels(FOLD8.foldedPortrait, intents)).toEqual({ navigation: false, workspace: false });
    }
  });

  it("climbs the ladder untouched: navigation first, then the workspace panel", () => {
    expect(dockedPanels(NAVIGATION_DOCK_MIN_WIDTH, DEFAULT_PANEL_INTENTS)).toEqual({ navigation: true, workspace: false });
    expect(dockedPanels(CHROME_RESIDENT_MIN_WIDTH, DEFAULT_PANEL_INTENTS)).toEqual({ navigation: true, workspace: true });
  });

  it("keeps a dismissed panel away at any width", () => {
    expect(dockedPanels(DESKTOP, dismissed())).toEqual({ navigation: false, workspace: false });
  });

  it("seats an explicit pin before a panel that was never touched", () => {
    // Room for the session and one panel. The pin asked; navigation only defaulted.
    const intents: PanelIntents = { navigation: "pinned", workspace: "auto" };

    expect(dockedPanels(1000, intents)).toEqual({ navigation: true, workspace: false });
  });

  it("docks a pinned workspace panel as soon as it and the session both fit", () => {
    // Read from what those two need together, not from the widest arrangement:
    // a reader who put the session list away can keep the panel well before
    // there is room for all three.
    const intents: PanelIntents = { navigation: "dismissed", workspace: "pinned" };

    expect(dockedPanels(WORKSPACE_DOCK_MIN_WIDTH - 1, intents).workspace).toBe(false);
    expect(dockedPanels(WORKSPACE_DOCK_MIN_WIDTH, intents).workspace).toBe(true);
  });

  it("keeps a pinned workspace panel through an unfold, and drops it on a fold", () => {
    const intents: PanelIntents = { navigation: "auto", workspace: "pinned" };

    // Unfolded landscape has room for the session and the panel, so the pin acts
    // and the session list steps aside for it.
    expect(dockedPanels(FOLD8.unfoldedLandscape, intents)).toEqual({ navigation: false, workspace: true });
    // Folded, neither fits beside a readable session, so the request lies dormant.
    expect(dockedPanels(FOLD8.foldedPortrait, intents)).toEqual({ navigation: false, workspace: false });
  });

  it("leaves an untouched workspace panel to the three-pane shell", () => {
    // Only an explicit pin docks it early. Never-touched still means "wait until
    // the shell can hold all three".
    expect(dockedPanels(WORKSPACE_DOCK_MIN_WIDTH, DEFAULT_PANEL_INTENTS).workspace).toBe(false);
    expect(dockedPanels(CHROME_RESIDENT_MIN_WIDTH, DEFAULT_PANEL_INTENTS).workspace).toBe(true);
  });

  it("gives the last slot to the cheaper panel when both are pinned", () => {
    const intents: PanelIntents = { navigation: "pinned", workspace: "pinned" };

    expect(dockedPanels(900, intents)).toEqual({ navigation: true, workspace: false });
  });

  it("re-docks a pinned panel that did not fit once the space returns", () => {
    const intents: PanelIntents = { navigation: "pinned", workspace: "pinned" };

    expect(dockedPanels(900, intents).workspace).toBe(false);
    expect(dockedPanels(DESKTOP, intents).workspace).toBe(true);
  });

  it("docks a pin below the width where the panel would dock on its own", () => {
    const belowAuto = NAVIGATION_DOCK_MIN_WIDTH + 10;

    expect(dockedPanels(belowAuto, { navigation: "dismissed", workspace: "auto" }).navigation).toBe(false);
    expect(dockedPanels(belowAuto, { navigation: "pinned", workspace: "auto" }).navigation).toBe(true);
  });

  it("treats an unmeasured shell as having no room", () => {
    expect(dockedPanels(0, DEFAULT_PANEL_INTENTS)).toEqual({ navigation: false, workspace: false });
    expect(dockedPanels(Number.NaN, DEFAULT_PANEL_INTENTS)).toEqual({ navigation: false, workspace: false });
  });
});

describe("toggledIntent", () => {
  it("puts away what the user can see", () => {
    expect(toggledIntent(DESKTOP, DEFAULT_PANEL_INTENTS, "navigation")).toBe("dismissed");
  });

  it("keeps what the user cannot see", () => {
    expect(toggledIntent(DESKTOP, dismissed(), "navigation")).toBe("pinned");
  });

  it("reads the shell, not the stored value: an inert pin toggles to a pin again", () => {
    // Pinned but too narrow to dock, so the control still offers to show it.
    expect(toggledIntent(FOLD8.foldedPortrait, { navigation: "pinned", workspace: "auto" }, "navigation")).toBe("pinned");
  });
});

function dismissed(): PanelIntents {
  return { navigation: "dismissed", workspace: "dismissed" };
}
