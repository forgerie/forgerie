// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAction } from "../../actions";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { SettingsShortcutsPanel } from "./SettingsShortcutsPanel";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("settings-shortcuts-panel layout", () => {
  it("renders the shared frame with ordered notices and no per-row editor", async () => {
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }) }, (element) => {
      element.error = "Failed to load shortcut settings.";
      element.savedMessage = "Shortcut settings saved.";
    });

    const frame = required(shadow(panel).querySelector("settings-panel-frame"), "settings-panel-frame");
    expect(frame.getAttribute("heading")).toBe("Keyboard shortcuts");
    expect(noticeTypes(frame)).toEqual(["error", "success"]);

    // Collapsed rows carry no text field: that is the whole vertical saving.
    expect(shadow(panel).querySelectorAll(".type-input").length).toBe(0);
    expect(shadow(panel).querySelectorAll(".row-panel").length).toBe(0);
    expect(rowNames(panel)).toEqual(["Cycle Model", "Open Palette"]);
  });

  it("shows the loading state before any config arrives", async () => {
    const panel = await mountPanel({ actions: [], loading: true });

    expect(shadow(panel).textContent).toContain("Loading shortcuts…");
    expect(shadow(panel).querySelector(".filter-input")).toBeNull();
  });

  it("renders each action as one collapsed row showing its effective shortcut", async () => {
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: { "core:model.cycle": null } }) });

    expect(chipLabels(panel)).toEqual(["off", "Ctrl+K"]);
  });
});

describe("settings-shortcuts-panel filtering", () => {
  it("narrows rows to the filter and reports the visible count", async () => {
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }) });

    await typeInto(panel, ".filter-input", "cycle");

    expect(rowNames(panel)).toEqual(["Cycle Model"]);
    expect(shadow(panel).querySelector(".filter-count")?.textContent).toBe("1/2");
  });

  it("matches on the rendered shortcut, not only the title", async () => {
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }) });

    await typeInto(panel, ".filter-input", "ctrl+k");

    expect(rowNames(panel)).toEqual(["Open Palette"]);
  });
});

describe("settings-shortcuts-panel row menu", () => {
  it("opens the four verbs, including a typed path for devices without a hardware keyboard", async () => {
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }) });

    await clickMore(panel, "Open Palette");

    expect(verbLabels(panel)).toEqual([
      "Record a new shortcut",
      "Type a shortcut instead",
      "Disable this shortcut",
      "Reset to default",
    ]);
  });

  it("exposes the action id and default only once a row is opened", async () => {
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }) });
    expect(shadow(panel).textContent).not.toContain("core:actions.show");

    await clickMore(panel, "Open Palette");

    const facts = required(shadow(panel).querySelector(".row-facts"), ".row-facts");
    expect(facts.textContent).toContain("core:actions.show");
    expect(facts.textContent).toContain("Default Ctrl+K");
  });

  it("closes the menu when the same row is tapped again", async () => {
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }) });

    await clickMore(panel, "Open Palette");
    expect(shadow(panel).querySelectorAll(".row-panel").length).toBe(1);

    await clickMore(panel, "Open Palette");
    expect(shadow(panel).querySelectorAll(".row-panel").length).toBe(0);
  });

  it("disables a shortcut, and resets an override back to the default", async () => {
    const onSave = vi.fn<SaveHandler>();

    const disabling = await mountPanel({ configResponse: configResponse({ shortcuts: { "core:model.cycle": "mod+o" } }), onSave });
    await clickMore(disabling, "Open Palette");
    await clickVerb(disabling, "Disable this shortcut");

    const resetting = await mountPanel({ configResponse: configResponse({ shortcuts: { "core:actions.show": null, "core:model.cycle": "mod+o" } }), onSave });
    await clickMore(resetting, "Open Palette");
    await clickVerb(resetting, "Reset to default");

    expect(onSave.mock.calls).toEqual([
      [{ shortcuts: { "core:model.cycle": "mod+o", "core:actions.show": null } }],
      [{ shortcuts: { "core:model.cycle": "mod+o" } }],
    ]);
  });

  it("drops the shortcuts key entirely when the last override is reset", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: { "core:actions.show": "mod+j" } }), onSave });

    await clickMore(panel, "Open Palette");
    await clickVerb(panel, "Reset to default");

    expect(onSave).toHaveBeenCalledWith({});
  });
});

describe("settings-shortcuts-panel typed entry", () => {
  it("saves a typed shortcut, which is the only path that works with an on-screen keyboard", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }), onSave });

    await clickMore(panel, "Open Palette");
    await clickVerb(panel, "Type a shortcut instead");
    await typeInto(panel, ".type-input", "control + shift + p");

    expect(chipLabels(panel)).toEqual(["Ctrl+P", "Ctrl+Shift+P"]);

    await clickButton(panel, ".type-row .primary");

    expect(onSave).toHaveBeenCalledWith({ shortcuts: { "core:actions.show": "mod+shift+p" } });
  });

  it("seeds the field with the saved binding and explains why an unparseable entry cannot be saved", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }), onSave });

    await clickMore(panel, "Open Palette");
    await clickVerb(panel, "Type a shortcut instead");
    expect(field(panel, ".type-input").value).toBe("mod+k");

    await typeInto(panel, ".type-input", "p");

    // Save stays disabled, so the hint has to carry the reason.
    expect(required(shadow(panel).querySelector<HTMLButtonElement>(".type-row .primary"), "save").disabled).toBe(true);
    expect(shadow(panel).querySelector(".hint.warn")?.textContent).toBe("Shortcuts must start with Ctrl/⌘ or Alt.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("abandons the edit on Cancel without saving", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }), onSave });

    await clickMore(panel, "Open Palette");
    await clickVerb(panel, "Type a shortcut instead");
    await typeInto(panel, ".type-input", "mod+j");
    await clickButton(panel, ".type-row button:not(.primary)");

    expect(onSave).not.toHaveBeenCalled();
    expect(chipLabels(panel)).toEqual(["Ctrl+P", "Ctrl+K"]);
  });
});

describe("settings-shortcuts-panel recording", () => {
  it("records a chord from the chip and commits it once the sequence settles", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn<SaveHandler>();
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }), onSave });

    await clickChip(panel, "Open Palette");
    expect(chipLabels(panel)).toEqual(["Ctrl+P", "press keys…"]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", ctrlKey: true }));
    await panel.updateComplete;
    expect(chipLabels(panel)).toEqual(["Ctrl+P", "Ctrl+J"]);

    await vi.advanceTimersByTimeAsync(1300);

    expect(onSave).toHaveBeenCalledWith({ shortcuts: { "core:actions.show": "mod+j" } });
  });

  it("records a two-step sequence before committing", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn<SaveHandler>();
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }), onSave });

    await clickChip(panel, "Open Palette");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", ctrlKey: true }));
    await panel.updateComplete;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    await panel.updateComplete;

    await vi.advanceTimersByTimeAsync(1300);

    expect(onSave).toHaveBeenCalledWith({ shortcuts: { "core:actions.show": "mod+g p" } });
  });

  it("refuses a first chord without Ctrl or Alt and keeps recording", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }), onSave });

    await clickChip(panel, "Open Palette");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p" }));
    await panel.updateComplete;

    expect(onSave).not.toHaveBeenCalled();
    expect(chipLabels(panel)).toEqual(["Ctrl+P", "press keys…"]);
  });

  it("abandons the recording on Escape", async () => {
    const onSave = vi.fn<SaveHandler>();
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }), onSave });

    await clickChip(panel, "Open Palette");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await panel.updateComplete;

    expect(onSave).not.toHaveBeenCalled();
    expect(chipLabels(panel)).toEqual(["Ctrl+P", "Ctrl+K"]);
  });
});

describe("settings-shortcuts-panel conflicts", () => {
  it("marks the binding that never fires and names the winner", async () => {
    // A custom binding outranks a default one, so the overridden Cycle Model
    // wins mod+k and Open Palette's default stops firing. Rows sort by title.
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: { "core:model.cycle": "mod+k" } }) });

    const dots = [...shadow(panel).querySelectorAll(".dot")];
    expect(dots.map((dot) => dot.className)).toEqual(["dot shadows", "dot shadowed"]);
    expect(dots[0]?.getAttribute("title")).toBe("Overrides Open Palette");
    expect(dots[1]?.getAttribute("title")).toBe("Never fires — Cycle Model wins this key");
  });

  it("previews a conflict from a typed draft before it is saved", async () => {
    const panel = await mountPanel({ configResponse: configResponse({ shortcuts: {} }) });
    expect(shadow(panel).querySelectorAll(".dot").length).toBe(0);

    await clickMore(panel, "Cycle Model");
    await clickVerb(panel, "Type a shortcut instead");
    await typeInto(panel, ".type-input", "mod+k");

    expect(shadow(panel).querySelector(".hint.warn")?.textContent).toBe("Overrides Open Palette");
    const dots = [...shadow(panel).querySelectorAll(".dot")];
    expect(dots.map((dot) => dot.getAttribute("title"))).toEqual(["Overrides Open Palette", "Never fires — Cycle Model wins this key"]);
  });
});

/* ------------------------------------------------------------- harness -- */

type SaveHandler = (config: PiWebConfigValues) => void | Promise<void>;

interface PanelOptions {
  actions?: AppAction[];
  configResponse?: PiWebConfigResponse;
  loading?: boolean;
  onSave?: SaveHandler;
}

async function mountPanel(options: PanelOptions, configure?: (panel: SettingsShortcutsPanel) => void): Promise<SettingsShortcutsPanel> {
  const panel = new SettingsShortcutsPanel();
  panel.actions = options.actions ?? defaultActions();
  if (options.configResponse !== undefined) panel.configResponse = options.configResponse;
  if (options.loading !== undefined) panel.loading = options.loading;
  if (options.onSave !== undefined) panel.onSave = options.onSave;
  configure?.(panel);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function defaultActions(): AppAction[] {
  return [
    { id: "core:actions.show", title: "Open Palette", description: "Open the command palette.", shortcut: "mod+k", group: "General", run: vi.fn() },
    { id: "core:model.cycle", title: "Cycle Model", description: "Cycle the active model.", shortcut: "mod+p", group: "General", run: vi.fn() },
  ];
}

function texts(panel: SettingsShortcutsPanel, selector: string): string[] {
  return [...shadow(panel).querySelectorAll(selector)].map((node) => node.textContent.trim());
}

function rowNames(panel: SettingsShortcutsPanel): string[] {
  return texts(panel, ".row-name");
}

function chipLabels(panel: SettingsShortcutsPanel): string[] {
  return texts(panel, ".chip");
}

function verbLabels(panel: SettingsShortcutsPanel): string[] {
  return texts(panel, ".row-verbs button");
}

function noticeTypes(frame: Element): string[] {
  const notices: unknown = Reflect.get(frame, "notices");
  if (!Array.isArray(notices)) throw new Error("Expected the frame to receive a notices array");
  return notices.map((notice: unknown) => {
    if (typeof notice !== "object" || notice === null) throw new Error("Expected a settings notice object");
    return String(Reflect.get(notice, "type"));
  });
}

async function clickMore(panel: SettingsShortcutsPanel, actionTitle: string): Promise<void> {
  await clickButton(panel, `.more[aria-label="More options for ${actionTitle}"]`);
}

async function clickChip(panel: SettingsShortcutsPanel, actionTitle: string): Promise<void> {
  const chip = [...shadow(panel).querySelectorAll<HTMLButtonElement>(".chip")]
    .find((button) => (button.getAttribute("aria-label") ?? "").includes(actionTitle));
  required(chip, `chip for ${actionTitle}`).click();
  await panel.updateComplete;
}

async function clickVerb(panel: SettingsShortcutsPanel, label: string): Promise<void> {
  const verb = [...shadow(panel).querySelectorAll<HTMLButtonElement>(".row-verbs button")]
    .find((button) => button.textContent.trim() === label);
  required(verb, `verb ${label}`).click();
  await panel.updateComplete;
  await panel.updateComplete;
}

async function clickButton(panel: SettingsShortcutsPanel, selector: string): Promise<void> {
  required(shadow(panel).querySelector<HTMLButtonElement>(selector), selector).click();
  await panel.updateComplete;
  await panel.updateComplete;
}

async function typeInto(panel: SettingsShortcutsPanel, selector: string, value: string): Promise<void> {
  const input = field(panel, selector);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await panel.updateComplete;
}

function field(panel: SettingsShortcutsPanel, selector: string): HTMLInputElement {
  return required(shadow(panel).querySelector<HTMLInputElement>(selector), selector);
}

function shadow(panel: SettingsShortcutsPanel): ShadowRoot {
  return required(panel.shadowRoot, "the panel shadow root");
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be rendered`);
  return value;
}

function configResponse(config: PiWebConfigValues): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig: config,
    envOverrides: { host: false, port: false, allowedHosts: false, spawnSessions: false, subsessions: false, askUser: false, agentCommand: false, agentDir: false, agentSessionDir: false },
  };
}
