// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { machineScopedPluginId } from "../../../shared/machinePluginIds";
import type { QualifiedContributionId } from "../plugins/types";
import {
  DEFAULT_RADIAL_SLOTS,
  RADIAL_SLOT_COUNT,
  radialOverflowTools,
  radialSlotsEqual,
  readStoredRadialSlots,
  reconcileRadialSlots,
  writeStoredRadialSlots,
  type RadialSlotMap,
} from "./radialSlots";

const CORE_FILES: QualifiedContributionId = "core:workspace.files";
const CORE_GIT: QualifiedContributionId = "core:workspace.git";
const PROCESSES: QualifiedContributionId = "processes:workspace.processes";
const RELAYS: QualifiedContributionId = "relays:workspace.relays";
const UPDATES: QualifiedContributionId = "updates:workspace.updates";
const REMOVED_TASKS: QualifiedContributionId = "workspace-tasks:workspace.tasks";
const REMOTE_REMOVED_TASKS: QualifiedContributionId = `${machineScopedPluginId("remote-1", "workspace-tasks")}:workspace.tasks`;

/** Slot index of the first target matching a tool id, or -1. */
function slotOf(slots: RadialSlotMap, id: QualifiedContributionId): number {
  return slots.findIndex((slot) => slot?.kind === "tool" && slot.tool === id);
}

describe("reconcileRadialSlots", () => {
  it("gives a new panel the lowest free slot", () => {
    const slots = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES]);
    expect(slotOf(slots, PROCESSES)).toBe(4);
  });

  it("never moves a panel that already holds a slot", () => {
    const first = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES]);
    const second = reconcileRadialSlots(first, [UPDATES, PROCESSES]);
    expect(slotOf(second, PROCESSES)).toBe(slotOf(first, PROCESSES));
  });

  it("keeps a slot reserved when its panel goes away", () => {
    // Notifications and Agents are conditionally visible in the shipped app, so
    // a panel vanishing is routine. If its slot closed up, every direction
    // behind it would shift and the reader's muscle memory would be wrong.
    const assigned = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, UPDATES]);
    const withoutProcesses = reconcileRadialSlots(assigned, [UPDATES]);
    expect(slotOf(withoutProcesses, PROCESSES)).toBe(4);
    expect(slotOf(withoutProcesses, UPDATES)).toBe(slotOf(assigned, UPDATES));
  });

  it("does not let a newly installed panel rotate the existing directions", () => {
    // The failure this whole module exists to prevent: the registry orders
    // panels by `order ?? 1000`, so a plugin arriving between two existing
    // panels would renumber everything after it if the wheel read that order.
    const before = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, UPDATES]);
    const after = reconcileRadialSlots(before, [PROCESSES, RELAYS, UPDATES]);

    expect(slotOf(after, CORE_FILES)).toBe(slotOf(before, CORE_FILES));
    expect(slotOf(after, CORE_GIT)).toBe(slotOf(before, CORE_GIT));
    expect(slotOf(after, PROCESSES)).toBe(slotOf(before, PROCESSES));
    expect(slotOf(after, UPDATES)).toBe(slotOf(before, UPDATES));
  });

  it("leaves a panel off the wheel when every slot is taken", () => {
    const full = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, UPDATES]);
    const crowded = reconcileRadialSlots(full, [PROCESSES, UPDATES, RELAYS]);
    expect(slotOf(crowded, RELAYS)).toBe(-1);
    expect(crowded).toHaveLength(RADIAL_SLOT_COUNT);
  });

  it("always returns exactly the slot count", () => {
    expect(reconcileRadialSlots([], [])).toHaveLength(RADIAL_SLOT_COUNT);
    expect(reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [])).toHaveLength(RADIAL_SLOT_COUNT);
  });
});

describe("radialOverflowTools", () => {
  it("reports the panels that have no direction of their own", () => {
    const slots = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, UPDATES]);
    expect(radialOverflowTools(slots, [PROCESSES, UPDATES, RELAYS])).toEqual([RELAYS]);
  });

  it("reports nothing when every panel is seated", () => {
    const slots = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES]);
    expect(radialOverflowTools(slots, [PROCESSES])).toEqual([]);
  });
});

describe("radialSlotsEqual", () => {
  it("reports a freshly reconciled but unchanged map as equal, so nothing is rewritten", () => {
    const once = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES]);
    const twice = reconcileRadialSlots(once, [PROCESSES]);
    expect(once).not.toBe(twice);
    expect(radialSlotsEqual(once, twice)).toBe(true);
  });

  it("notices a slot gaining a panel", () => {
    const before = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, []);
    const after = reconcileRadialSlots(before, [PROCESSES]);
    expect(radialSlotsEqual(before, after)).toBe(false);
  });
});

describe("stored slots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("round-trips a map through storage", () => {
    const slots = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, UPDATES]);
    writeStoredRadialSlots(slots);
    expect(readStoredRadialSlots()).toEqual(slots);
  });

  it("removes every local and machine-scoped Workspace Tasks target without moving other slots", () => {
    const stored: RadialSlotMap = [
      { kind: "navigation" },
      { kind: "tool", tool: REMOVED_TASKS },
      { kind: "tool", tool: CORE_GIT },
      { kind: "tool", tool: REMOTE_REMOVED_TASKS },
      { kind: "tool", tool: PROCESSES },
      { kind: "tool", tool: REMOVED_TASKS },
      { kind: "tool", tool: UPDATES },
      { kind: "overflow" },
    ];
    window.localStorage.setItem("forgerie.radialSlots.v1", JSON.stringify(stored));
    const setItem = vi.spyOn(window.localStorage, "setItem");

    const migrated = readStoredRadialSlots();

    expect(migrated).toEqual([
      { kind: "navigation" },
      undefined,
      { kind: "tool", tool: CORE_GIT },
      undefined,
      { kind: "tool", tool: PROCESSES },
      undefined,
      { kind: "tool", tool: UPDATES },
      { kind: "overflow" },
    ]);
    expect(window.localStorage.getItem("forgerie.radialSlots.v1")).toBe(JSON.stringify(migrated));
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(readStoredRadialSlots()).toEqual(migrated);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("keeps near-matching local and machine-scoped targets", () => {
    const stored: RadialSlotMap = [
      { kind: "tool", tool: "workspace-tasks:workspace.other" },
      { kind: "tool", tool: "other:workspace.tasks" },
      { kind: "tool", tool: `${machineScopedPluginId("remote-1", "other")}:workspace.tasks` },
    ];
    window.localStorage.setItem("forgerie.radialSlots.v1", JSON.stringify(stored));
    const setItem = vi.spyOn(window.localStorage, "setItem");

    expect(readStoredRadialSlots().slice(0, 3)).toEqual(stored);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("returns the migrated map when the storage rewrite is blocked", () => {
    const stored: RadialSlotMap = [
      { kind: "tool", tool: REMOVED_TASKS },
      { kind: "tool", tool: PROCESSES },
    ];
    window.localStorage.setItem("forgerie.radialSlots.v1", JSON.stringify(stored));
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    try {
      expect(readStoredRadialSlots().slice(0, 2)).toEqual([
        undefined,
        { kind: "tool", tool: PROCESSES },
      ]);
    } finally {
      setItem.mockRestore();
    }
  });

  it("lets reconciliation assign the reclaimed slot without moving surviving targets", () => {
    const stored: RadialSlotMap = [
      { kind: "navigation" },
      { kind: "tool", tool: CORE_FILES },
      { kind: "tool", tool: CORE_GIT },
      { kind: "tool", tool: REMOVED_TASKS },
      { kind: "tool", tool: PROCESSES },
      { kind: "tool", tool: UPDATES },
      { kind: "tool", tool: "core:workspace.notifications" },
      { kind: "overflow" },
    ];
    window.localStorage.setItem("forgerie.radialSlots.v1", JSON.stringify(stored));

    const reconciled = reconcileRadialSlots(readStoredRadialSlots(), [PROCESSES, UPDATES, RELAYS]);

    expect(slotOf(reconciled, RELAYS)).toBe(3);
    expect(slotOf(reconciled, PROCESSES)).toBe(4);
    expect(slotOf(reconciled, UPDATES)).toBe(5);
  });

  it("does not rewrite a stored map with no Workspace Tasks target", () => {
    const stored = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, UPDATES]);
    window.localStorage.setItem("forgerie.radialSlots.v1", JSON.stringify(stored));
    const setItem = vi.spyOn(window.localStorage, "setItem");

    expect(readStoredRadialSlots()).toEqual(stored);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("falls back to the shipped map when nothing is stored", () => {
    expect(readStoredRadialSlots()).toEqual(DEFAULT_RADIAL_SLOTS);
  });

  it("falls back to the shipped map rather than an empty wheel on unreadable storage", () => {
    window.localStorage.setItem("forgerie.radialSlots.v1", "not json");
    expect(readStoredRadialSlots()).toEqual(DEFAULT_RADIAL_SLOTS);
  });

  it("drops a stored id that lost its plugin prefix instead of keeping an unresolvable target", () => {
    window.localStorage.setItem(
      "forgerie.radialSlots.v1",
      JSON.stringify([{ kind: "tool", tool: "workspace.files" }]),
    );
    expect(readStoredRadialSlots()[0]).toBeUndefined();
  });
});
