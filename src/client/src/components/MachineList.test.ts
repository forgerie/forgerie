// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Machine, MachineHealth, MachineStatus, WorkspaceActivity } from "../api";
import { canRemoveMachine, MachineList } from "./MachineList";

afterEach(() => {
  document.body.replaceChildren();
});

describe("canRemoveMachine", () => {
  it("only allows remote machines to be removed from the machine list", () => {
    expect(canRemoveMachine(machine("local", "local"))).toBe(false);
    expect(canRemoveMachine(machine("remote-a", "remote"))).toBe(true);
  });
});

describe("machine list behavior", () => {
  it("selects rows and removes remote machines from the actions menu", async () => {
    const local = machine("local", "local");
    const remote = machine("remote-a", "remote");
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const list = await mountMachineList([local, remote], new Set());
    list.onSelect = onSelect;
    list.onRemove = onRemove;
    await list.updateComplete;

    rowFor(list, "local").dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(onSelect).toHaveBeenCalledWith(local);

    const toggle = rowFor(list, "remote-a").querySelector<HTMLButtonElement>(".action-menu-toggle");
    toggle?.click();
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".machine-menu-panel")).not.toBeNull();
    list.shadowRoot?.querySelector<HTMLButtonElement>(".machine-menu-panel .danger")?.click();
    await list.updateComplete;

    expect(onRemove).toHaveBeenCalledWith(remote);
    expect(list.shadowRoot?.querySelector(".machine-menu-panel")).toBeNull();
  });

  it("renders collapsible summaries and toggles the section", async () => {
    const onToggleCollapsed = vi.fn();
    const local = machine("local", "local");
    const list = await mountMachineList([local], new Set());
    list.collapsible = true;
    list.collapsed = true;
    list.selected = local;
    list.onToggleCollapsed = onToggleCollapsed;
    await list.updateComplete;

    expect(list.shadowRoot?.textContent).toContain("local");
    expect(list.shadowRoot?.querySelector(".list-body")).toBeNull();
    list.shadowRoot?.querySelector<HTMLButtonElement>(".section-toggle")?.click();
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it("routes keyboard selection, section movement, cancellation, and menu escape", async () => {
    const remote = machine("remote-a", "remote");
    const onSelect = vi.fn();
    const onFocusNextSection = vi.fn();
    const onCancelKeyboardNavigation = vi.fn();
    const list = await mountMachineList([remote], new Set());
    list.onSelect = onSelect;
    list.onRemove = vi.fn();
    list.onFocusNextSection = onFocusNextSection;
    list.onCancelKeyboardNavigation = onCancelKeyboardNavigation;
    await list.updateComplete;
    const row = rowFor(list, "remote-a");

    row.dispatchEvent(key("Enter"));
    row.dispatchEvent(key("ArrowRight"));
    row.dispatchEvent(key("Escape"));
    expect(onSelect).toHaveBeenCalledWith(remote);
    expect(onFocusNextSection).toHaveBeenCalledOnce();
    expect(onCancelKeyboardNavigation).toHaveBeenCalledOnce();

    row.querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
    await list.updateComplete;
    row.dispatchEvent(key("Escape"));
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".machine-menu-panel")).toBeNull();
    expect(onCancelKeyboardNavigation).toHaveBeenCalledOnce();
  });

  it("focuses the selected row and clears stale menus", async () => {
    const local = machine("local", "local");
    const remote = machine("remote-a", "remote");
    const list = await mountMachineList([local, remote], new Set());
    list.selected = remote;
    list.onRemove = vi.fn();
    await list.updateComplete;
    const selected = rowFor(list, "remote-a");
    const focus = vi.fn();
    selected.focus = focus;
    selected.scrollIntoView = vi.fn();

    expect(await list.focusSelectedOrFirst()).toBe(true);
    expect(focus).toHaveBeenCalledOnce();

    selected.querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
    await list.updateComplete;
    list.machines = [local];
    await list.updateComplete;
    expect(list.shadowRoot?.querySelector(".machine-menu-panel")).toBeNull();
  });
});

describe("machine unread indicator", () => {
  it("shows an unread dot only on machines tracked as unread, including offline ones", async () => {
    const list = await mountMachineList(
      [machine("local", "local"), machine("remote-a", "remote"), machine("remote-b", "remote")],
      new Set(["remote-a", "remote-b"]),
      { "remote-b": machineHealth("remote-b", "offline") },
    );

    expect(unreadDot(rowFor(list, "local"))).toBeNull();
    const remoteDot = unreadDot(rowFor(list, "remote-a"));
    expect(remoteDot).not.toBeNull();
    expect(remoteDot?.getAttribute("title")).toBe("Unread sessions on this machine");
    // Stale-but-present counts: an offline machine keeps its last-known unread state.
    expect(unreadDot(rowFor(list, "remote-b"))).not.toBeNull();
  });

  it("clears the dot once the machine is no longer tracked as unread", async () => {
    const list = await mountMachineList([machine("local", "local")], new Set(["local"]));
    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).not.toBeNull();

    list.unreadMachineIds = new Set();
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("wraps the work dot in an unread ring when a machine is busy and unread", async () => {
    const list = await mountMachineList(
      [machine("local", "local"), machine("remote-a", "remote")],
      new Set(["local", "remote-a"]),
      {},
      {
        local: { "/repo": workspaceActivity("/repo", true, false) },
        "remote-a": { "/repo": workspaceActivity("/repo", false, true) },
      },
    );

    const localRing = rowFor(list, "local").querySelector(".unread-ring");
    expect(localRing?.querySelector(".activity-indicator.session")).not.toBeNull();
    expect(localRing?.getAttribute("title")).toBe("Unread sessions on this machine · Machine active");

    const remoteRing = rowFor(list, "remote-a").querySelector(".unread-ring");
    expect(remoteRing?.querySelector(".activity-indicator.terminal")).not.toBeNull();
    expect(remoteRing?.getAttribute("title")).toBe("Unread sessions on this machine · Machine terminal active");

    // One mark per row: the ring replaces the standalone unread dot.
    expect(rowFor(list, "local").querySelector(".activity-indicator.unread")).toBeNull();
  });
});

async function mountMachineList(
  machines: Machine[],
  unreadMachineIds: ReadonlySet<string>,
  statuses: Record<string, MachineHealth> = {},
  activities: Record<string, Record<string, WorkspaceActivity>> = {},
): Promise<MachineList> {
  const list = new MachineList();
  list.machines = machines;
  list.unreadMachineIds = unreadMachineIds;
  list.statuses = statuses;
  list.activities = activities;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function rowFor(list: MachineList, machineName: string): HTMLElement {
  const rows = [...(list.shadowRoot?.querySelectorAll(".machine-row") ?? [])];
  const row = rows.find((candidate) => candidate.textContent.includes(machineName));
  if (!(row instanceof HTMLElement)) throw new Error(`Expected a machine row for ${machineName}`);
  return row;
}

function unreadDot(row: Element): Element | null {
  return row.querySelector(".activity-indicator.unread");
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
  return { machineId, ok: status === "online", checkedAt: "2026-06-04T00:00:00.000Z", status };
}
