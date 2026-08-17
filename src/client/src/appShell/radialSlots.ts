/**
 * Which panel lives at which direction on the radial menu.
 *
 * The map is **stored, never derived**. That is the whole point of this file.
 *
 * `PluginRegistry.workspacePanelContributions` orders panels by `order ?? 1000`
 * and then by title, so the visible list changes shape whenever a plugin is
 * installed, removed, or renamed. A wheel that read that list directly would
 * silently re-teach every direction on install: a panel arriving at `order: 15`
 * would insert between Files (10) and Git (20) and rotate everything after it.
 *
 * So the wheel keeps its own assignment and normally only grows into free
 * slots. A one-way migration may reclaim a permanently removed target.
 * A panel that disappears leaves its slot **reserved and empty** rather than
 * letting the slots behind it shuffle forward. Two shipped panels are already
 * conditionally visible — Notifications only while it has a count, Agents only
 * while something is delegated — so an empty slot is a normal state, not an
 * error state.
 */

import { parseMachineScopedPluginId } from "../../../shared/machinePluginIds";
import type { QualifiedContributionId } from "../plugins/types";

/** Eight slots: seven panels and an overflow, at 45 degrees each. */
export const RADIAL_SLOT_COUNT = 8;

const RADIAL_SLOT_STORAGE_KEY = "forgerie.radialSlots.v1";

/**
 * What a slot can point at.
 *
 * The inbox is not a workspace panel — it lives in the navigation panel — so
 * it cannot be addressed by a contribution id and gets its own case. Overflow
 * is a case rather than an absence because it occupies a real direction.
 */
export type RadialTarget =
  | { readonly kind: "navigation" }
  | { readonly kind: "tool"; readonly tool: QualifiedContributionId }
  | { readonly kind: "overflow" };

/** Slot index to target. A hole is a reserved slot with nothing in it. */
export type RadialSlotMap = readonly (RadialTarget | undefined)[];

/**
 * The shipped map.
 *
 * Order follows the panels' own `order` values rather than taste: Files 10,
 * Git 20, Terminal 30, Notifications 40, Processes and Relays 50, Agents 60,
 * Updates 100, Info 1000. Agents sits behind overflow because
 * `plugins/core/panels.ts` describes it as the least-reached-for tool.
 *
 * Most-used sits in the upper half deliberately. The lower wedges point toward
 * the palm, and they are also the half that clips when the thumb is near the
 * bottom corner, so the least-used items absorb both costs.
 *
 * Only core ids are named here. Bundled plugins take their id from their
 * registration, not from their source, so hard-coding `processes:...` would be
 * a guess that fails silently if the id ever differs. Slots 4 and 5 are left
 * open instead: {@link reconcileRadialSlots} fills them from whatever is
 * actually installed on first run, and the result is written to storage. The
 * assignment is derived exactly once and frozen from then on.
 */
export const DEFAULT_RADIAL_SLOTS: RadialSlotMap = [
  { kind: "navigation" }, //                            W  — Inbox
  { kind: "tool", tool: "core:workspace.files" }, //     NW
  { kind: "tool", tool: "core:workspace.git" }, //       N
  { kind: "tool", tool: "core:workspace.terminal" }, //  NE
  undefined, //                                          E  — first unassigned panel
  undefined, //                                          SE — second unassigned panel
  { kind: "tool", tool: "core:workspace.notifications" }, // S — often empty
  { kind: "overflow" }, //                               SW — everything else
];

/**
 * Fold newly available panels into a stored map without moving anything.
 *
 * A tool already holding a slot keeps it, whether or not it is available right
 * now — that is what makes a reserved slot reserved. A tool with no slot takes
 * the lowest free one. When there are no free slots it is simply not on the
 * wheel, and the overflow slot is how it stays reachable.
 */
export function reconcileRadialSlots(
  stored: RadialSlotMap,
  available: readonly QualifiedContributionId[],
): RadialSlotMap {
  const slots: (RadialTarget | undefined)[] = [];
  for (let index = 0; index < RADIAL_SLOT_COUNT; index += 1) slots.push(stored[index]);

  const assigned = new Set<string>();
  for (const slot of slots) {
    if (slot?.kind === "tool") assigned.add(slot.tool);
  }

  for (const tool of available) {
    if (assigned.has(tool)) continue;
    const free = slots.findIndex((slot) => slot === undefined);
    if (free === -1) break;
    slots[free] = { kind: "tool", tool };
    assigned.add(tool);
  }

  return slots;
}

/** Tools that have no slot, and so belong behind the overflow wedge. */
export function radialOverflowTools(
  slots: RadialSlotMap,
  available: readonly QualifiedContributionId[],
): readonly QualifiedContributionId[] {
  const assigned = new Set<string>();
  for (const slot of slots) {
    if (slot?.kind === "tool") assigned.add(slot.tool);
  }
  return available.filter((tool) => !assigned.has(tool));
}

/**
 * Whether two maps assign the same directions.
 *
 * The shell reconciles on render and must only write storage when something
 * actually moved. Writing every frame would be wasteful, and comparing by
 * reference would write every frame, because reconcile always returns a new
 * array.
 */
export function radialSlotsEqual(left: RadialSlotMap, right: RadialSlotMap): boolean {
  for (let index = 0; index < RADIAL_SLOT_COUNT; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) {
      if (a !== b) return false;
      continue;
    }
    if (a.kind !== b.kind) return false;
    if (a.kind === "tool" && b.kind === "tool" && a.tool !== b.tool) return false;
  }
  return true;
}

export function readStoredRadialSlots(): RadialSlotMap {
  try {
    const raw = window.localStorage.getItem(RADIAL_SLOT_STORAGE_KEY);
    if (raw === null) return DEFAULT_RADIAL_SLOTS;
    const stored = parseRadialSlots(raw);
    const migrated = removeWorkspaceTasksTargets(stored);
    if (!radialSlotsEqual(stored, migrated)) writeStoredRadialSlots(migrated);
    return migrated;
  } catch {
    return DEFAULT_RADIAL_SLOTS;
  }
}

export function writeStoredRadialSlots(slots: RadialSlotMap): void {
  try {
    window.localStorage.setItem(RADIAL_SLOT_STORAGE_KEY, JSON.stringify(slots));
  } catch {
    // Ignore storage failures; the map still holds for this tab.
  }
}

/**
 * Unreadable storage falls back to the shipped map rather than to an empty
 * wheel. A reader who has learned the directions would rather see the defaults
 * than nothing, and the defaults are what they most likely learned.
 */
function parseRadialSlots(raw: string): RadialSlotMap {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_RADIAL_SLOTS;
    const slots: (RadialTarget | undefined)[] = [];
    for (let index = 0; index < RADIAL_SLOT_COUNT; index += 1) slots.push(parseTarget(parsed[index]));
    return slots;
  } catch {
    return DEFAULT_RADIAL_SLOTS;
  }
}

function parseTarget(value: unknown): RadialTarget | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record: Record<string, unknown> = { ...value };
  if (record["kind"] === "navigation") return { kind: "navigation" };
  if (record["kind"] === "overflow") return { kind: "overflow" };
  if (record["kind"] !== "tool") return undefined;
  const tool = record["tool"];
  return isQualifiedContributionId(tool) ? { kind: "tool", tool } : undefined;
}

function removeWorkspaceTasksTargets(slots: RadialSlotMap): RadialSlotMap {
  return slots.map((slot) => isWorkspaceTasksTarget(slot) ? undefined : slot);
}

function isWorkspaceTasksTarget(target: RadialTarget | undefined): boolean {
  if (target?.kind !== "tool") return false;
  const separator = target.tool.indexOf(":");
  const pluginId = target.tool.slice(0, separator);
  const localId = target.tool.slice(separator + 1);
  if (localId !== "workspace.tasks") return false;
  if (pluginId === "workspace-tasks") return true;
  return parseMachineScopedPluginId(pluginId)?.pluginId === "workspace-tasks";
}

/**
 * A stored id is only usable if it still has the qualified shape. An id
 * without its plugin prefix cannot be resolved against the registry, so it is
 * dropped and its slot becomes a hole rather than an unresolvable target.
 */
function isQualifiedContributionId(value: unknown): value is QualifiedContributionId {
  return typeof value === "string" && value.includes(":");
}
