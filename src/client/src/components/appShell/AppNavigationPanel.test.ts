// @vitest-environment happy-dom

/**
 * Tests for AppNavigationPanel.
 *
 * The panel now hosts the session inbox instead of the four-section funnel.
 * Tests verify: the machine switcher is still wired up with unread presence,
 * `shouldShowMachinesSection` logic, and the inbox panel is rendered.
 */

import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine } from "../../api";
import type { UnreadPresence } from "../../unreadPresence";
import { MachineList } from "../MachineList";
import { MachineSwitcher } from "../MachineSwitcher";
import { SessionInboxPanel } from "../SessionInboxPanel";
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
  it("feeds the machine unread slice to the machine-switcher when docked", async () => {
    const panel = await mountPanel({ compact: false });

    const switcher = panel.shadowRoot?.querySelector("machine-switcher");
    if (!(switcher instanceof MachineSwitcher)) throw new Error("Expected machine-switcher");

    expect(switcher.unreadMachineIds).toBe(unreadPresence.machines);
    expect(panel.shadowRoot?.querySelector("machine-list")).toBeNull();
  });

  it("feeds the machine unread slice to the machine-list when compact", async () => {
    const panel = await mountPanel({ compact: true });

    const machineList = panel.shadowRoot?.querySelector("machine-list");
    if (!(machineList instanceof MachineList)) throw new Error("Expected machine-list");

    expect(machineList.unreadMachineIds).toBe(unreadPresence.machines);
    expect(panel.shadowRoot?.querySelector("machine-switcher")).toBeNull();
  });

  it("spends no header row on a single machine", async () => {
    const panel = new AppNavigationPanel();
    panel.machines = [machine("local")];
    document.body.append(panel);
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector("header")).toBeNull();
  });

  it("renders session-inbox-panel as the primary navigation content", async () => {
    const panel = new AppNavigationPanel();
    panel.machines = [machine("local")];
    document.body.append(panel);
    await panel.updateComplete;

    const inbox = panel.shadowRoot?.querySelector("session-inbox-panel");
    expect(inbox).not.toBeNull();
  });

  it("forwards plugin shelves to the inbox floor", async () => {
    const panel = new AppNavigationPanel();
    const shelves = [html`<p>Quota</p>`];
    panel.machines = [machine("local")];
    panel.inboxShelves = shelves;
    document.body.append(panel);
    await panel.updateComplete;

    const inbox = panel.shadowRoot?.querySelector("session-inbox-panel");
    if (!(inbox instanceof SessionInboxPanel)) throw new Error("Expected session-inbox-panel");
    expect(inbox.inboxShelves).toBe(shelves);
  });

  it("focuses the inbox when it is rendered", async () => {
    const panel = new AppNavigationPanel();
    document.body.append(panel);
    await panel.updateComplete;
    const inbox = panel.shadowRoot?.querySelector<HTMLElement>("session-inbox-panel");
    if (inbox === null || inbox === undefined) throw new Error("Expected session inbox");
    const focus = vi.fn();
    inbox.focus = focus;

    expect(await panel.focusInbox()).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    inbox.remove();
    expect(await panel.focusInbox()).toBe(false);
  });

  it("forwards compact machine selection and keyboard cancellation", async () => {
    const onSelectMachine = vi.fn();
    const onRemoveMachine = vi.fn();
    const onCancelKeyboardNavigation = vi.fn();
    const panel = await mountPanel({ compact: true });
    panel.onSelectMachine = onSelectMachine;
    panel.onRemoveMachine = onRemoveMachine;
    panel.onCancelKeyboardNavigation = onCancelKeyboardNavigation;
    await panel.updateComplete;
    const machineList = panel.shadowRoot?.querySelector("machine-list");
    if (!(machineList instanceof MachineList)) throw new Error("Expected machine-list");
    const selected = machine("remote-a");

    machineList.onSelect?.(selected);
    await machineList.onRemove?.(selected);
    await machineList.onCancelKeyboardNavigation?.();

    expect(onSelectMachine).toHaveBeenCalledWith(selected);
    expect(onRemoveMachine).toHaveBeenCalledWith(selected);
    expect(onCancelKeyboardNavigation).toHaveBeenCalledOnce();
  });

  it("forwards docked machine callbacks", async () => {
    const onSelectMachine = vi.fn();
    const onRemoveMachine = vi.fn();
    const onCancelKeyboardNavigation = vi.fn();
    const panel = await mountPanel({ compact: false });
    panel.onSelectMachine = onSelectMachine;
    panel.onRemoveMachine = onRemoveMachine;
    panel.onCancelKeyboardNavigation = onCancelKeyboardNavigation;
    await panel.updateComplete;
    const switcher = panel.shadowRoot?.querySelector("machine-switcher");
    if (!(switcher instanceof MachineSwitcher)) throw new Error("Expected machine-switcher");
    const selected = machine("remote-a");

    await switcher.onSelect?.(selected);
    await switcher.onRemove?.(selected);
    await switcher.onCancelKeyboardNavigation?.();

    expect(onSelectMachine).toHaveBeenCalledWith(selected);
    expect(onRemoveMachine).toHaveBeenCalledWith(selected);
    expect(onCancelKeyboardNavigation).toHaveBeenCalledOnce();
  });
});

const unreadPresence: UnreadPresence = {
  machines: new Set(["remote-a"]),
  projects: new Set(["project-1"]),
  workspaces: new Set(["ws-1"]),
};

async function mountPanel(props: { compact: boolean }): Promise<AppNavigationPanel> {
  const panel = new AppNavigationPanel();
  panel.compact = props.compact;
  panel.machines = [machine("local"), machine("remote-a")];
  panel.selectedMachine = machine("local");
  panel.unreadPresence = unreadPresence;
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function machine(id: string): Machine {
  return {
    id,
    name: id,
    kind: id === "local" ? "local" : "remote",
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}
