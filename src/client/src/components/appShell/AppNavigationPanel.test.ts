// @vitest-environment happy-dom

/**
 * Tests for AppNavigationPanel.
 *
 * The panel now hosts the session inbox instead of the four-section funnel.
 * Tests verify: the machine switcher is still wired up with unread presence,
 * `shouldShowMachinesSection` logic, and the inbox panel is rendered.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { Machine } from "../../api";
import type { UnreadPresence } from "../../unreadPresence";
import { MachineList } from "../MachineList";
import { MachineSwitcher } from "../MachineSwitcher";
import { AppNavigationPanel, shouldShowMachinesSection } from "./AppNavigationPanel";

afterEach(() => {
  document.body.replaceChildren();
});

describe("shouldShowMachinesSection", () => {
  it("hides machine navigation when there is no machine choice", () => {
    expect(shouldShowMachinesSection([])).toBe(false);
    expect(shouldShowMachinesSection([machine("local")])).toBe(false);
  });

  it("shows machine navigation when there are multiple machines", () => {
    expect(shouldShowMachinesSection([machine("local"), machine("remote-a")])).toBe(true);
  });
});

describe("machine unread presence wiring", () => {
  it("feeds the machine unread slice to the machine-switcher and machine-list", async () => {
    const unreadPresence: UnreadPresence = {
      machines: new Set(["remote-a"]),
      projects: new Set(["project-1"]),
      workspaces: new Set(["ws-1"]),
    };
    const panel = new AppNavigationPanel();
    panel.compact = true;
    panel.machines = [machine("local"), machine("remote-a")];
    panel.selectedMachine = machine("local");
    panel.unreadPresence = unreadPresence;
    document.body.append(panel);
    await panel.updateComplete;

    const switcher = panel.shadowRoot?.querySelector("machine-switcher");
    const machineList = panel.shadowRoot?.querySelector("machine-list");
    if (!(switcher instanceof MachineSwitcher)) throw new Error("Expected machine-switcher");
    if (!(machineList instanceof MachineList)) throw new Error("Expected machine-list");

    expect(switcher.unreadMachineIds).toBe(unreadPresence.machines);
    expect(machineList.unreadMachineIds).toBe(unreadPresence.machines);
  });

  it("renders session-inbox-panel as the primary navigation content", async () => {
    const panel = new AppNavigationPanel();
    panel.machines = [machine("local")];
    document.body.append(panel);
    await panel.updateComplete;

    const inbox = panel.shadowRoot?.querySelector("session-inbox-panel");
    expect(inbox).not.toBeNull();
  });
});

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}
