import { describe, expect, it, vi } from "vitest";
import { initialAppState } from "../../appState";
import type { AppState } from "../../appState";
import type { SelectedSessionNotificationInbox } from "../../sessionNotifications";
import type { ChatLine, ToolExecutionPart } from "../../components/shared";
import type { WorkspacePanelContext } from "../types";
import { createCoreWorkspacePanels } from "./panels";

describe("core workspace panels", () => {
  it("places Notifications before Processes and Agents", () => {
    const orders = createCoreWorkspacePanels().map((panel) => ({ id: panel.id, order: panel.order }));

    expect(orders).toEqual([
      { id: "workspace.files", order: 10 },
      { id: "workspace.git", order: 20 },
      { id: "workspace.terminal", order: 30 },
      { id: "workspace.notifications", order: 40 },
      { id: "workspace.agents", order: 60 },
    ]);
  });

  describe("notifications panel", () => {
    it("appears with the full inbox count when notifications are waiting", () => {
      const panelContext = context({ messages: [], selectedNotificationInbox: notificationInbox() });

      expect(notificationsVisible(panelContext)).toBe(true);
      expect(notificationsBadge(panelContext)).toBe(4);
    });

    it("stays open after the final notification is cleared, then leaves the strip", () => {
      const open = context({ messages: [], workspaceTool: "core:workspace.notifications" });
      const closed = context({ messages: [] });

      expect(notificationsVisible(open)).toBe(true);
      expect(notificationsVisible(closed)).toBe(false);
      expect(notificationsBadge(open)).toBeUndefined();
    });
  });

  describe("agents panel", () => {
    it("badges the number of agents working now, and nothing when none are", () => {
      expect(agentsBadge(context({ messages: [line(runningRun())] }))).toBe(1);
      expect(agentsBadge(context({ messages: [line(finishedRun())] }))).toBeUndefined();
      expect(agentsBadge(context({ messages: [] }))).toBeUndefined();
    });

    it("stays out of the tab strip for a session that delegated nothing", () => {
      expect(agentsVisible(context({ messages: [] }))).toBe(false);
      expect(agentsVisible(context({ messages: [line(finishedRun())] }))).toBe(true);
    });

    it("does not vanish from under the user while it is the open tool", () => {
      const open = context({ messages: [], workspaceTool: "core:workspace.agents" });

      expect(agentsVisible(open)).toBe(true);
    });
  });
});

function notificationsPanel() {
  const panel = createCoreWorkspacePanels().find((entry) => entry.id === "workspace.notifications");
  if (panel === undefined) throw new Error("notifications panel is not registered");
  return panel;
}

function notificationsBadge(panelContext: WorkspacePanelContext) {
  return notificationsPanel().badge?.(panelContext);
}

function notificationsVisible(panelContext: WorkspacePanelContext) {
  return notificationsPanel().visible?.(panelContext);
}

function agentsPanel() {
  const panel = createCoreWorkspacePanels().find((entry) => entry.id === "workspace.agents");
  if (panel === undefined) throw new Error("agents panel is not registered");
  return panel;
}

function agentsBadge(panelContext: WorkspacePanelContext) {
  return agentsPanel().badge?.(panelContext);
}

function agentsVisible(panelContext: WorkspacePanelContext) {
  return agentsPanel().visible?.(panelContext);
}

function line(part: ToolExecutionPart): ChatLine {
  return { role: "assistant", parts: [part] };
}

function runningRun(): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolCallId: "call-eb2ca573",
    toolName: "subagent",
    summary: "subagent parallel (2)",
    status: "running",
    args: { tasks: [{ agent: "se-architecture-strategist" }] },
    details: {
      mode: "parallel",
      runId: "eb2ca573",
      results: [],
      progress: [
        { index: 0, agent: "se-architecture-strategist", status: "running", task: "audit" },
        { index: 1, agent: "se-maintainability-reviewer", status: "completed", task: "review" },
      ],
    },
  };
}

function finishedRun(): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolCallId: "call-f8166139",
    toolName: "subagent",
    summary: "subagent single",
    status: "success",
    args: { agent: "scout" },
    details: { mode: "single", runId: "f8166139", results: [{ agent: "scout", task: "map", exitCode: 0, output: "done" }] },
  };
}

function notificationInbox(): SelectedSessionNotificationInbox {
  return {
    machineId: "local",
    sessionId: "session-1",
    cwd: "/tmp/project",
    status: "fresh",
    daemonInstanceId: "daemon-a",
    catalogRevision: 1,
    summary: {
      sessionId: "session-1",
      cwd: "/tmp/project",
      inboxRevision: 1,
      retainedCount: 2,
      discardedCount: 2,
      highestSeverity: "warning",
    },
    notifications: [
      { id: "daemon-a:2", message: "new", truncated: false, severity: "warning", receivedAt: "2026-08-10T10:02:00.000Z", order: 2 },
      { id: "daemon-a:1", message: "old", truncated: false, severity: "info", receivedAt: "2026-08-10T10:01:00.000Z", order: 1 },
    ],
    dismissThrough: { order: 0, overflowWatermark: 0 },
    optimisticDismissedIds: [],
    announcements: [],
  };
}

function context(patch: { messages: ChatLine[]; workspaceTool?: AppState["workspaceTool"]; selectedNotificationInbox?: SelectedSessionNotificationInbox }): WorkspacePanelContext {
  const state: AppState = {
    ...initialAppState(),
    messages: patch.messages,
    ...(patch.workspaceTool === undefined ? {} : { workspaceTool: patch.workspaceTool }),
    ...(patch.selectedNotificationInbox === undefined ? {} : { selectedNotificationInbox: patch.selectedNotificationInbox }),
  };
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} },
    state,
    files: {
      readFile: vi.fn<WorkspacePanelContext["files"]["readFile"]>(() => Promise.reject(new Error("not implemented"))),
      listFiles: vi.fn<WorkspacePanelContext["files"]["listFiles"]>(() => Promise.reject(new Error("not implemented"))),
      writeFile: vi.fn<WorkspacePanelContext["files"]["writeFile"]>(() => Promise.reject(new Error("not implemented"))),
      deleteFile: vi.fn<WorkspacePanelContext["files"]["deleteFile"]>(() => Promise.reject(new Error("not implemented"))),
      moveFile: vi.fn<WorkspacePanelContext["files"]["moveFile"]>(() => Promise.reject(new Error("not implemented"))),
    },
    prompt: { insertText: vi.fn<WorkspacePanelContext["prompt"]["insertText"]>(), getText: vi.fn<WorkspacePanelContext["prompt"]["getText"]>(() => ""), getSelection: vi.fn<WorkspacePanelContext["prompt"]["getSelection"]>(() => null) },
    terminal: { open: vi.fn<WorkspacePanelContext["terminal"]["open"]>(), runCommand: vi.fn<WorkspacePanelContext["terminal"]["runCommand"]>(() => Promise.reject(new Error("not implemented"))) },
    host: { requestRender: vi.fn<WorkspacePanelContext["host"]["requestRender"]>() },
    fileTree: [],
    expandedDirs: {},
    selectedFilePath: undefined,
    selectedFileContent: undefined,
    fileTreeStale: false,
    gitStatus: undefined,
    selectedDiffPath: undefined,
    selectedDiff: undefined,
    selectedStagedDiff: undefined,
    gitStale: false,
    activeTerminalCount: 0,
    selectedTerminalId: undefined,
    terminalAutoStart: false,
    workspaceUploadDefaultFolder: ".forgerie/uploads",
    onRefreshFiles: vi.fn<WorkspacePanelContext["onRefreshFiles"]>(),
    onExpandDir: vi.fn<WorkspacePanelContext["onExpandDir"]>(),
    onSelectFile: vi.fn<WorkspacePanelContext["onSelectFile"]>(),
    onStartWorkspaceUpload: vi.fn<WorkspacePanelContext["onStartWorkspaceUpload"]>(() => undefined),
    onCancelWorkspaceUpload: vi.fn<WorkspacePanelContext["onCancelWorkspaceUpload"]>(),
    onClearWorkspaceUpload: vi.fn<WorkspacePanelContext["onClearWorkspaceUpload"]>(),
    onRefreshGit: vi.fn<WorkspacePanelContext["onRefreshGit"]>(),
    onSelectDiff: vi.fn<WorkspacePanelContext["onSelectDiff"]>(),
    onSelectTerminal: vi.fn<WorkspacePanelContext["onSelectTerminal"]>(),
  };
}
