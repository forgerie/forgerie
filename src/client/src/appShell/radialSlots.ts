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
 * slots. A storage-key bump may retire an assignment wholesale.
 * A panel that disappears leaves its slot **reserved and empty** rather than
 * letting the slots behind it shuffle forward. Two shipped panels are already
 * conditionally visible — Notifications only while it has a count, Agents only
 * while something is delegated — so an empty slot is a normal state, not an
 * error state.
 *
 * The wheel currently offers one bearing, dictation, and holds the other seven
 * empty. See {@link DEFAULT_RADIAL_SLOTS} for why, and for what to put back.
 */

import type { QualifiedContributionId } from "../plugins/types";

/** Eight bearings at 45 degrees each. How many carry anything is a policy. */
export const RADIAL_SLOT_COUNT = 8;

/**
 * v2 added the `dictate` and `vacant` cases, which a v1 reader cannot parse.
 *
 * The bump is also why this change needs no migration function. A v1 map is
 * never read, and it stays on disk untouched, so whoever restores the panels
 * has the previous assignment to put back rather than a set of defaults.
 */
const RADIAL_SLOT_STORAGE_KEY = "forgerie.radialSlots.v2";

/**
 * What a slot can point at.
 *
 * The inbox is not a workspace panel — it lives in the navigation panel — so
 * it cannot be addressed by a contribution id and gets its own case. Overflow
 * is a case rather than an absence because it occupies a real direction.
 *
 * `vacant` and `undefined` are both empty, and the difference between them is
 * the whole reason `vacant` exists. `undefined` means "free, seat the next
 * panel here". `vacant` means "deliberately empty, leave it that way". Without
 * the distinction, emptying the wheel would last exactly as long as it took
 * {@link reconcileRadialSlots} to run and refill every hole.
 */
export type RadialTarget =
  | { readonly kind: "navigation" }
  | { readonly kind: "tool"; readonly tool: QualifiedContributionId }
  | { readonly kind: "dictate" }
  | { readonly kind: "vacant" }
  | { readonly kind: "overflow" };

/** Slot index to target. `undefined` is a free slot the next panel may take. */
export type RadialSlotMap = readonly (RadialTarget | undefined)[];

/**
 * The shipped map: one bearing carries something, seven are held empty.
 *
 * Dictation takes west because west is the best bearing on the wheel, and not
 * by taste — `RADIAL_MENU.anchorDeg` is 180 for the stated reason that it is
 * the direction a right thumb pulls toward itself. Dictation is the only thing
 * on the wheel, so it is the only thing a hand can practise, and a bearing
 * learned over months is expensive to move later. West is claimed now, while
 * nothing else on the wheel is being learned and the move is free.
 *
 * The other seven are `vacant` rather than `undefined` so that installing a
 * plugin cannot quietly re-seat panels the wheel is not offering. Geometry is
 * untouched — still eight bearings at 45 degrees — so restoring the panels is
 * a change to this array and to a stored map, not a change to the gesture.
 *
 * What was here before, for whoever restores it: Inbox W, Files NW, Git N,
 * Terminal NE, two auto-seated slots at E and SE, Notifications S, overflow
 * SW. Inbox has to land somewhere other than west now.
 */
export const DEFAULT_RADIAL_SLOTS: RadialSlotMap = [
  { kind: "dictate" }, //  W  — the one live bearing
  { kind: "vacant" }, //   NW
  { kind: "vacant" }, //   N
  { kind: "vacant" }, //   NE
  { kind: "vacant" }, //   E
  { kind: "vacant" }, //   SE
  { kind: "vacant" }, //   S
  { kind: "vacant" }, //   SW
];

/**
 * Fold newly available panels into a stored map without moving anything.
 *
 * A tool already holding a slot keeps it, whether or not it is available right
 * now — that is what makes a reserved slot reserved. A tool with no slot takes
 * the lowest free one. When there are no free slots it is simply not on the
 * wheel, and the overflow slot is how it stays reachable.
 *
 * A `vacant` slot is not free. It is a bearing someone chose to hold empty, and
 * seating a panel there would undo that choice on the next plugin install
 * rather than on purpose.
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
    return parseRadialSlots(raw);
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
  if (record["kind"] === "dictate") return { kind: "dictate" };
  if (record["kind"] === "vacant") return { kind: "vacant" };
  if (record["kind"] !== "tool") return undefined;
  const tool = record["tool"];
  return isQualifiedContributionId(tool) ? { kind: "tool", tool } : undefined;
}

/**
 * A stored id is only usable if it still has the qualified shape. An id
 * without its plugin prefix cannot be resolved against the registry, so it is
 * dropped and its slot becomes a hole rather than an unresolvable target.
 */
function isQualifiedContributionId(value: unknown): value is QualifiedContributionId {
  return typeof value === "string" && value.includes(":");
}
