// The triggers screen's pure decisions: where it is in the URL, what the list
// read holds, how the list groups, the entry's count, and the size plan.
// The app's main chunk imports this module, so it imports shared types only:
// a runtime import of @shared/triggers would bring its schema library along.
import type { ReactNode } from "react";
import type { Trigger, TriggerFire, TriggerListResponse } from "@shared/triggers";

/** `?triggers` is the list, `?triggers&create` the create page, `?triggers=<id>` one trigger. */
export type TriggerPlace = { view: "list" } | { view: "create" } | { view: "trigger"; id: string };

export function readTriggersPlace(params: URLSearchParams): TriggerPlace | undefined {
  const value = params.get("triggers");
  if (value === null) return undefined;
  if (params.has("create")) return { view: "create" };
  const id = value.trim();
  return id ? { view: "trigger", id } : { view: "list" };
}

/** Writes a place into a URL whose other thread places are already cleared. */
export function writeTriggersPlace(url: URL, place: TriggerPlace): void {
  url.searchParams.delete("create");
  url.searchParams.set("triggers", place.view === "trigger" ? place.id : "");
  if (place.view === "create") url.searchParams.set("create", "");
}

/** The parameters a triggers place owns. Opening another place removes them. */
export const TRIGGER_PARAMS = ["triggers", "create"] as const;

/**
 * The list read. `off` is the store being unavailable (503): no trigger runs
 * until sessiond opens it. A failed read keeps the last list it had.
 */
export type TriggerListLoad =
  | { type: "loading" }
  | { type: "ready"; value: TriggerListResponse }
  | { type: "off"; message: string; last?: TriggerListResponse | undefined }
  | { type: "failed"; message: string; last?: TriggerListResponse | undefined };

export function listOf(load: TriggerListLoad): TriggerListResponse | undefined {
  return load.type === "ready" ? load.value : load.type === "loading" ? undefined : load.last;
}

/** What the session list's footer entry shows. */
export interface TriggerEntry {
  /** The chip's words, absent when there is nothing to act on. */
  chip?: { text: string; tone: "bad" | "warn" } | undefined;
  /** The entry's accessible name and title. */
  title: string;
  /** Some trigger needs a look, or the store is off: the opener's dot lights too. */
  attention: boolean;
}

const isProblem = (fire: TriggerFire) => fire.outcome.kind === "failed" || fire.outcome.kind === "missed";

/** Failed and missed runs recorded since the trigger's attention was set, newest first. */
export function problemsSince(trigger: Trigger): TriggerFire[] {
  const since = trigger.attention?.since;
  if (since === undefined) return [];
  return trigger.history.filter((fire) => isProblem(fire) && fire.recordedAt >= since);
}

/** Bad when the newest problem failed, warn when it was missed. A trigger without attention has no tone. */
export function attentionTone(trigger: Trigger): "bad" | "warn" | undefined {
  if (trigger.attention === null) return undefined;
  const latest = problemsSince(trigger)[0];
  return latest?.outcome.kind === "missed" ? "warn" : "bad";
}

export function triggerEntry(load: TriggerListLoad): TriggerEntry {
  // No trigger runs while the store is off, so the opener's dot says so even when the session list is closed.
  if (load.type === "off") return { chip: { text: "Off", tone: "bad" }, title: "Triggers are off", attention: true };
  const list = listOf(load);
  const count = list?.attentionCount ?? 0;
  if (!list || count <= 0) return { title: "Triggers", attention: false };
  const flagged = list.triggers.filter((trigger) => trigger.attention !== null);
  const tone = flagged.length === 0 || flagged.some((trigger) => attentionTone(trigger) === "bad") ? "bad" : "warn";
  return { chip: { text: String(count), tone }, title: `Triggers: ${String(count)} ${count === 1 ? "needs" : "need"} a look`, attention: true };
}

export type TriggerGroupKey = "attention" | "active" | "paused";
export interface TriggerGroup { key: TriggerGroupKey; label: string; triggers: Trigger[] }

/**
 * Needs a look (newest attention first), Active (soonest next run first), then
 * Paused (by name). An empty group is not returned.
 */
export function groupTriggers(triggers: readonly Trigger[]): TriggerGroup[] {
  const attention = triggers.filter((trigger) => trigger.attention !== null)
    .sort((a, b) => (b.attention?.since ?? 0) - (a.attention?.since ?? 0) || a.name.localeCompare(b.name));
  const active = triggers.filter((trigger) => trigger.attention === null && trigger.state.kind === "active")
    .sort((a, b) => nextFire(a) - nextFire(b) || a.name.localeCompare(b.name));
  const paused = triggers.filter((trigger) => trigger.attention === null && trigger.state.kind === "paused")
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const groups: TriggerGroup[] = [
    { key: "attention", label: "Needs a look", triggers: attention },
    { key: "active", label: "Active", triggers: active },
    { key: "paused", label: "Paused", triggers: paused },
  ];
  return groups.filter((group) => group.triggers.length > 0);
}
const nextFire = (trigger: Trigger) => trigger.state.kind === "active" ? trigger.state.nextFireAt : Number.POSITIVE_INFINITY;

/** The filter field appears from this many triggers. */
export const FILTER_FROM = 9;

/** A filter matches the name, the project's words, or the workflow. */
export function matchesFilter(trigger: Trigger, query: string, project: string): boolean {
  const words = query.trim().toLowerCase();
  if (!words) return true;
  return [trigger.name, project, trigger.action.workflow].some((text) => text.toLowerCase().includes(words));
}

/** "23 triggers, 4 paused". */
export function totalWords(triggers: readonly Trigger[]): string {
  const paused = triggers.filter((trigger) => trigger.state.kind === "paused").length;
  const total = `${String(triggers.length)} ${triggers.length === 1 ? "trigger" : "triggers"}`;
  return paused ? `${total}, ${String(paused)} paused` : total;
}

/**
 * The layout as a function of the room. The inputs are the width of the
 * reading column, the width of the header, and the height of the scroll
 * region. Thresholds are guesses until measured in the real containers.
 */
const REM = 16;
export const ROW_WIDE = 34 * REM;
export const ROW_NARROW = 24 * REM;
export const HEADER_TIGHT = 20 * REM;
export const SHORT_BODY = 22 * REM;
export type RowTier = "wide" | "medium" | "narrow";
export interface TriggersPlan {
  row: { tier: RowTier; marks: number; stateAction: "inline" | "menu" };
  primary: "header" | "menu";
  errorLines: 2 | 4;
}
export function triggersPlan(column: number, header: number, body: number): TriggersPlan {
  const tier: RowTier = column >= ROW_WIDE ? "wide" : column >= ROW_NARROW ? "medium" : "narrow";
  return {
    row: { tier, marks: tier === "narrow" ? 5 : 7, stateAction: tier === "wide" ? "inline" : "menu" },
    primary: header >= HEADER_TIGHT ? "header" : "menu",
    errorLines: body < SHORT_BODY ? 2 : 4,
  };
}
/** Until the containers are measured, the plan assumes the roomy case. */
export const UNMEASURED = { column: 42 * REM, header: 48 * REM, body: 48 * REM };

/** Run late choices, in minutes. A value from the server that is not one of these is offered too. */
export const RUN_LATE_CHOICES = [0, 60, 360, 1440] as const;

/** What the app hands the triggers screen: where it is, how to move, and how to open a session. */
export interface TriggersScreenArgs {
  place: TriggerPlace;
  /** Moves to another triggers place, or closes the screen with `undefined`. `replace` keeps Back from returning here. */
  onPlace: (place: TriggerPlace | undefined, options?: { replace?: boolean }) => void;
  onOpenSession: (session: { id: string; cwd: string }) => void;
  /** A session's name, when the session list knows it. */
  sessionName: (id: string) => string | undefined;
}
/** The triggers screen as the app's binding provides it: the footer entry, the change signal, and the screen itself. */
export interface TriggersSlot {
  entry: TriggerEntry;
  /** Call on each `triggers.changed` from the machine socket. */
  onChanged: () => void;
  render: (args: TriggersScreenArgs) => ReactNode;
}
