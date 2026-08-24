// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { InboxDensity } from "../../inboxDensity";
import { INBOX_DENSITY_CHOICES, SettingsAppearancePanel } from "./SettingsAppearancePanel";

afterEach(() => {
  document.body.replaceChildren();
});

describe("settings-appearance-panel", () => {
  it("offers every density the model defines", async () => {
    const panel = await mountPanel();

    // The list comes from the model, so a new density cannot ship without a
    // control for it.
    expect(choiceValues(panel)).toEqual(INBOX_DENSITY_CHOICES.map((choice) => choice.value));
    expect(choiceValues(panel)).toEqual(["dense", "comfortable"]);
  });

  it("marks the active density as the checked radio", async () => {
    const panel = await mountPanel({ inboxDensity: "comfortable" });

    expect(checkedChoice(panel)).toBe("comfortable");

    panel.inboxDensity = "dense";
    await panel.updateComplete;

    expect(checkedChoice(panel)).toBe("dense");
  });

  it("reports the chosen density", async () => {
    const chosen: InboxDensity[] = [];
    const panel = await mountPanel({
      inboxDensity: "dense",
      onInboxDensityChange: (density) => { chosen.push(density); },
    });

    choiceButton(panel, "comfortable").click();

    expect(chosen).toEqual(["comfortable"]);
  });

  it("stays quiet without a listener", async () => {
    const panel = await mountPanel();

    expect(() => { choiceButton(panel, "comfortable").click(); }).not.toThrow();
  });
});

async function mountPanel(props: Partial<SettingsAppearancePanel> = {}): Promise<SettingsAppearancePanel> {
  const panel = new SettingsAppearancePanel();
  Object.assign(panel, props);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function choiceButtons(panel: SettingsAppearancePanel): HTMLButtonElement[] {
  const root = panel.shadowRoot;
  if (root === null) throw new Error("No shadow root");
  return [...root.querySelectorAll<HTMLButtonElement>("[data-density]")];
}

function choiceValues(panel: SettingsAppearancePanel): (string | null)[] {
  return choiceButtons(panel).map((button) => button.getAttribute("data-density"));
}

function checkedChoice(panel: SettingsAppearancePanel): string | null {
  const checked = choiceButtons(panel).filter((button) => button.getAttribute("aria-checked") === "true");
  if (checked.length !== 1) throw new Error(`Expected exactly one checked density, found ${String(checked.length)}`);
  return checked[0]?.getAttribute("data-density") ?? null;
}

function choiceButton(panel: SettingsAppearancePanel, density: InboxDensity): HTMLButtonElement {
  const button = choiceButtons(panel).find((candidate) => candidate.getAttribute("data-density") === density);
  if (button === undefined) throw new Error(`No control for density ${density}`);
  return button;
}
