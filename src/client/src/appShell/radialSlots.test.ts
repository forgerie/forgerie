// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
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
const TASKS: QualifiedContributionId = "workspace-tasks:workspace.tasks";
const RELAYS: QualifiedContributionId = "relays:workspace.relays";

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
    const second = reconcileRadialSlots(first, [TASKS, PROCESSES]);
    expect(slotOf(second, PROCESSES)).toBe(slotOf(first, PROCESSES));
  });

  it("keeps a slot reserved when its panel goes away", () => {
    // Notifications and Agents are conditionally visible in the shipped app, so
    // a panel vanishing is routine. If its slot closed up, every direction
    // behind it would shift and the reader's muscle memory would be wrong.
    const assigned = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, TASKS]);
    const withoutProcesses = reconcileRadialSlots(assigned, [TASKS]);
    expect(slotOf(withoutProcesses, PROCESSES)).toBe(4);
    expect(slotOf(withoutProcesses, TASKS)).toBe(slotOf(assigned, TASKS));
  });

  it("does not let a newly installed panel rotate the existing directions", () => {
    // The failure this whole module exists to prevent: the registry orders
    // panels by `order ?? 1000`, so a plugin arriving between two existing
    // panels would renumber everything after it if the wheel read that order.
    const before = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, TASKS]);
    const after = reconcileRadialSlots(before, [PROCESSES, RELAYS, TASKS]);

    expect(slotOf(after, CORE_FILES)).toBe(slotOf(before, CORE_FILES));
    expect(slotOf(after, CORE_GIT)).toBe(slotOf(before, CORE_GIT));
    expect(slotOf(after, PROCESSES)).toBe(slotOf(before, PROCESSES));
    expect(slotOf(after, TASKS)).toBe(slotOf(before, TASKS));
  });

  it("leaves a panel off the wheel when every slot is taken", () => {
    const full = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, TASKS]);
    const crowded = reconcileRadialSlots(full, [PROCESSES, TASKS, RELAYS]);
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
    const slots = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, TASKS]);
    expect(radialOverflowTools(slots, [PROCESSES, TASKS, RELAYS])).toEqual([RELAYS]);
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
    window.localStorage.clear();
  });

  it("round-trips a map through storage", () => {
    const slots = reconcileRadialSlots(DEFAULT_RADIAL_SLOTS, [PROCESSES, TASKS]);
    writeStoredRadialSlots(slots);
    expect(readStoredRadialSlots()).toEqual(slots);
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
