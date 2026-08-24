// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi, piPackagesApi, pluginsApi } from "../api";
import type { InboxDensity } from "../inboxDensity";
import { deepActiveElement, dialogSection, dialogSurface, pressKey, requiredElement, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";
import { activeSettingsPanelTag, SettingsDialog } from "./SettingsDialog";
import { configResponse, pluginsResponse } from "./SettingsDialog.testSupport";

beforeEach(() => {
  // The dialog loads gateway and selected-machine settings data when it
  // connects; stub those boundary calls so the shell tests stay deterministic.
  vi.spyOn(configApi, "config").mockResolvedValue(configResponse({}));
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(piPackagesApi, "packages").mockResolvedValue({ packages: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

describe("settings-dialog modal surface", () => {
  it("moves focus into the labelled dialog when opened", async () => {
    const dialog = await mountDialog();

    expect(deepActiveElement()).toBe(dialogSection(dialog));
    expect(dialogSection(dialog).getAttribute("aria-label")).toBe("Forgerie settings");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn<() => void>();
    const dialog = await mountDialog({ onClose });

    pressKey(dialogSurface(dialog), "Escape");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop itself is pressed", async () => {
    const onClose = vi.fn<() => void>();
    const dialog = await mountDialog({ onClose });

    surfaceBackdrop(dialog).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves focus from the dialog section to the first dialog control on Tab", async () => {
    const dialog = await mountDialog();
    // Close leads the chrome in both the rail and the strip layout, so Tab
    // reaches it before the section tabs.
    const closeButton = requiredElement(dialog.shadowRoot?.querySelector<HTMLButtonElement>(".settings-chrome > .close-button"), "settings close button");
    expect(deepActiveElement()).toBe(dialogSection(dialog));

    pressKey(dialogSurface(dialog), "Tab");

    expect(deepActiveElement()).toBe(closeButton);
  });
});

describe("settings-dialog section tabs", () => {
  it("names each section once, without a repeated machine-scope subtitle", async () => {
    const dialog = await mountDialog();

    expect(navLabels(dialog)).toEqual(["General", "Appearance", "Session daemon", "Pi packages", "Forgerie plugins", "Keyboard"]);
  });

  it("routes the appearance section to the appearance panel and hands the choice through", async () => {
    const chosen: InboxDensity[] = [];
    const dialog = await mountDialog({ onInboxDensityChange: (density) => { chosen.push(density); } });
    dialog.section = "appearance";
    dialog.inboxDensity = "dense";
    await settleRenderedDialog(dialog);

    expect(activeSettingsPanelTag("appearance")).toBe("settings-appearance-panel");
    const panel = requiredElement(dialog.shadowRoot?.querySelector("settings-appearance-panel"), "appearance panel");
    expect(panel.inboxDensity).toBe("dense");

    panel.onInboxDensityChange?.("comfortable");

    expect(chosen).toEqual(["comfortable"]);
  });

  it("scrolls the selected tab into view so a deep link does not open with it off-screen", async () => {
    // happy-dom has no layout, so assert the call rather than the geometry.
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => undefined);
    const dialog = await mountDialog();

    dialog.section = "shortcuts";
    await settleRenderedDialog(dialog);
    await nextFrame();

    const selected = requiredElement(dialog.shadowRoot?.querySelector(".settings-nav button.selected"), "selected tab");
    expect(selected.textContent.trim()).toBe("Keyboard");
    expect(scrollIntoView.mock.instances).toContain(selected);
  });
});

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
}

function navLabels(dialog: SettingsDialog): string[] {
  return [...requiredElement(dialog.shadowRoot?.querySelector(".settings-nav"), "settings nav").querySelectorAll("button")]
    .map((button) => button.textContent.trim());
}

interface SettingsDialogCallbacks {
  onClose?: () => void;
  onInboxDensityChange?: (density: InboxDensity) => void;
}

async function mountDialog(callbacks: SettingsDialogCallbacks = {}): Promise<SettingsDialog> {
  const dialog = new SettingsDialog();
  Object.assign(dialog, callbacks);
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}
