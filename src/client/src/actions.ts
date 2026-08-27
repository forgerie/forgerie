import type { KeyboardShortcutContext } from "../../shared/shortcutContexts";

export type { KeyboardShortcutContext } from "../../shared/shortcutContexts";

export interface AppAction {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  /** Workbench-only by default. Add contexts only when an app command must outrank their local keys. */
  shortcutContexts?: readonly KeyboardShortcutContext[];
  /** False when holding the shortcut must consume repeats without rerunning the action. */
  repeatable?: boolean;
  group?: string;
  enabled?: boolean;
  /** When present on a disabled action, keep it visible and explain why it cannot run. */
  disabledReason?: string;
  run: () => void | Promise<void>;
}
