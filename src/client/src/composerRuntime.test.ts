import { describe, expect, it, vi, afterEach } from "vitest";
import { api, type SessionModel } from "./api";
import { createSessionComposerRuntime } from "./composerRuntime";
import type { PromptCompletionTrigger } from "./promptCompletions";

const sonnet: SessionModel = { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" };
const gpt: SessionModel = { provider: "openai", id: "gpt-5.2" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session composer runtime", () => {
  it("requests commands for the session and maps command completions", async () => {
    const commands = vi.spyOn(api, "commands").mockResolvedValue([{ name: "tree", source: "builtin", description: "Browse" }]);
    const runtime = createSessionComposerRuntime({ sessionId: "session-1", cwd: "/repo", machineId: "remote-a" });

    await expect(runtime.resolveCompletion(commandTrigger("/tr", "tr"))).resolves.toEqual([
      { kind: "command", replaceFrom: 0, replaceTo: 3, insertText: "/tree", detail: "builtin", description: "Browse" },
    ]);
    expect(commands).toHaveBeenCalledWith({ id: "session-1", cwd: "/repo" }, "remote-a");
  });

  it("requests files for the workspace and maps file completions", async () => {
    const files = vi.spyOn(api, "files").mockResolvedValue([{ path: "src/index.ts", kind: "tracked" }]);
    const runtime = createSessionComposerRuntime({ machineId: "remote-a", projectId: "project-1", workspaceId: "workspace-1" });

    await expect(runtime.resolveCompletion({ kind: "file", query: "src", from: 5, to: 9, fileScope: "tracked" })).resolves.toEqual([
      { kind: "file", replaceFrom: 5, replaceTo: 9, insertText: "@src/index.ts", detail: "tracked" },
    ]);
    expect(files).toHaveBeenCalledWith("src", { scope: "tracked", machineId: "remote-a", projectId: "project-1", workspaceId: "workspace-1" });
  });

  it("requests models for the session and maps a # token to model completions", async () => {
    const models = vi.spyOn(api, "models").mockResolvedValue({ models: [sonnet, gpt] });
    const runtime = createSessionComposerRuntime({ sessionId: "session-1", cwd: "/repo", machineId: "remote-a" });

    await expect(runtime.resolveCompletion({ kind: "model", query: "cla", from: 11, to: 15 })).resolves.toEqual([
      { kind: "model", replaceFrom: 11, replaceTo: 15, insertText: "#anthropic/claude-sonnet-4-5", detail: "anthropic", description: "Claude Sonnet 4.5" },
    ]);
    expect(models).toHaveBeenCalledWith({ id: "session-1", cwd: "/repo" }, "remote-a");
  });

  it("clears completions on resolver failures or missing context", async () => {
    vi.spyOn(api, "models").mockRejectedValue(new Error("models unavailable"));
    const runtime = createSessionComposerRuntime({ sessionId: "session-1", cwd: "/repo", machineId: "local" });
    const noSessionRuntime = createSessionComposerRuntime({ machineId: "local" });

    await expect(runtime.resolveCompletion({ kind: "model", query: "cla", from: 0, to: 4 })).resolves.toEqual([]);
    await expect(noSessionRuntime.resolveCompletion({ kind: "model", query: "cla", from: 0, to: 4 })).resolves.toEqual([]);
  });
});

function commandTrigger(text: string, query: string): Extract<PromptCompletionTrigger, { kind: "command" }> {
  return { kind: "command", query, from: 0, to: text.length };
}
