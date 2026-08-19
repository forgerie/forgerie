// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, MachineHealth, MachineStatus, WorkspaceActivity } from "../api";
import { MachineSwitcher } from "./MachineSwitcher";

afterEach(() => {
  document.body.replaceChildren();
});

describe("machine-switcher behavior", () => {
  it("renders nothing without machines and otherwise prefers the local machine", async () => {
    const switcher = new MachineSwitcher();
    document.body.append(switcher);
    await switcher.updateComplete;
    expect(switcher.shadowRoot?.querySelector("button")).toBeNull();
    expect(await switcher.focusSelectedOrFirst()).toBe(false);

    switcher.machines = [machine("remote-a", "remote"), machine("local", "local")];
    await switcher.updateComplete;
    expect(switcherButton(switcher).textContent).toContain("local");
  });

  it("opens the menu and selects a machine", async () => {
    const local = machine("local", "local");
    const remote = { ...machine("remote-a", "remote"), baseUrl: "https://remote.example" };
    const onSelect = vi.fn();
    const switcher = await mountSwitcher([local, remote], new Set());
    switcher.onSelect = onSelect;
    switcher.statuses = { local: machineHealth("local", "online"), "remote-a": machineHealth("remote-a", "offline") };
    await switcher.updateComplete;

    switcherButton(switcher).click();
    await switcher.updateComplete;
    expect(switcher.shadowRoot?.querySelectorAll(".machine-option")).toHaveLength(2);
    expect(optionFor(switcher, "remote-a").textContent).toContain("offline");
    expect(optionFor(switcher, "remote-a").querySelector("button")?.getAttribute("title")).toBe("https://remote.example");

    optionMain(switcher, "remote-a").click();
    await switcher.updateComplete;
    expect(onSelect).toHaveBeenCalledWith(remote);
    expect(switcher.shadowRoot?.querySelector(".machine-switcher-menu")).toBeNull();
  });

  it("opens remote machine actions and removes the machine", async () => {
    const local = machine("local", "local");
    const remote = machine("remote-a", "remote");
    const onRemove = vi.fn();
    const switcher = await mountSwitcher([local, remote], new Set());
    switcher.onRemove = onRemove;
    await switcher.updateComplete;

    switcherButton(switcher).click();
    await switcher.updateComplete;
    const actions = optionFor(switcher, "remote-a").querySelector<HTMLButtonElement>(".machine-option-actions-toggle");
    if (actions === null) throw new Error("Expected remote machine actions");
    actions.click();
    await switcher.updateComplete;
    actions.click();
    await switcher.updateComplete;
    expect(switcher.shadowRoot?.querySelector(".machine-option-actions-panel")).toBeNull();
    actions.click();
    await switcher.updateComplete;

    const remove = switcher.shadowRoot?.querySelector<HTMLButtonElement>(".machine-option-actions-panel .danger");
    remove?.click();
    await switcher.updateComplete;

    expect(onRemove).toHaveBeenCalledWith(remote);
    expect(switcher.shadowRoot?.querySelector(".machine-switcher-menu")).toBeNull();
  });

  it("closes open menus on outside clicks and removed machines", async () => {
    const machines = [machine("local", "local"), machine("remote-a", "remote")];
    const switcher = await mountSwitcher(machines, new Set());
    switcher.onRemove = vi.fn();
    await switcher.updateComplete;

    switcherButton(switcher).click();
    await switcher.updateComplete;
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    await switcher.updateComplete;
    expect(switcher.shadowRoot?.querySelector(".machine-switcher-menu")).toBeNull();

    switcherButton(switcher).click();
    await switcher.updateComplete;
    optionFor(switcher, "remote-a").querySelector<HTMLButtonElement>(".machine-option-actions-toggle")?.click();
    await switcher.updateComplete;
    const local = machines[0];
    if (local === undefined) throw new Error("Expected local machine");
    switcher.machines = [local];
    await switcher.updateComplete;
    expect(switcher.shadowRoot?.querySelector(".machine-option-actions-panel")).toBeNull();
  });

  it("routes switcher and option keyboard navigation", async () => {
    const onFocusNextSection = vi.fn();
    const onCancelKeyboardNavigation = vi.fn();
    const switcher = await mountSwitcher([machine("local", "local"), machine("remote-a", "remote")], new Set());
    switcher.onFocusNextSection = onFocusNextSection;
    switcher.onCancelKeyboardNavigation = onCancelKeyboardNavigation;
    const button = switcherButton(switcher);

    button.dispatchEvent(key("ArrowRight"));
    button.dispatchEvent(key("Escape"));
    expect(onFocusNextSection).toHaveBeenCalledOnce();
    expect(onCancelKeyboardNavigation).toHaveBeenCalledOnce();

    button.dispatchEvent(key("ArrowDown"));
    await switcher.updateComplete;
    const options = Array.from(switcher.shadowRoot?.querySelectorAll<HTMLElement>(".machine-option-main") ?? []);
    const first = options[0];
    const second = options[1];
    if (first === undefined || second === undefined) throw new Error("Expected two machine options");
    const firstFocus = vi.fn();
    const secondFocus = vi.fn();
    first.focus = firstFocus;
    first.scrollIntoView = vi.fn();
    second.focus = secondFocus;
    second.scrollIntoView = vi.fn();

    first.dispatchEvent(key("End"));
    expect(secondFocus).toHaveBeenCalledOnce();
    second.dispatchEvent(key("Home"));
    expect(firstFocus).toHaveBeenCalledOnce();
    first.dispatchEvent(key("ArrowRight"));
    await switcher.updateComplete;
    expect(onFocusNextSection).toHaveBeenCalledTimes(2);
    expect(switcher.shadowRoot?.querySelector(".machine-switcher-menu")).toBeNull();
  });

  it("positions the menu within the viewport", async () => {
    const switcher = await mountSwitcher([machine("local", "local"), machine("remote-a", "remote")], new Set());
    const button = switcherButton(switcher);
    button.getBoundingClientRect = () => ({ x: 900, y: 10, left: 900, top: 10, right: 1000, bottom: 40, width: 100, height: 30, toJSON: () => ({}) });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });

    button.click();
    await switcher.updateComplete;

    const style = switcher.shadowRoot?.querySelector(".machine-switcher-menu")?.getAttribute("style") ?? "";
    expect(style).toContain("top: 40px");
    expect(style).toContain("left: 712px");
    expect(style).toContain("width: 280px");
    expect(style).toContain("max-height: 452px");
  });
});

describe("machine-switcher unread indicator", () => {
  it("shows an unread dot on the switcher button while the selected machine has unread sessions", async () => {
    const switcher = await mountSwitcher([machine("local", "local")], new Set(["local"]));
    const button = switcherButton(switcher);
    const dot = button.querySelector(".activity-indicator.unread");
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("title")).toBe("Unread sessions on this machine");

    switcher.unreadMachineIds = new Set();
    await switcher.updateComplete;

    expect(switcherButton(switcher).querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("marks only the unread machines among the dropdown options", async () => {
    const switcher = await mountSwitcher(
      [machine("local", "local"), machine("remote-a", "remote"), machine("remote-b", "remote")],
      new Set(["remote-b"]),
    );

    switcherButton(switcher).click();
    await switcher.updateComplete;

    expect(unreadDot(optionFor(switcher, "local"))).toBeNull();
    expect(unreadDot(optionFor(switcher, "remote-a"))).toBeNull();
    expect(unreadDot(optionFor(switcher, "remote-b"))).not.toBeNull();
  });

  it("wraps the work dot in an unread ring when the machine is busy and unread", async () => {
    const switcher = await mountSwitcher([machine("local", "local")], new Set(["local"]));
    switcher.activities = { local: { "/repo": workspaceActivity("/repo", true, false) } };
    await switcher.updateComplete;

    const button = switcherButton(switcher);
    const ring = button.querySelector(".unread-ring");
    expect(ring?.querySelector(".activity-indicator.session")).not.toBeNull();
    expect(ring?.getAttribute("title")).toBe("Unread sessions on this machine · Machine active");
    // One mark only: the ring replaces the standalone unread dot.
    expect(button.querySelector(".activity-indicator.unread")).toBeNull();
  });
});

async function mountSwitcher(machines: Machine[], unreadMachineIds: ReadonlySet<string>): Promise<MachineSwitcher> {
  const switcher = new MachineSwitcher();
  switcher.machines = machines;
  const selected = machines[0];
  if (selected === undefined) throw new Error("Expected at least one machine");
  switcher.selected = selected;
  switcher.unreadMachineIds = unreadMachineIds;
  document.body.append(switcher);
  await switcher.updateComplete;
  return switcher;
}

function switcherButton(switcher: MachineSwitcher): HTMLElement {
  const button = switcher.shadowRoot?.querySelector(".machine-switcher-button");
  if (!(button instanceof HTMLElement)) throw new Error("Expected the machine switcher button");
  return button;
}

function optionFor(switcher: MachineSwitcher, machineName: string): Element {
  const options = [...(switcher.shadowRoot?.querySelectorAll(".machine-option") ?? [])];
  const option = options.find((candidate) => candidate.textContent.includes(machineName));
  if (option === undefined) throw new Error(`Expected a machine option for ${machineName}`);
  return option;
}

function unreadDot(option: Element): Element | null {
  return option.querySelector(".activity-indicator.unread");
}

function optionMain(switcher: MachineSwitcher, machineName: string): HTMLButtonElement {
  const button = optionFor(switcher, machineName).querySelector<HTMLButtonElement>(".machine-option-main");
  if (button === null) throw new Error(`Expected a machine option button for ${machineName}`);
  return button;
}

function key(value: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, composed: true });
}

function workspaceActivity(cwd: string, hasSessionActivity: boolean, hasTerminalActivity: boolean): WorkspaceActivity {
  return { cwd, hasSessionActivity, hasTerminalActivity, updatedAt: "2026-06-04T00:00:00.000Z" };
}

function machine(id: string, kind: Machine["kind"]): Machine {
  return {
    id,
    name: id,
    kind,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
  };
}

function machineHealth(machineId: string, status: MachineStatus): MachineHealth {
  return { machineId, ok: status === "online", checkedAt: "now", status };
}
