import type { AppAction } from "./actions";
import { KEYBOARD_SHORTCUT_CONTEXTS, type KeyboardShortcutContext } from "../../shared/shortcutContexts";
import {
  isShortcutSequenceStarter,
  normalizeShortcut,
  shortcutTokenFromEvent,
  type ShortcutKeyLikeEvent,
} from "../../shared/shortcutSyntax";

export { formatShortcut, isShortcutSequenceStarter, normalizeShortcut, parseShortcutInput, shortcutTokenFromEvent } from "../../shared/shortcutSyntax";
export type { ShortcutParseResult } from "../../shared/shortcutSyntax";

export const shortcutSequenceTimeoutMs = 1200;

export type ShortcutPreferenceConfig = Record<string, string | null>;
export type ShortcutBindingSource = "default" | "custom";

export interface ShortcutKeyEvent extends ShortcutKeyLikeEvent {
  repeat: boolean;
  target: EventTarget | null;
}

type KeyboardShortcutDecision =
  | { kind: "defer" }
  | { kind: "pending" }
  | { kind: "consume" }
  | { kind: "run"; action: AppAction };

interface ShortcutDispatchOptions {
  shortcuts?: ShortcutPreferenceConfig;
  context?: KeyboardShortcutContext;
}

export interface ShortcutBindingSummary {
  action: AppAction;
  shortcut: string;
  source: ShortcutBindingSource;
}

export interface ShortcutBindingResolution extends ShortcutBindingSummary {
  tokens: string[];
  order: number;
  active: boolean;
  conflicts: ShortcutBindingSummary[];
  shadows: ShortcutBindingSummary[];
  partiallyShadowedBy: ShortcutBindingSummary[];
  shadowedBy?: ShortcutBindingSummary;
}

interface ShortcutBinding extends ShortcutBindingSummary {
  tokens: string[];
  order: number;
}

interface ContextBindingStatus {
  active: boolean;
  conflicts: ShortcutBinding[];
  shadows: ShortcutBinding[];
  shadowedBy?: ShortcutBinding;
}

export class KeyboardShortcutDispatcher {
  private pendingTokens: string[] = [];
  private pendingContext: KeyboardShortcutContext | undefined;
  private pendingTimer: ReturnType<typeof setTimeout> | undefined;

  decide(event: ShortcutKeyEvent, actions: AppAction[] | (() => AppAction[]), options: ShortcutDispatchOptions = {}): KeyboardShortcutDecision {
    if (event.isComposing || event.metaKey) {
      this.clearPending();
      return { kind: "defer" };
    }

    const context = options.context ?? "workbench";
    if (this.pendingTokens.length > 0 && this.pendingContext !== context) this.clearPending();

    const token = shortcutTokenFromEvent(event);
    if (token === undefined) return { kind: "defer" };
    if (this.pendingTokens.length === 0 && !isShortcutSequenceStarter(token)) return { kind: "defer" };

    const actionCatalog = typeof actions === "function" ? actions() : actions;
    const shortcuts = resolveShortcutBindings(actionCatalog, options.shortcuts, { enabledOnly: true, context })
      .filter((binding) => binding.active)
      .map((binding) => ({ action: binding.action, tokens: binding.tokens }));

    if (this.pendingTokens.length > 0) {
      const pendingDecision = this.decideSequence([...this.pendingTokens, token], shortcuts, event.repeat, context);
      if (pendingDecision.kind !== "defer") return pendingDecision;
      this.clearPending();
      if (!isShortcutSequenceStarter(token)) return { kind: "defer" };
    }

    return this.decideSequence([token], shortcuts, event.repeat, context);
  }

  reset(): void {
    this.clearPending();
  }

  private decideSequence(
    sequence: string[],
    shortcuts: { action: AppAction; tokens: string[] }[],
    repeat: boolean,
    context: KeyboardShortcutContext,
  ): KeyboardShortcutDecision {
    const exact = shortcuts.find((entry) => sameTokens(entry.tokens, sequence));
    if (exact !== undefined) {
      this.clearPending();
      if (repeat && exact.action.repeatable === false) return { kind: "consume" };
      return { kind: "run", action: exact.action };
    }

    if (shortcuts.some((entry) => startsWithTokens(entry.tokens, sequence))) {
      this.setPending(sequence, context);
      return { kind: "pending" };
    }

    return { kind: "defer" };
  }

  private setPending(tokens: string[], context: KeyboardShortcutContext): void {
    this.clearPending();
    this.pendingTokens = tokens;
    this.pendingContext = context;
    this.pendingTimer = globalThis.setTimeout(() => {
      this.pendingTokens = [];
      this.pendingContext = undefined;
      this.pendingTimer = undefined;
    }, shortcutSequenceTimeoutMs);
  }

  private clearPending(): void {
    this.pendingTokens = [];
    this.pendingContext = undefined;
    if (this.pendingTimer !== undefined) {
      globalThis.clearTimeout(this.pendingTimer);
      this.pendingTimer = undefined;
    }
  }
}

export function resolveShortcutBindings(
  actions: AppAction[],
  shortcuts?: ShortcutPreferenceConfig,
  options: { enabledOnly?: boolean; context?: KeyboardShortcutContext } = {},
): ShortcutBindingResolution[] {
  const bindings = actions.flatMap((action, order) => {
    if (options.enabledOnly === true && action.enabled === false) return [];
    const binding = shortcutBindingForAction(action, shortcuts, order);
    return binding === undefined ? [] : [binding];
  });

  const contexts = options.context === undefined ? KEYBOARD_SHORTCUT_CONTEXTS : [options.context];
  const statuses = contexts.map((context) => resolveContextBindings(bindings.filter((binding) => shortcutAppliesInContext(binding.action, context))));

  return bindings.map((binding) => {
    const contextStatuses = statuses.flatMap((status) => {
      const bindingStatus = status.get(binding);
      return bindingStatus === undefined ? [] : [bindingStatus];
    });
    const active = contextStatuses.some((status) => status.active);
    const conflicts = uniqueBindings(contextStatuses.flatMap((status) => status.conflicts)).map(shortcutBindingSummary);
    const shadows = uniqueBindings(contextStatuses.flatMap((status) => status.shadows)).map(shortcutBindingSummary);
    const shadowedByBindings = uniqueBindings(contextStatuses.flatMap((status) => status.shadowedBy === undefined ? [] : [status.shadowedBy]));
    const partiallyShadowedBy = active ? shadowedByBindings.map(shortcutBindingSummary) : [];
    const shadowedByBinding = active ? undefined : shadowedByBindings[0];
    return {
      ...binding,
      active,
      conflicts,
      shadows,
      partiallyShadowedBy,
      ...(shadowedByBinding === undefined ? {} : { shadowedBy: shortcutBindingSummary(shadowedByBinding) }),
    };
  }).sort((left, right) => left.order - right.order);
}

function shortcutContextsForAction(action: AppAction): readonly KeyboardShortcutContext[] {
  return action.shortcutContexts ?? ["workbench"];
}

function resolveContextBindings(bindings: ShortcutBinding[]): Map<ShortcutBinding, ContextBindingStatus> {
  const neighbors = new Map<ShortcutBinding, ShortcutBinding[]>();
  for (const binding of bindings) neighbors.set(binding, []);
  for (let leftIndex = 0; leftIndex < bindings.length; leftIndex += 1) {
    const left = bindings[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < bindings.length; rightIndex += 1) {
      const right = bindings[rightIndex];
      if (right === undefined || !bindingsConflict(left, right)) continue;
      neighbors.get(left)?.push(right);
      neighbors.get(right)?.push(left);
    }
  }

  const betterNeighbors = new Map<ShortcutBinding, ShortcutBinding[]>();
  for (const binding of bindings) {
    betterNeighbors.set(binding, (neighbors.get(binding) ?? [])
      .filter((candidate) => shortcutSourceRank(candidate.source) < shortcutSourceRank(binding.source))
      .sort(compareShortcutBindings));
  }
  const survivors = new Set(bindings.filter((binding) => (betterNeighbors.get(binding)?.length ?? 0) === 0));

  const statuses = new Map<ShortcutBinding, ContextBindingStatus>();
  for (const binding of bindings) {
    const better = betterNeighbors.get(binding) ?? [];
    const shadowedBy = better[0];
    if (shadowedBy !== undefined) {
      statuses.set(binding, { active: false, conflicts: [], shadows: [], shadowedBy });
      continue;
    }

    const conflicts = (neighbors.get(binding) ?? [])
      .filter((candidate) => survivors.has(candidate) && shortcutSourceRank(candidate.source) === shortcutSourceRank(binding.source))
      .sort(compareShortcutBindings);
    const active = conflicts.length === 0;
    const shadows = active
      ? bindings.filter((candidate) => betterNeighbors.get(candidate)?.includes(binding) === true).sort(compareShortcutBindings)
      : [];
    statuses.set(binding, { active, conflicts, shadows });
  }
  return statuses;
}

function shortcutBindingForAction(action: AppAction, shortcuts: ShortcutPreferenceConfig | undefined, order: number): ShortcutBinding | undefined {
  const configured = shortcutPreference(action.id, shortcuts);
  if (configured === null) return undefined;
  const shortcut = configured ?? action.shortcut;
  if (shortcut === undefined || shortcut === "") return undefined;
  const tokens = normalizeShortcut(shortcut);
  const firstToken = tokens[0];
  if (firstToken === undefined || !isShortcutSequenceStarter(firstToken) || shortcutContextsForAction(action).length === 0) return undefined;
  return {
    action,
    shortcut: tokens.join(" "),
    source: configured === undefined ? "default" : "custom",
    tokens,
    order,
  };
}

function shortcutPreference(actionId: string, shortcuts: ShortcutPreferenceConfig | undefined): string | null | undefined {
  if (shortcuts === undefined || !Object.hasOwn(shortcuts, actionId)) return undefined;
  return shortcuts[actionId];
}

function shortcutAppliesInContext(action: AppAction, context: KeyboardShortcutContext): boolean {
  return shortcutContextsForAction(action).includes(context);
}

function bindingsConflict(left: ShortcutBinding, right: ShortcutBinding): boolean {
  return startsWithTokens(left.tokens, right.tokens) || startsWithTokens(right.tokens, left.tokens);
}

function shortcutBindingSummary(binding: ShortcutBinding): ShortcutBindingSummary {
  return { action: binding.action, shortcut: binding.shortcut, source: binding.source };
}

function compareShortcutBindings(left: ShortcutBinding, right: ShortcutBinding): number {
  return shortcutSourceRank(left.source) - shortcutSourceRank(right.source)
    || compareStrings(left.action.id, right.action.id)
    || compareStrings(left.action.title, right.action.title)
    || left.order - right.order;
}

function shortcutSourceRank(source: ShortcutBindingSource): number {
  switch (source) {
    case "custom": return 0;
    case "default": return 1;
  }
}

function uniqueBindings(bindings: ShortcutBinding[]): ShortcutBinding[] {
  return [...new Set(bindings)].sort(compareShortcutBindings);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameTokens(left: string[], right: string[]): boolean {
  return left.length === right.length && startsWithTokens(left, right);
}

function startsWithTokens(tokens: string[], prefix: string[]): boolean {
  return prefix.every((token, index) => tokens[index] === token);
}
