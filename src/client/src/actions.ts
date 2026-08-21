export interface AppAction {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  /** False when holding the shortcut must consume repeats without rerunning the action. */
  repeatable?: boolean;
  group?: string;
  enabled?: boolean;
  /** When present on a disabled action, keep it visible and explain why it cannot run. */
  disabledReason?: string;
  run: () => void | Promise<void>;
}
