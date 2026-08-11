import { describe, expect, it } from "vitest";
import type { ShellPanel } from "./panelIntent";
import { PANEL_PEEK, PEEK_CLOSED, peekProgress, peekedPanel, releasePeek, trackPeek, type PanelPeek } from "./panelPeek";

const SHEET = 300;

describe("trackPeek", () => {
  it("ignores a drag that has not travelled far enough to be meant", () => {
    expect(track(PEEK_CLOSED, PANEL_PEEK.capturePx - 1, 0)).toEqual(PEEK_CLOSED);
  });

  it("pulls the navigation panel in from the left on a rightward drag", () => {
    const peek = track(PEEK_CLOSED, 60, 0);

    expect(peek).toEqual({ kind: "tracking", panel: "navigation", progress: 0.2, gesture: "opening" });
  });

  it("pulls the workspace panel in from the right on a leftward drag", () => {
    expect(peekedPanel(track(PEEK_CLOSED, -60, 0))).toBe("workspace");
  });

  it("gives a scroll back to the list it started in", () => {
    // Mostly down, with the sideways drift a real thumb produces.
    expect(track(PEEK_CLOSED, 30, 120)).toEqual(PEEK_CLOSED);
  });

  it("forgives the arc a thumb travels in", () => {
    // 20 degrees off horizontal: an arc, not a scroll.
    expect(peekedPanel(track(PEEK_CLOSED, 100, 36))).toBe("navigation");
  });

  it("refuses a panel that is already docked, since it is not hidden", () => {
    const peek = trackPeek({
      current: PEEK_CLOSED,
      dx: 60,
      dy: 0,
      sheetWidthPx: SHEET,
      peekable: (panel) => panel !== "navigation",
      config: PANEL_PEEK,
    });

    expect(peek).toEqual(PEEK_CLOSED);
  });

  it("keeps the panel it captured when the finger crosses back over its start", () => {
    const captured = track(PEEK_CLOSED, 60, 0);

    // Back past the origin. This must not summon the other sheet.
    expect(peekedPanel(track(captured, -40, 0))).toBe("navigation");
  });

  it("never pulls the sheet past its own width", () => {
    expect(peekProgress(track(PEEK_CLOSED, SHEET * 3, 0), "navigation")).toBe(1);
  });

  it("lets an open sheet be pushed back out", () => {
    const open: PanelPeek = { kind: "open", panel: "navigation" };

    expect(track(open, -SHEET / 2, 0)).toEqual({ kind: "tracking", panel: "navigation", progress: 0.5, gesture: "closing" });
  });

  it("keeps pushing out across a whole retreat, not only its first move", () => {
    // The defect this guards: once tracking, a retreat was re-read as an
    // opening drag running backwards, so the sheet collapsed to nothing on the
    // second move and vanished on release.
    let peek = track({ kind: "open", panel: "navigation" }, -30, 0);
    for (const travelled of [-45, -60, -75]) peek = track(peek, travelled, 0);

    expect(peek).toEqual({ kind: "tracking", panel: "navigation", progress: 0.75, gesture: "closing" });
    expect(releasePeek(peek, PANEL_PEEK)).toEqual({ kind: "open", panel: "navigation" });
  });

  it("pulls the sheet open again when a retreat reverses under the finger", () => {
    const pushed = track({ kind: "open", panel: "navigation" }, -120, 0);

    expect(track(pushed, 20, 0)).toEqual({ kind: "tracking", panel: "navigation", progress: 1, gesture: "closing" });
  });

  it("closes when the retreat carried the sheet most of the way out", () => {
    const pushed = track({ kind: "open", panel: "navigation" }, -SHEET * 0.8, 0);

    expect(releasePeek(pushed, PANEL_PEEK)).toEqual({ kind: "closing", panel: "navigation" });
  });

  it("holds still when the shell has not been measured", () => {
    const peek = trackPeek({ current: PEEK_CLOSED, dx: 200, dy: 0, sheetWidthPx: 0, peekable: () => true, config: PANEL_PEEK });

    expect(peek).toEqual(PEEK_CLOSED);
  });
});

describe("releasePeek", () => {
  it("opens a sheet that was pulled past the commit point", () => {
    const peek: PanelPeek = { kind: "tracking", panel: "navigation", progress: PANEL_PEEK.commitFraction, gesture: "opening" };

    expect(releasePeek(peek, PANEL_PEEK)).toEqual({ kind: "open", panel: "navigation" });
  });

  it("sends a half-hearted look back the way it came, rather than deleting it", () => {
    const peek: PanelPeek = { kind: "tracking", panel: "navigation", progress: PANEL_PEEK.commitFraction - 0.01, gesture: "opening" };

    // Still on screen, on its way out: a sheet that arrived by following a
    // finger has to leave the same way.
    expect(releasePeek(peek, PANEL_PEEK)).toEqual({ kind: "closing", panel: "navigation" });
  });

  it("leaves a settled sheet as it found it", () => {
    const open: PanelPeek = { kind: "open", panel: "workspace" };

    expect(releasePeek(open, PANEL_PEEK)).toEqual(open);
    expect(releasePeek(PEEK_CLOSED, PANEL_PEEK)).toEqual(PEEK_CLOSED);
  });
});

describe("peekProgress", () => {
  it("reports a sheet on its way out as fully retracted", () => {
    expect(peekProgress({ kind: "closing", panel: "navigation" }, "navigation")).toBe(0);
  });

  it("reports nothing for the panel that is not being looked at", () => {
    expect(peekProgress({ kind: "open", panel: "navigation" }, "workspace")).toBe(0);
    expect(peekProgress(PEEK_CLOSED, "navigation")).toBe(0);
  });
});

function track(current: PanelPeek, dx: number, dy: number, peekable: (panel: ShellPanel) => boolean = () => true): PanelPeek {
  return trackPeek({ current, dx, dy, sheetWidthPx: SHEET, peekable, config: PANEL_PEEK });
}
