import { html, type TemplateResult } from "lit";
import { renderBuiltinTabIcon } from "../../components/tabIcons";
import { deriveDelegatedRuns } from "../../delegatedAgents";
import "../../components/WorkspaceAgentsPanel";
import "../../components/WorkspaceFilesPanel";
import "../../components/WorkspaceGitPanel";
import type { WorkspacePanelContribution, WorkspacePanelContext } from "../types";

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
      id: AGENTS_PANEL_ID,
      title: "Agents",
      icon: renderBuiltinTabIcon("agents"),
      order: 40,
      // A session that delegated nothing should not carry a permanently empty
      // tab. The open-tool clause keeps the panel from vanishing from under
      // someone who is reading it when the last run scrolls out of the window.
      visible: (context) => agentsWorking(context).total > 0 || isOpenTool(context),
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

function isOpenTool(context: WorkspacePanelContext): boolean {
  return context.state.workspaceTool === `core:${AGENTS_PANEL_ID}`;
}

function renderFiles(context: WorkspacePanelContext): TemplateResult {
  return html`<workspace-files-panel .context=${context}></workspace-files-panel>`;
}

function renderTerminal(context: WorkspacePanelContext): TemplateResult {
  loadTerminalPanel();
  return html`<terminal-panel .workspace=${context.workspace} .machineId=${context.machine.id} .selectedTerminalId=${context.selectedTerminalId} .autoStart=${context.terminalAutoStart} .onSelectTerminal=${context.onSelectTerminal}></terminal-panel>`;
}

function renderGit(context: WorkspacePanelContext): TemplateResult {
  return html`<workspace-git-panel .context=${context}></workspace-git-panel>`;
}

function renderAgents(context: WorkspacePanelContext): TemplateResult {
  return html`<workspace-agents-panel .context=${context}></workspace-agents-panel>`;
}

function loadTerminalPanel(): void {
  void import("../../components/TerminalPanel");
}
