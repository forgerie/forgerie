// @vitest-environment happy-dom

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { selectedChatFreshReadable, selectedChatLiveReady, selectedChatTarget, type SelectedChatLoad, type SelectedChatTarget } from "../selectedChatLoad";
import { PiWebApp } from "./PiWebApp";
import type { PromptEditor } from "./PromptEditor";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [], start: 0, total: 0 }), { status: 200, headers: { "content-type": "application/json" } }))));
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp composer controls", () => {
  it("maps an idle live runtime to a non-stoppable Stop capability", async () => {
    const editor = await renderSelectedEditor(status());

    expect(editor.runtimeControlsAvailable).toBe(true);
    expect(editor.canSteer).toBe(false);
    expect(editor.isCompacting).toBe(false);
    expect(editor.capabilities.stop?.stoppable).toBe(false);
  });

  it.each([
    { name: "streaming", patch: { isStreaming: true } },
    { name: "compacting", patch: { isCompacting: true } },
    { name: "running shell", patch: { isBashRunning: true } },
    { name: "pending queued messages", patch: { pendingMessageCount: 1 } },
  ])("maps $name work to a stoppable Stop capability", async ({ patch }) => {
    const editor = await renderSelectedEditor(status(patch));

    expect(editor.capabilities.stop?.stoppable).toBe(true);
  });

  it("uses activity-only active work for Stop availability", async () => {
    const editor = await renderSelectedEditor(status(), activity({ phase: "active", label: "Running tool" }));

    expect(editor.capabilities.stop?.stoppable).toBe(true);
    expect(editor.shadowRoot?.querySelector(".stop-button")).not.toBeNull();
    expect(editor.shadowRoot?.querySelector(".queue-button")).toBeNull();
  });

  it("offers the session tree only while the runtime is available", async () => {
    const live = await renderSelectedEditor(status());
    expect(live.capabilities.tree).toBeDefined();
    expect(live.shadowRoot?.querySelector(".composer-tree")).not.toBeNull();

    const readable = await renderSelectedEditor(status(), undefined, selectedChatFreshReadable);
    expect(readable.capabilities.tree).toBeUndefined();
    expect(readable.shadowRoot?.querySelector(".composer-tree")).toBeNull();
  });

  it("does not expose Stop for startup activity", async () => {
    const editor = await renderSelectedEditor(status(), activity({ phase: "active", label: "Opening session", startup: true }));

    expect(editor.capabilities.stop?.stoppable).toBe(false);
    expect(editor.shadowRoot?.querySelector(".stop-button")).toBeNull();
    expect(editor.shadowRoot?.querySelector(".send-button")).not.toBeNull();
  });

  it.each([
    { name: "streaming", patch: { isStreaming: true }, steerable: true, queue: true },
    { name: "compaction", patch: { isCompacting: true }, steerable: false, queue: true },
    { name: "shell-only", patch: { isBashRunning: true }, steerable: false, queue: false },
    { name: "pending-only", patch: { pendingMessageCount: 1 }, steerable: false, queue: false },
  ])("renders the $name composer controls", async ({ patch, steerable, queue }) => {
    const editor = await renderSelectedEditor(status(patch));

    expect(editor.shadowRoot?.querySelector(".stop-button")).not.toBeNull();
    expect(editor.shadowRoot?.querySelector(".send-button")).toBeNull();
    expect(editor.shadowRoot?.querySelector(".queue-button") !== null).toBe(queue);
    expect(editor.shadowRoot?.querySelector(".queue-button.has-steer") !== null).toBe(steerable);
  });
});

async function renderSelectedEditor(sessionStatus: SessionStatus, sessionActivity?: SessionActivity, makeLoad: (target: SelectedChatTarget) => SelectedChatLoad = selectedChatLiveReady): Promise<PromptEditor> {
  const app = new PiWebApp();
  const selected = session("selected", "/repo", "Selected session");
  setAppState(app, {
    ...appState({ selectedSession: selected, sessions: [selected], inboxSessions: [selected] }),
    mainView: "chat",
    status: sessionStatus,
    activity: sessionActivity,
    selectedChatLoad: makeLoad(selectedChatTarget("local", selected)),
  });
  const container = document.createElement("div");
  document.body.append(container);
  render(app.render(), container);
  const editor = container.querySelector<PromptEditor>("prompt-editor");
  if (editor === null) throw new Error("Expected prompt editor");
  await editor.updateComplete;
  return editor;
}

function appState(options: {
  selectedProject?: Project;
  selectedWorkspace?: Workspace;
  selectedSession?: SessionInfo;
  sessions: readonly SessionInfo[];
  inboxSessions: readonly SessionInfo[];
}): AppState {
  const selectedWorkspace = options.selectedWorkspace ?? workspace("workspace-main", "project-a", "/repo", "Main");
  const selectedProject = options.selectedProject ?? project(selectedWorkspace.projectId, "Project A");
  return {
    ...initialAppState(),
    machines: [{ id: "local", name: "Local", kind: "local", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" }],
    selectedMachine: { id: "local", name: "Local", kind: "local", createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" },
    projects: [selectedProject],
    selectedProject,
    workspaces: [selectedWorkspace],
    workspacesByProjectId: { [selectedWorkspace.projectId]: [selectedWorkspace] },
    selectedWorkspace,
    selectedSession: options.selectedSession,
    sessions: [...options.sessions],
    globalSessions: { machineId: "local", status: "fresh", sessions: [...options.inboxSessions], statuses: {}, activities: {} },
    selectedChatLoad: options.selectedSession === undefined ? initialAppState().selectedChatLoad : selectedChatLiveReady(selectedChatTarget("local", options.selectedSession)),
  };
}

function project(id: string, name: string): Project {
  return { id, path: `/projects/${id}`, name, createdAt: "2026-08-10T00:00:00.000Z" };
}

function workspace(id: string, projectId: string, path: string, label: string): Workspace {
  return { id, projectId, path, label, isMain: label === "Main", isGitRepo: true, isGitWorktree: false, effectiveConfig: {} };
}

function session(id: string, cwd: string, title: string): SessionInfo {
  return {
    id,
    cwd,
    path: `${cwd}/${id}.jsonl`,
    created: "2026-08-10T00:00:00.000Z",
    modified: "2026-08-10T00:00:00.000Z",
    messageCount: 1,
    firstMessage: title,
  };
}

function setAppState(app: PiWebApp, state: AppState): void {
  if (!Reflect.set(app, "state", state)) throw new Error("Could not set PiWebApp state");
}

function activity(overrides: Partial<SessionActivity> = {}): SessionActivity {
  return {
    sessionId: "selected",
    phase: "active",
    label: "Working",
    at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "selected",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    model: { id: "gpt-5.6-sol", provider: "openai-codex" },
    ...overrides,
  };
}
