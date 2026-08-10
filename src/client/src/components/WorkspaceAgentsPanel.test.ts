// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialAppState } from "../appState";
import type { AppState } from "../appState";
import type { ChatLine, ToolExecutionPart } from "./shared";
import type { WorkspacePanelContext } from "../plugins/types";
import { WorkspaceAgentsPanel } from "./WorkspaceAgentsPanel";

afterEach(() => {
  document.body.replaceChildren();
});

describe("WorkspaceAgentsPanel", () => {
  it("tells the user to pick a session before it can show anything", async () => {
    const panel = await renderPanel({ selectedSession: undefined, messages: [] });

    expect(text(panel)).toContain("Select a session");
    expect(rows(panel, ".agent")).toHaveLength(0);
  });

  it("distinguishes a session that delegated nothing from one whose window is short", async () => {
    const empty = await renderPanel({ messages: [] });
    expect(text(empty)).toContain("has not delegated any agents");

    const shortWindow = await renderPanel({ messages: [], messagePageStart: 40 });
    expect(text(shortWindow)).toContain("Older messages are not loaded");
    expect(text(shortWindow)).not.toContain("has not delegated any agents");
  });

  it("renders one line per agent for the expanded run", async () => {
    const panel = await renderPanel({ messages: [line(runningRun())] });

    const agentRows = rows(panel, ".agent");
    expect(agentRows).toHaveLength(3);
    expect(agentRows[0]?.textContent).toContain("se-architecture-strategist");
    expect(agentRows[0]?.textContent).toContain("grep src/main/kotlin");
  });

  it("expands the run that has work in flight, so live agents are never hidden", async () => {
    const panel = await renderPanel({ messages: [line(finishedRun()), line(runningRun())] });

    // Two runs, but only the live one shows its agents without interaction.
    expect(rows(panel, ".run")).toHaveLength(2);
    expect(rows(panel, ".agent")).toHaveLength(3);
    expect(text(panel)).toContain("se-architecture-strategist");
    expect(text(panel)).not.toContain("se-correctness-reviewer");
  });

  it("summarises the whole session above the list", async () => {
    const panel = await renderPanel({ messages: [line(finishedRun()), line(runningRun())] });

    expect(text(panel)).toContain("5 agents");
    expect(text(panel)).toContain("1 working");
    expect(text(panel)).toContain("2 failed");
  });

  it("keeps a failed-at-launch agent visible with its reason", async () => {
    const panel = await renderPanel({ messages: [line(runningRun())] });

    const failedRow = rows(panel, ".agent").find((row) => row.textContent.includes("se-project-standards-reviewer"));
    expect(failedRow?.textContent).toContain("model not supported");
    expect(failedRow?.getAttribute("data-state")).toBe("failed");
  });

  it("re-renders when a same-length transcript update changes agent state", async () => {
    // tool.update replaces a part in place, so the message count never changes.
    // A cache keyed on length would freeze the rows here.
    const panel = await renderPanel({ messages: [line(runningRun())] });
    expect(rows(panel, ".agent")[0]?.getAttribute("data-state")).toBe("running");

    panel.context = context({ messages: [line(finishedVersionOfRunningRun())] });
    await panel.updateComplete;

    expect(rows(panel, ".agent")[0]?.getAttribute("data-state")).toBe("done");
  });

  it("drops the previous session's agents when the selection changes", async () => {
    const panel = await renderPanel({ messages: [line(runningRun())] });
    expect(rows(panel, ".agent")).toHaveLength(3);

    panel.context = context({ messages: [], selectedSession: session("session-2") });
    await panel.updateComplete;

    expect(rows(panel, ".agent")).toHaveLength(0);
    expect(text(panel)).toContain("has not delegated any agents");
  });
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface PanelStatePatch {
  messages: ChatLine[];
  selectedSession?: AppState["selectedSession"];
  messagePageStart?: number;
}

async function renderPanel(patch: PanelStatePatch): Promise<WorkspaceAgentsPanel> {
  const panel = new WorkspaceAgentsPanel();
  panel.context = context(patch);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function text(panel: WorkspaceAgentsPanel): string {
  return panel.shadowRoot?.textContent ?? "";
}

function rows(panel: WorkspaceAgentsPanel, selector: string): HTMLElement[] {
  return [...panel.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []];
}

function session(id: string): AppState["selectedSession"] {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/tmp/project",
    created: "2026-08-09T00:00:00.000Z",
    modified: "2026-08-09T00:00:00.000Z",
    messageCount: 4,
    firstMessage: "investigate",
  };
}

function context(patch: PanelStatePatch): WorkspacePanelContext {
  const workspace = { id: "workspace-1", projectId: "project-1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} };
  const state: AppState = {
    ...initialAppState(),
    messages: patch.messages,
    messagePageStart: patch.messagePageStart ?? 0,
    selectedSession: "selectedSession" in patch ? patch.selectedSession : session("session-1"),
  };
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace,
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

function line(part: ToolExecutionPart): ChatLine {
  return { role: "assistant", parts: [part] };
}

/** Shaped after the real 9 Aug hiper run eb2ca573, mid-flight. */
function runningRun(): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolCallId: "call-eb2ca573",
    toolName: "subagent",
    summary: "subagent parallel (3)",
    status: "running",
    args: { tasks: [{ agent: "se-architecture-strategist" }] },
    details: {
      mode: "parallel",
      runId: "eb2ca573",
      results: [],
      progress: [
        { index: 0, agent: "se-architecture-strategist", status: "running", task: "audit", currentTool: "grep", currentToolArgs: "src/main/kotlin", durationMs: 240_000 },
        { index: 1, agent: "se-maintainability-reviewer", status: "completed", task: "review", durationMs: 360_000 },
        { index: 2, agent: "se-project-standards-reviewer", status: "failed", task: "review", error: "model not supported" },
      ],
    },
  };
}

function finishedVersionOfRunningRun(): ToolExecutionPart {
  return {
    ...runningRun(),
    status: "success",
    details: {
      mode: "parallel",
      runId: "eb2ca573",
      results: [
        { agent: "se-architecture-strategist", task: "audit", exitCode: 0, output: "no findings" },
        { agent: "se-maintainability-reviewer", task: "review", exitCode: 0, output: "3 P2 findings" },
        { agent: "se-project-standards-reviewer", task: "review", exitCode: 1, output: "", error: "model not supported" },
      ],
    },
  };
}

function finishedRun(): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolCallId: "call-f8166139",
    toolName: "subagent",
    summary: "subagent parallel (2)",
    status: "success",
    args: { tasks: [{ agent: "se-correctness-reviewer" }, { agent: "se-testing-reviewer" }] },
    details: {
      mode: "parallel",
      runId: "f8166139",
      results: [
        { agent: "se-correctness-reviewer", task: "review", exitCode: 0, output: "3 P2 findings" },
        { agent: "se-testing-reviewer", task: "review", exitCode: 1, output: "", error: "model not supported" },
      ],
    },
  };
}
