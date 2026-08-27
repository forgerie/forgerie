import { isSessionActive } from "../../../../shared/activity";
import { KEYBOARD_SHORTCUT_CONTEXTS } from "../../../../shared/shortcutContexts";
import type { AppState } from "../../appState";
import { isArchivableSessionInfo, isTransientNewSessionInfo } from "../../sessionPersistence";
import { isWorkspaceDeletionPending } from "../../workspaceDeletion";
import type { PluginAction } from "../types";

export function createCoreActions(): PluginAction[] {
  return [
    {
      id: "actions.show",
      title: "Show Actions",
      description: "Open the command palette",
      shortcut: "ctrl+shift+p",
      shortcutContexts: APP_WIDE_SHORTCUT_CONTEXTS,
      group: "General",
      run: (context) => { context.openActionPalette(); },
    },
    {
      id: "prompt.focus",
      title: "Focus Prompt",
      description: "Move keyboard focus to the message composer",
      shortcut: "ctrl+alt+i",
      shortcutContexts: APP_WIDE_SHORTCUT_CONTEXTS,
      group: "General",
      run: (context) => { context.focusPrompt(); },
    },
    {
      id: "machine.add",
      title: "Add Machine",
      description: "Register another Forgerie runtime reachable from this gateway",
      group: "Machine",
      run: (context) => context.addMachine(),
    },
    {
      id: "machine.refresh",
      title: "Refresh Selected Machine",
      description: "Check whether the selected Forgerie runtime is online",
      group: "Machine",
      run: (context) => context.refreshSelectedMachine(),
    },
    {
      id: "machine.open",
      title: "Open Selected Machine Forgerie",
      description: "Open the selected remote Forgerie directly in a new tab",
      group: "Machine",
      enabled: (context) => context.state.selectedMachine?.kind === "remote" && context.state.selectedMachine.baseUrl !== undefined,
      run: (context) => context.openSelectedMachine(),
    },
    {
      id: "machine.remove",
      title: "Remove Selected Machine",
      description: "Remove the selected remote machine from this gateway",
      group: "Machine",
      enabled: (context) => context.state.selectedMachine?.kind === "remote",
      run: (context) => context.removeSelectedMachine(),
    },
    {
      id: "project.add",
      title: "Add Project",
      group: "Project",
      run: (context) => context.addProject(),
    },
    {
      id: "prompt.new",
      title: "New Prompt",
      description: "Save a reusable /prompt without tying it to a session or the composer",
      group: "General",
      run: (context) => { context.openPromptDialog(); },
    },
    {
      id: "auth.login",
      title: "Configure Provider Authentication",
      description: "Run /login without tying authentication to a session",
      group: "General",
      run: (context) => context.configureAuth(),
    },
    {
      id: "auth.logout",
      title: "Remove Provider Authentication",
      description: "Run /logout for stored pi credentials",
      group: "General",
      run: (context) => context.logoutAuth(),
    },
    {
      id: "theme.select",
      title: "Select Theme",
      description: "Choose the Forgerie color theme",
      group: "Preferences",
      run: (context) => { context.openThemePicker(); },
    },
    {
      id: "settings.open",
      title: "Open Settings",
      description: "Manage Forgerie configuration and keyboard shortcuts",
      shortcut: "ctrl+,",
      shortcutContexts: APP_WIDE_SHORTCUT_CONTEXTS,
      group: "Preferences",
      run: (context) => { context.piWebUnstable?.openSettings?.(); },
    },
    {
      id: "settings.shortcuts",
      title: "Open Keyboard Shortcuts",
      description: "Manage Forgerie keyboard shortcuts",
      shortcut: "ctrl+k ctrl+s",
      group: "Preferences",
      run: (context) => { context.piWebUnstable?.openSettings?.("shortcuts"); },
    },
    {
      id: "app.reload-page",
      title: "Full Page Reload",
      description: "Reload the Forgerie browser page",
      group: "General",
      run: (context) => { context.reloadPage(); },
    },
    {
      id: "view.chat",
      title: "Go to Chat",
      group: "Navigation",
      // Shows the transcript without raising the on-screen keyboard.
      // "Focus Prompt" is the action that moves focus into the composer.
      run: (context) => { context.selectMainView("chat"); },
    },
    {
      id: "view.files",
      title: "Go to Files",
      shortcut: "ctrl+shift+e",
      shortcutContexts: APP_WIDE_SHORTCUT_CONTEXTS,
      group: "Navigation",
      enabled: hasWorkspace,
      run: (context) => { context.selectMainView("core:workspace.files"); },
    },
    {
      id: "view.git",
      title: "Go to Git",
      shortcut: "ctrl+shift+g",
      shortcutContexts: APP_WIDE_SHORTCUT_CONTEXTS,
      group: "Navigation",
      enabled: hasGitWorkspace,
      run: (context) => { context.selectMainView("core:workspace.git"); },
    },
    {
      id: "view.terminal",
      title: "Go to Terminal",
      shortcut: "ctrl+`",
      shortcutContexts: APP_WIDE_SHORTCUT_CONTEXTS,
      group: "Navigation",
      enabled: hasWorkspace,
      run: (context) => { context.selectMainView("core:workspace.terminal"); },
    },
    {
      id: "workspace.refresh-files",
      title: "Refresh Files",
      group: "Workspace",
      enabled: hasWorkspace,
      run: (context) => context.refreshFiles(),
    },
    {
      id: "workspace.refresh-git",
      title: "Refresh Git",
      group: "Workspace",
      enabled: hasGitWorkspace,
      run: (context) => context.refreshGit(),
    },
    {
      id: "workspace.refresh-current",
      title: "Refresh Current Panel",
      group: "Workspace",
      enabled: hasWorkspace,
      run: (context) => context.state.workspaceTool === "core:workspace.git" && context.state.selectedWorkspace?.isGitRepo === true ? context.refreshGit() : context.refreshFiles(),
    },
    {
      id: "workspace.delete",
      title: "Delete Workspace",
      description: "Remove the selected Git worktree",
      group: "Workspace",
      enabled: hasDeletableWorkspace,
      run: (context) => context.deleteWorkspace(),
    },
    {
      id: "session.start",
      title: "New session",
      description: "Compose a first prompt for a new session",
      shortcut: "ctrl+enter",
      shortcutContexts: SESSION_CREATION_SHORTCUT_CONTEXTS,
      group: "Session",
      run: (context) => { context.openNewSessionComposer(); },
    },
    {
      id: "session.start-rapidfire",
      title: "New Rapidfire session",
      description: "Compose a first prompt with Rapidfire enabled",
      shortcut: "ctrl+shift+enter",
      shortcutContexts: SESSION_CREATION_SHORTCUT_CONTEXTS,
      group: "Session",
      run: (context) => { context.openNewSessionComposer("rapidfire"); },
    },
    {
      id: "model.select",
      title: "Select Model",
      description: "Choose the model for the selected session",
      group: "Session",
      enabled: hasSelectableSession,
      run: (context) => context.openModelPicker(),
    },
    {
      id: "model.cycle",
      title: "Cycle Model",
      description: "Use the next Pi scoped model for the selected session",
      group: "Session",
      enabled: hasSelectableSession,
      run: (context) => context.cycleModel(),
    },
    {
      id: "thinking.select",
      title: "Select Thinking Level",
      description: "Choose the thinking level for the selected session",
      group: "Session",
      enabled: hasSelectableSession,
      run: (context) => context.openThinkingLevelPicker(),
    },
    {
      id: "session.archive",
      title: "Archive Session",
      description: "Archive the selected session",
      group: "Session",
      enabled: hasArchivableSession,
      run: (context) => context.archiveSession(),
    },
    {
      id: "session.reload",
      title: "Reload Session from Disk",
      description: "Close and re-open the selected session from its session file. Use /reload in the prompt for Pi runtime resources.",
      group: "Session",
      enabled: hasReloadableSession,
      run: (context) => context.reloadSession(),
    },
    {
      id: "session.delete",
      title: "Delete New Session",
      description: "Delete the selected transient new session",
      group: "Session",
      enabled: hasTransientNewSession,
      run: (context) => context.deleteCachedNewSession(),
    },
    {
      id: "session.stop",
      title: "Stop Active Work",
      group: "Session",
      enabled: (context) => context.state.selectedSession !== undefined && isSessionActive(context.state.status, context.state.activity),
      run: (context) => context.stopActiveWork(),
    },
  ];
}

const APP_WIDE_SHORTCUT_CONTEXTS = KEYBOARD_SHORTCUT_CONTEXTS;
const SESSION_CREATION_SHORTCUT_CONTEXTS = ["workbench", "composer"] as const;

function hasWorkspace(context: { state: AppState }): boolean {
  return context.state.selectedWorkspace !== undefined;
}

function hasGitWorkspace(context: { state: AppState }): boolean {
  return context.state.selectedWorkspace?.isGitRepo === true;
}

function hasDeletableWorkspace(context: { state: AppState }): boolean {
  const workspace = context.state.selectedWorkspace;
  return workspace !== undefined && workspace.isGitWorktree && !workspace.isMain && !isWorkspaceDeletionPending(context.state, workspace);
}

function hasSelectableSession(context: { state: AppState }): boolean {
  const session = context.state.selectedSession;
  return session !== undefined && session.archived !== true;
}

function hasArchivableSession(context: { state: AppState }): boolean {
  return isArchivableSessionInfo(context.state.selectedSession, context.state.status);
}

function hasTransientNewSession(context: { state: AppState }): boolean {
  return isTransientNewSessionInfo(context.state.selectedSession, context.state.status);
}

function hasReloadableSession(context: { state: AppState }): boolean {
  if (!isArchivableSessionInfo(context.state.selectedSession, context.state.status)) return false;
  return !isSessionActive(context.state.status, context.state.activity);
}
