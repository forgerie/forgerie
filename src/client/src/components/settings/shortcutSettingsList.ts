import type { AppAction } from "../../actions";
import type { PiWebShortcutConfig } from "../../api";
import { formatShortcut, normalizeShortcut, parseShortcutInput, resolveShortcutBindings } from "../../keyboardShortcuts";

/**
 * The keyboard-settings list as data.
 *
 * The settings panel renders 42 actions. Recomputing binding state, conflict
 * state, draft state, and display text inline at every call site is what made
 * the old row 226 px tall: each row carried its whole editor because nothing
 * else knew which row was being edited. This module owns that knowledge, so the
 * panel composes named states instead of rebuilding them.
 *
 * Two axes, both tagged unions, both single-valued:
 *   - `ShortcutBindingState`  what the binding *is*
 *   - `ShortcutConflictState` whether it actually fires
 *
 * Interaction is a third tagged union, `ShortcutEditor`, holding at most one
 * open row. That is not a new constraint: the panel has always permitted only
 * one draft at a time.
 */

/** Groups in the order a user reaches for them. Anything unlisted sorts after, alphabetically. */
const GROUP_ORDER: readonly string[] = [
  "General",
  "Navigation",
  "Session",
  "Sessions",
  "Workspace",
  "Project",
  "Machine",
  "View",
  "Preferences",
  "Updates",
  "Info",
];

export type ShortcutBindingState =
  | { readonly kind: "default"; readonly shortcut: string }
  | { readonly kind: "custom"; readonly shortcut: string }
  | { readonly kind: "disabled" }
  | { readonly kind: "unassigned" };

export type ShortcutConflictState =
  | { readonly kind: "clear" }
  | { readonly kind: "shadows"; readonly victims: readonly string[] }
  | { readonly kind: "shadowed"; readonly winner: string }
  | { readonly kind: "conflict"; readonly peers: readonly string[] }
  | { readonly kind: "partial-conflict"; readonly peers: readonly string[] }
  | { readonly kind: "partial-shadowed"; readonly winners: readonly string[] };

/**
 * At most one row is open at a time, in exactly one mode.
 *
 * `typing` exists because `recording` cannot work without a hardware keyboard:
 * `isShortcutSequenceStarter` requires `ctrl` or `alt` in the first chord, and
 * on-screen keyboards emit neither. Removing the text field entirely would make
 * this screen read-only on a touch device.
 */
export type ShortcutEditor =
  | { readonly kind: "closed" }
  | { readonly kind: "menu"; readonly actionId: string }
  | { readonly kind: "recording"; readonly actionId: string; readonly tokens: readonly string[] }
  | { readonly kind: "typing"; readonly actionId: string; readonly draft: string };

export interface ShortcutListRow {
  readonly action: AppAction;
  /** Binding including any unsaved edit in progress. */
  readonly state: ShortcutBindingState;
  /** Binding as stored on disk, ignoring the editor. */
  readonly saved: ShortcutBindingState;
  readonly conflict: ShortcutConflictState;
  /** `state`, rendered the way a keyboard shows it. Empty when unbound. */
  readonly display: string;
  /** True when the editor holds a change that has not been saved. */
  readonly dirty: boolean;
  /** True when the config file carries an entry for this action, including `null`. */
  readonly overridden: boolean;
}

export interface ShortcutListGroup {
  readonly name: string;
  readonly rows: readonly ShortcutListRow[];
}

export interface ShortcutList {
  readonly groups: readonly ShortcutListGroup[];
  /** Actions registered, before filtering. */
  readonly total: number;
  /** Actions surviving the filter. */
  readonly shown: number;
  /** Actions with an entry in the config file. */
  readonly customCount: number;
}

export interface ShortcutListInput {
  readonly actions: readonly AppAction[];
  readonly shortcuts: PiWebShortcutConfig;
  readonly filter?: string;
  readonly editor?: ShortcutEditor;
}

export function deriveShortcutSettingsList(input: ShortcutListInput): ShortcutList {
  const { actions, shortcuts, filter = "", editor = { kind: "closed" } } = input;
  const conflicts = conflictStates(actions, previewShortcuts(shortcuts, editor));
  const needle = filter.trim().toLowerCase();

  const rows = actions.map((action) => buildRow(action, shortcuts, editor, conflicts));
  const shownRows = rows.filter((row) => matchesFilter(row, needle));

  const grouped = new Map<string, ShortcutListRow[]>();
  for (const row of shownRows) {
    const group = row.action.group ?? "Other";
    grouped.set(group, [...(grouped.get(group) ?? []), row]);
  }

  return {
    groups: [...grouped.entries()]
      .map(([name, groupRows]) => ({ name, rows: [...groupRows].sort(compareRows) }))
      .sort(compareGroups),
    total: actions.length,
    shown: shownRows.length,
    customCount: actions.filter((action) => readOverride(action.id, shortcuts) !== undefined).length,
  };
}

export function shortcutBindingShortcut(state: ShortcutBindingState): string {
  return state.kind === "default" || state.kind === "custom" ? state.shortcut : "";
}

export function shortcutBindingLabel(state: ShortcutBindingState): string {
  switch (state.kind) {
    case "default": return "Default";
    case "custom": return "Custom";
    case "disabled": return "Off";
    case "unassigned": return "Unset";
  }
}

/** The editor state for one row: `closed` for every row that is not the open one. */
export function rowEditorFor(editor: ShortcutEditor, actionId: string): ShortcutEditor {
  return editor.kind !== "closed" && editor.actionId === actionId ? editor : { kind: "closed" };
}

export function openShortcutMenu(editor: ShortcutEditor, actionId: string): ShortcutEditor {
  if (editor.kind === "menu" && editor.actionId === actionId) return { kind: "closed" };
  return { kind: "menu", actionId };
}

export function startRecording(editor: ShortcutEditor, actionId: string): ShortcutEditor {
  if (editor.kind === "recording" && editor.actionId === actionId) return { kind: "closed" };
  return { kind: "recording", actionId, tokens: [] };
}

export function startTyping(actionId: string, draft: string): ShortcutEditor {
  return { kind: "typing", actionId, draft };
}

export function closeShortcutEditor(): ShortcutEditor {
  return { kind: "closed" };
}

export function appendRecordedToken(editor: ShortcutEditor, token: string): ShortcutEditor {
  if (editor.kind !== "recording") return editor;
  return { kind: "recording", actionId: editor.actionId, tokens: [...editor.tokens, token] };
}

/** The shortcut an editor is proposing, or undefined when it proposes nothing parseable. */
export function editorShortcut(editor: ShortcutEditor): string | undefined {
  if (editor.kind === "recording") {
    return editor.tokens.length === 0 ? undefined : editor.tokens.join(" ");
  }
  if (editor.kind !== "typing") return undefined;
  const parsed = parseShortcutInput(editor.draft);
  return parsed.ok ? parsed.shortcut : undefined;
}

function buildRow(
  action: AppAction,
  shortcuts: PiWebShortcutConfig,
  editor: ShortcutEditor,
  conflicts: ReadonlyMap<string, ShortcutConflictState>,
): ShortcutListRow {
  const saved = bindingState(action, shortcuts);
  const rowEditor = rowEditorFor(editor, action.id);
  const proposed = editorShortcut(rowEditor);
  const state: ShortcutBindingState = proposed === undefined ? saved : { kind: "custom", shortcut: proposed };
  return {
    action,
    state,
    saved,
    conflict: conflicts.get(action.id) ?? { kind: "clear" },
    display: formatShortcut(shortcutBindingShortcut(state)),
    dirty: proposed !== undefined && !sameShortcut(proposed, shortcutBindingShortcut(saved)),
    overridden: readOverride(action.id, shortcuts) !== undefined,
  };
}

/**
 * Conflict resolution reuses the dispatcher's own resolver, so the panel can
 * never disagree with what actually fires, including prefix conflicts.
 */
function conflictStates(actions: readonly AppAction[], shortcuts: PiWebShortcutConfig): Map<string, ShortcutConflictState> {
  const resolutions = resolveShortcutBindings([...actions], shortcuts, { enabledOnly: true });
  const states = new Map<string, ShortcutConflictState>();
  for (const resolution of resolutions) {
    if (resolution.conflicts.length > 0) {
      states.set(resolution.action.id, { kind: resolution.active ? "partial-conflict" : "conflict", peers: resolution.conflicts.map((binding) => binding.action.title) });
      continue;
    }
    if (!resolution.active) {
      states.set(resolution.action.id, { kind: "shadowed", winner: resolution.shadowedBy?.action.title ?? "another action" });
      continue;
    }
    if (resolution.partiallyShadowedBy.length > 0) {
      states.set(resolution.action.id, { kind: "partial-shadowed", winners: resolution.partiallyShadowedBy.map((binding) => binding.action.title) });
      continue;
    }
    if (resolution.shadows.length === 0) continue;
    states.set(resolution.action.id, { kind: "shadows", victims: resolution.shadows.map((binding) => binding.action.title) });
  }
  return states;
}

/** Conflicts are previewed against the edit in progress, so a collision is visible before saving. */
function previewShortcuts(shortcuts: PiWebShortcutConfig, editor: ShortcutEditor): PiWebShortcutConfig {
  const proposed = editorShortcut(editor);
  if (proposed === undefined || editor.kind === "closed" || editor.kind === "menu") return shortcuts;
  return { ...shortcuts, [editor.actionId]: proposed };
}

function bindingState(action: AppAction, shortcuts: PiWebShortcutConfig): ShortcutBindingState {
  const override = readOverride(action.id, shortcuts);
  if (override === null) return { kind: "disabled" };
  if (override !== undefined && override !== "") return { kind: "custom", shortcut: override };
  if (action.shortcut !== undefined && action.shortcut !== "") return { kind: "default", shortcut: action.shortcut };
  return { kind: "unassigned" };
}

function readOverride(actionId: string, shortcuts: PiWebShortcutConfig): string | null | undefined {
  return Object.hasOwn(shortcuts, actionId) ? shortcuts[actionId] : undefined;
}

function matchesFilter(row: ShortcutListRow, needle: string): boolean {
  if (needle === "") return true;
  return [row.action.title, row.action.id, row.action.group ?? "", row.display, row.action.description ?? ""]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function sameShortcut(left: string, right: string): boolean {
  return normalizeShortcut(left).join(" ") === normalizeShortcut(right).join(" ");
}

function compareRows(left: ShortcutListRow, right: ShortcutListRow): number {
  return left.action.title.localeCompare(right.action.title);
}

function compareGroups(left: ShortcutListGroup, right: ShortcutListGroup): number {
  return groupRank(left.name) - groupRank(right.name) || left.name.localeCompare(right.name);
}

function groupRank(name: string): number {
  const index = GROUP_ORDER.indexOf(name);
  return index === -1 ? GROUP_ORDER.length : index;
}
