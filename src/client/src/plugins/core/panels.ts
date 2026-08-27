import { html, type TemplateResult } from "lit";
import { renderBuiltinTabIcon } from "../../components/tabIcons";
import { deriveDelegatedRuns } from "../../delegatedAgents";
import { notificationInboxTotalCount, selectedNotificationView } from "../../sessionNotifications";
import "../../components/SessionNotificationsPanel";
import "../../components/WorkspaceAgentsPanel";
import "../../components/WorkspaceFilesPanel";
import "../../components/WorkspacePreviewPanel";
import "../../components/WorkspaceGitPanel";
import type { WorkspacePanelContribution, WorkspacePanelContext } from "../types";

const NOTIFICATIONS_PANEL_ID = "workspace.notifications";
const PREVIEW_PANEL_ID = "workspace.preview";
const AGENTS_PANEL_ID = "workspace.agents";

export function createCoreWorkspacePanels(): WorkspacePanelContribution[] {
  return [
    {
      id: "workspace.files",
      title: "Files",
      icon: renderBuiltinTabIcon("files"),
      order: 10,
      render: renderFiles,
    },
    {
      id: PREVIEW_PANEL_ID,
      title: "Preview",
      icon: renderBuiltinTabIcon("preview"),
      // Beside Files, where its documents come from.
      order: 15,
      // No document, no tab; the open-tool clause keeps the panel from
      // vanishing from under someone reading it when the document is closed
      // from elsewhere.
      visible: (context) => context.state.previewDocument !== undefined || isOpenTool(context, PREVIEW_PANEL_ID),
      render: renderPreview,
    },
    {
      id: "workspace.git",
      title: "Git",
      icon: renderBuiltinTabIcon("git"),
      order: 20,
      visible: ({ workspace }) => workspace.isGitRepo,
      render: renderGit,
    },
    {
      id: "workspace.terminal",
      title: "Terminal",
      icon: renderBuiltinTabIcon("terminal"),
      order: 30,
      badge: (context) => context.activeTerminalCount > 0 ? context.activeTerminalCount : undefined,
      render: renderTerminal,
    },
    {
      id: NOTIFICATIONS_PANEL_ID,
      title: "Notifications",
      icon: renderBuiltinTabIcon("notifications"),
      order: 40,
      visible: (context) => notificationCount(context) > 0 || isOpenTool(context, NOTIFICATIONS_PANEL_ID),
      badge: (context) => {
        const count = notificationCount(context);
        return count > 0 ? count : undefined;
      },
      render: renderNotifications,
    },
    {
      id: AGENTS_PANEL_ID,
      title: "Agents",
      icon: renderBuiltinTabIcon("agents"),
      // Last in the strip, after the Processes plugin at 50: Agents is the
      // least-reached-for tool, and the wireframe places it there.
      order: 60,
      // A session that delegated nothing should not carry a permanently empty
      // tab. The open-tool clause keeps the panel from vanishing from under
      // someone who is reading it when the last run scrolls out of the window.
      visible: (context) => agentsWorking(context).total > 0 || isOpenTool(context, AGENTS_PANEL_ID),
      // Only what is running now. A total-agent badge would never clear once a
      // session had delegated anything, which is noise rather than signal.
      badge: (context) => {
        const running = agentsWorking(context).running;
        return running > 0 ? running : undefined;
      },
      render: renderAgents,
    },
  ];
}

function agentsWorking(context: WorkspacePanelContext): { total: number; running: number } {
  let total = 0;
  let running = 0;
  for (const run of deriveDelegatedRuns(context.state.messages)) {
    total += run.counts.total;
    running += run.counts.running;
  }
  return { total, running };
}

function notificationCount(context: WorkspacePanelContext): number {
  const inbox = selectedNotificationView(context.state.selectedNotificationInbox);
  return inbox === undefined ? 0 : notificationInboxTotalCount(inbox);
}

function isOpenTool(context: WorkspacePanelContext, panelId: string): boolean {
  return context.state.workspaceTool === `core:${panelId}`;
}

function renderFiles(context: WorkspacePanelContext): TemplateResult {
  return html`<workspace-files-panel .context=${context}></workspace-files-panel>`;
}

function renderTerminal(context: WorkspacePanelContext): TemplateResult {
  loadTerminalPanel();
  return html`<terminal-panel data-keyboard-shortcut-context="terminal" .workspace=${context.workspace} .machineId=${context.machine.id} .selectedTerminalId=${context.selectedTerminalId} .autoStart=${context.terminalAutoStart} .onSelectTerminal=${context.onSelectTerminal}></terminal-panel>`;
}

function renderPreview(context: WorkspacePanelContext): TemplateResult {
  return html`<workspace-preview-panel .context=${context}></workspace-preview-panel>`;
}

function renderGit(context: WorkspacePanelContext): TemplateResult {
  return html`<workspace-git-panel .context=${context}></workspace-git-panel>`;
}

function renderNotifications(context: WorkspacePanelContext): TemplateResult {
  return html`
    <session-notifications-panel
      .inbox=${selectedNotificationView(context.state.selectedNotificationInbox)}
      .onDismissNotification=${context.onDismissNotification}
      .onDismissAllNotifications=${context.onDismissAllNotifications}
    ></session-notifications-panel>
  `;
}

function renderAgents(context: WorkspacePanelContext): TemplateResult {
  return html`<workspace-agents-panel .context=${context}></workspace-agents-panel>`;
}

function loadTerminalPanel(): void {
  void import("../../components/TerminalPanel");
}
