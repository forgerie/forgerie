// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { radialLayout, type RadialLayout } from "../../appShell/radialMenu";
import { AppRadialMenu } from "./AppRadialMenu";

afterEach(() => {
  document.body.replaceChildren();
});

describe("AppRadialMenu", () => {
  it("renders nothing before arming or layout", async () => {
    const menu = await mount();

    expect(menu.shadowRoot?.childElementCount).toBe(0);
  });

  it("renders the hold ring at the press point", async () => {
    const menu = new AppRadialMenu();
    menu.arming = { x: 25, y: 40 };
    menu.holdMs = 650;
    document.body.append(menu);
    await menu.updateComplete;

    expect(menu.shadowRoot?.querySelector(".arm-ring")?.getAttribute("style")).toContain("left: 25px");
    expect(menu.shadowRoot?.querySelector(".arm-ring")?.getAttribute("style")).toContain("animation-duration: 650ms");
  });

  it("renders enabled, disabled, selected, missing, and badged wedges", async () => {
    const layout = radialLayout({ x: 200, y: 200 }, { width: 400, height: 400 }, 4);
    if (layout === undefined) throw new Error("Expected radial layout");
    const menu = new AppRadialMenu();
    menu.layout = layout;
    menu.hovered = 1;
    menu.entries = [
      { slot: 0, label: "Sessions", icon: "S", enabled: true, badge: "2" },
      { slot: 1, label: "Files", icon: "F", enabled: false },
      { slot: 2, label: "Terminal", icon: "T", enabled: true },
    ];
    document.body.append(menu);
    await menu.updateComplete;

    const wedges = menu.shadowRoot?.querySelectorAll("path.wedge");
    expect(wedges).toHaveLength(4);
    expect(wedges?.[1]?.classList.contains("on")).toBe(true);
    expect(wedges?.[1]?.classList.contains("off")).toBe(true);
    expect(menu.shadowRoot?.textContent).toContain("Files (empty)");
    expect(menu.shadowRoot?.querySelector(".badge-text")?.textContent).toBe("2");
    expect(menu.shadowRoot?.querySelectorAll("g.glyph")).toHaveLength(3);
  });

  it("omits a glyph when the wedge has no on-screen point", async () => {
    const layout: RadialLayout = {
      press: { x: 0, y: 0 },
      outer: 60,
      inner: 20,
      step: 180,
      wedges: [
        { slot: 0, centre: 0, from: -90, to: 90, glyphRadius: undefined },
        { slot: 1, centre: 180, from: 90, to: 270, glyphRadius: 40 },
      ],
    };
    const menu = new AppRadialMenu();
    menu.layout = layout;
    menu.entries = [{ slot: 0, label: "Hidden", icon: "H", enabled: true }];
    document.body.append(menu);
    await menu.updateComplete;

    expect(menu.shadowRoot?.querySelectorAll("path.wedge")).toHaveLength(2);
    expect(menu.shadowRoot?.querySelector("g.glyph")).toBeNull();
  });
});

async function mount(): Promise<AppRadialMenu> {
  const menu = new AppRadialMenu();
  document.body.append(menu);
  await menu.updateComplete;
  return menu;
}
