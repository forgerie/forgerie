// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus, Workspace } from "../api";
import { initialAppState } from "../appState";
import { PiWebApp } from "./PiWebApp";
import type { PromptEditor } from "./PromptEditor";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("PiWebApp session guidance", () => {
  it("wires the composer selection to the selected-session controller", async () => {
    const app = new PiWebApp();
    const sessions: unknown = Reflect.get(app, "sessions");
    if (!hasSetGuidance(sessions)) throw new Error("Expected session guidance controller");
    const setGuidance = vi.spyOn(sessions, "setGuidance").mockResolvedValue(true);
    Reflect.set(app, "state", {
      ...initialAppState(),
      selectedSession: session(),
      selectedWorkspace: workspace(),
      sessions: [session()],
      status: status(),
      sessionStatuses: { "session-1": status() },
      mainView: "chat",
    });
    document.body.append(app);
    await app.updateComplete;
    await app.updateComplete;

    const editor = app.shadowRoot?.querySelector<PromptEditor>("prompt-editor");
    if (editor?.onSetGuidance === undefined) throw new Error("Expected wired prompt editor");

    await expect(editor.onSetGuidance("technical-english", true)).resolves.toBe(true);
    expect(setGuidance).toHaveBeenCalledWith("technical-english", true);
  });
});

function hasSetGuidance(value: unknown): value is { setGuidance(entryId: string, enabled: boolean): Promise<boolean> } {
  return typeof value === "object" && value !== null && "setGuidance" in value && typeof value.setGuidance === "function";
}

function session(): SessionInfo {
  return {
    id: "session-1",
    path: "/tmp/session-1.jsonl",
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "",
  };
}

function workspace(): Workspace {
  return {
    id: "workspace-1",
    projectId: "project-1",
    path: "/repo",
    label: "repo",
    isMain: true,
    isGitRepo: true,
    isGitWorktree: false,
    effectiveConfig: {},
  };
}

function status(): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    activeGuidanceIds: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}
