// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QualifiedContributionId } from "../plugins/types";
import { radialSlotBearing } from "./radialMenu";
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

const STORAGE_KEY = "forgerie.radialSlots.v2";

/**
 * A wheel with panels on it and two free slots.
 *
 * Reconciliation is the behaviour that returns the day panels return, so it is
 * still worth holding to its contract. It cannot be tested against the shipped
 * map any more, because the shipped map offers no free slot to seat into.
 */
const PANEL_ERA_SLOTS: RadialSlotMap = [
  { kind: "navigation" },
  { kind: "tool", tool: CORE_FILES },
  { kind: "tool", tool: CORE_GIT },
  { kind: "tool", tool: "core:workspace.terminal" },
  undefined,
  undefined,
  { kind: "tool", tool: "core:workspace.notifications" },
  { kind: "overflow" },
];

/** Slot index of the first target matching a tool id, or -1. */
function slotOf(slots: RadialSlotMap, id: QualifiedContributionId): number {
  return slots.findIndex((slot) => slot?.kind === "tool" && slot.tool === id);
}

describe("the shipped wheel", () => {
  it("offers dictation and nothing else", () => {
    expect(DEFAULT_RADIAL_SLOTS.filter((slot) => slot?.kind !== "vacant")).toEqual([{ kind: "dictate" }]);
  });

  it("puts dictation on the bearing the wheel calls west", () => {
    // The claim in DEFAULT_RADIAL_SLOTS is about a direction, not an index, so
    // it is checked against the geometry rather than restated as `toBe(0)`.
    const slot = DEFAULT_RADIAL_SLOTS.findIndex((target) => target?.kind === "dictate");
    expect(radialSlotBearing(slot, RADIAL_SLOT_COUNT)).toBe(180);
  });

  it("keeps all eight bearings, so restoring a panel never moves the gesture", () => {
    expect(DEFAULT_RADIAL_SLOTS).toHaveLength(RADIAL_SLOT_COUNT);
  });

  it("does not let an installed panel seat itself on a held bearing", () => {
    // The failure this guards: emptying the wheel would last exactly as long
    // as it took the first plugin to register a panel.
    const slots = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, UPDATES, RELAYS]);
    expect(slots).toEqual(DEFAULT_RADIAL_SLOTS);
  });
});

describe("reconcileRadialSlots", () => {
  it("gives a new panel the lowest free slot", () => {
    const slots = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES]);
    expect(slotOf(slots, PROCESSES)).toBe(4);
  });

  it("never moves a panel that already holds a slot", () => {
    const first = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES]);
    const second = reconcileRadialSlots(first, [UPDATES, PROCESSES]);
    expect(slotOf(second, PROCESSES)).toBe(slotOf(first, PROCESSES));
  });

  it("keeps a slot reserved when its panel goes away", () => {
    // Notifications and Agents are conditionally visible in the shipped app, so
    // a panel vanishing is routine. If its slot closed up, every direction
    // behind it would shift and the reader's muscle memory would be wrong.
    const assigned = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES, UPDATES]);
    const withoutProcesses = reconcileRadialSlots(assigned, [UPDATES]);
    expect(slotOf(withoutProcesses, PROCESSES)).toBe(4);
    expect(slotOf(withoutProcesses, UPDATES)).toBe(slotOf(assigned, UPDATES));
  });

  it("does not let a newly installed panel rotate the existing directions", () => {
    // The failure this whole module exists to prevent: the registry orders
    // panels by `order ?? 1000`, so a plugin arriving between two existing
    // panels would renumber everything after it if the wheel read that order.
    const before = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES, UPDATES]);
    const after = reconcileRadialSlots(before, [PROCESSES, RELAYS, UPDATES]);

    expect(slotOf(after, CORE_FILES)).toBe(slotOf(before, CORE_FILES));
    expect(slotOf(after, CORE_GIT)).toBe(slotOf(before, CORE_GIT));
    expect(slotOf(after, PROCESSES)).toBe(slotOf(before, PROCESSES));
    expect(slotOf(after, UPDATES)).toBe(slotOf(before, UPDATES));
  });

  it("leaves a panel off the wheel when every slot is taken", () => {
    const full = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES, UPDATES]);
    const crowded = reconcileRadialSlots(full, [PROCESSES, UPDATES, RELAYS]);
    expect(slotOf(crowded, RELAYS)).toBe(-1);
    expect(crowded).toHaveLength(RADIAL_SLOT_COUNT);
  });

  it("treats a held bearing as taken while still seating the free ones", () => {
    const mixed: RadialSlotMap = [{ kind: "dictate" }, { kind: "vacant" }, undefined, { kind: "vacant" }];
    const slots = reconcileRadialSlots(mixed, [PROCESSES, UPDATES]);
    expect(slotOf(slots, PROCESSES)).toBe(2);
    expect(slotOf(slots, UPDATES)).toBe(4);
    expect(slots[1]).toEqual({ kind: "vacant" });
    expect(slots[3]).toEqual({ kind: "vacant" });
  });

  it("always returns exactly the slot count", () => {
    expect(reconcileRadialSlots([], [])).toHaveLength(RADIAL_SLOT_COUNT);
    expect(reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [])).toHaveLength(RADIAL_SLOT_COUNT);
  });
});

describe("radialOverflowTools", () => {
  it("reports the panels that have no direction of their own", () => {
    const slots = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES, UPDATES]);
    expect(radialOverflowTools(slots, [PROCESSES, UPDATES, RELAYS])).toEqual([RELAYS]);
  });

  it("reports nothing when every panel is seated", () => {
    const slots = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES]);
    expect(radialOverflowTools(slots, [PROCESSES])).toEqual([]);
  });
});

describe("radialSlotsEqual", () => {
  it("reports a freshly reconciled but unchanged map as equal, so nothing is rewritten", () => {
    const once = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES]);
    const twice = reconcileRadialSlots(once, [PROCESSES]);
    expect(once).not.toBe(twice);
    expect(radialSlotsEqual(once, twice)).toBe(true);
  });

  it("notices a slot gaining a panel", () => {
    const before = reconcileRadialSlots(PANEL_ERA_SLOTS, []);
    const after = reconcileRadialSlots(before, [PROCESSES]);
    expect(radialSlotsEqual(before, after)).toBe(false);
  });

  it("tells a held bearing apart from a free one", () => {
    expect(radialSlotsEqual([{ kind: "vacant" }], [undefined])).toBe(false);
  });
});

describe("stored slots", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("round-trips a map through storage", () => {
    const slots = reconcileRadialSlots(PANEL_ERA_SLOTS, [PROCESSES, UPDATES]);
    writeStoredRadialSlots(slots);
    expect(readStoredRadialSlots()).toEqual(slots);
  });

  it("round-trips the shipped map, so a held bearing survives a reload", () => {
    writeStoredRadialSlots(DEFAULT_RADIAL_SLOTS);
    expect(readStoredRadialSlots()).toEqual(DEFAULT_RADIAL_SLOTS);
  });

  it("ignores a v1 map and leaves it on disk for whoever restores the panels", () => {
    const v1 = JSON.stringify(PANEL_ERA_SLOTS);
    window.localStorage.setItem("forgerie.radialSlots.v1", v1);

    expect(readStoredRadialSlots()).toEqual(DEFAULT_RADIAL_SLOTS);
    expect(window.localStorage.getItem("forgerie.radialSlots.v1")).toBe(v1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("falls back to the shipped map when nothing is stored", () => {
    expect(readStoredRadialSlots()).toEqual(DEFAULT_RADIAL_SLOTS);
  });

  it("falls back to the shipped map rather than an empty wheel on unreadable storage", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json");
    expect(readStoredRadialSlots()).toEqual(DEFAULT_RADIAL_SLOTS);
  });

  it("drops a stored id that lost its plugin prefix instead of keeping an unresolvable target", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ kind: "tool", tool: "workspace.files" }]));
    expect(readStoredRadialSlots()[0]).toBeUndefined();
  });

  it("drops a target whose kind it does not recognise", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([{ kind: "telepathy" }]));
    expect(readStoredRadialSlots()[0]).toBeUndefined();
  });
});
