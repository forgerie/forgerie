// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiWebConfigResponse, PiWebConfigValues } from "../../api";
import { SettingsSessiondPanel } from "./SettingsSessiondPanel";

beforeEach(() => {
  document.body.replaceChildren();
});

describe("SettingsSessiondPanel Run Scripts setting", () => {
  it("shows codemode as on when the config file leaves it unset", async () => {
    const panel = await renderedPanel(configResponse({}, {}));
    expect(codemodeToggle(panel).checked).toBe(true);
    expect(summaryValue(panel, "Run scripts")).toBe("Enabled");
  });

  it("lets the user turn codemode off with a daemon config patch", async () => {
    const onSave = vi.fn();
    const panel = await renderedPanel(configResponse({ codemode: true }, { codemode: true }), onSave);

    codemodeToggle(panel).click();
    await Promise.resolve();

    expect(onSave).toHaveBeenCalledWith({ codemode: false });
  });

  it("keeps an environment-overridden setting read-only", async () => {
    const panel = await renderedPanel(configResponse({}, { codemode: false }, true));
    const toggle = codemodeToggle(panel);
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(true);
    expect(summaryValue(panel, "Run scripts")).toBe("Disabled");
  });
});

async function renderedPanel(config: PiWebConfigResponse, onSave = vi.fn()): Promise<SettingsSessiondPanel> {
  const panel = new SettingsSessiondPanel();
  panel.configResponse = config;
  panel.onSave = onSave;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function codemodeToggle(panel: SettingsSessiondPanel): HTMLInputElement {
  const toggle = panel.shadowRoot?.querySelector<HTMLInputElement>('input[aria-label="Enable Run Scripts"]');
  if (toggle === undefined || toggle === null) throw new Error("Run Scripts toggle was not rendered");
  return toggle;
}

function summaryValue(panel: SettingsSessiondPanel, term: string): string | undefined {
  const rows = [...(panel.shadowRoot?.querySelectorAll(".effective-card dl > div") ?? [])];
  return rows.find((row) => row.querySelector("dt")?.textContent === term)?.querySelector("dd")?.textContent.trim();
}

function configResponse(config: PiWebConfigValues, effectiveConfig: PiWebConfigValues, codemodeOverride = false): PiWebConfigResponse {
  return {
    path: "/tmp/pi-web/config.json",
    exists: true,
    config,
    effectiveConfig,
    envOverrides: {
      host: false,
      port: false,
      allowedHosts: false,
      spawnSessions: false,
      subsessions: false,
      askUser: false,
      codemode: codemodeOverride,
      agentCommand: false,
      agentDir: false,
      agentSessionDir: false,
    },
  };
}
