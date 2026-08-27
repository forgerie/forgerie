const LEGACY_DEFAULT_SHORTCUTS: Readonly<Record<string, string>> = {
  "core:actions.show": "mod+k",
  "core:prompt.focus": "mod+g c",
  "core:settings.open": "mod+,",
  "core:view.chat": "mod+1",
  "core:view.files": "mod+2",
  "core:view.git": "mod+3",
  "core:view.terminal": "mod+4",
  "core:workspace.refresh-files": "mod+shift+f",
  "core:workspace.refresh-git": "mod+shift+g",
  "core:workspace.refresh-current": "mod+shift+r",
  "core:session.start": "mod+enter",
  "core:session.start-rapidfire": "mod+shift+enter",
  "core:model.cycle": "mod+p",
  "core:session.stop": "mod+.",
  "app.session.toggle-dictation": "mod+space",
  "app.navigation.focus-machines": "mod+g m",
  "app.navigation.focus-projects": "mod+g p",
  "app.navigation.focus-workspaces": "mod+g w",
  "app.navigation.focus-sessions": "mod+g s",
};

/** A stored override that only repeated a default from the pre-Ctrl keymap. */
export function isLegacyDefaultShortcutPreference(actionId: string, shortcut: unknown): boolean {
  if (typeof shortcut !== "string") return false;
  const normalized = shortcut.trim().toLowerCase().replace(/\s*\+\s*/gu, "+").replace(/\s+/gu, " ");
  return LEGACY_DEFAULT_SHORTCUTS[actionId] === normalized;
}
