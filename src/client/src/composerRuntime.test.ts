import { describe, expect, it, vi, afterEach } from "vitest";
import { api, workspacesApi, type SessionModel } from "./api";
import { createPreSessionComposerRuntime, createSessionComposerRuntime } from "./composerRuntime";
import type { PromptCompletionTrigger } from "./promptCompletions";

const sonnet: SessionModel = { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" };
const gpt: SessionModel = { provider: "openai", id: "gpt-5.2" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pre-session composer runtime", () => {
  it("lists destination prompt resources and files but not models", async () => {
    const identity = { source: "prompt" as const, name: "review", fingerprint: "a".repeat(64) };
    const catalog = vi.spyOn(workspacesApi, "promptResourceCatalog").mockResolvedValue({
      available: true,
      diagnostics: [],
      commands: [
        { name: "review", source: "prompt", description: "Review code", identity },
        { name: "audit", source: "skill", identity: { source: "skill", name: "audit", fingerprint: "b".repeat(64) } },
      ],
    });
    const files = vi.spyOn(api, "files").mockResolvedValue([{ path: "src/index.ts", kind: "tracked" }]);
    const runtime = createPreSessionComposerRuntime({ machineId: "remote-a", projectId: "project-1", workspaceId: "workspace-1" });

    await expect(runtime.resolveCompletion(commandTrigger("/re", "re"))).resolves.toEqual([
      { kind: "command", replaceFrom: 0, replaceTo: 3, insertText: "/review", detail: "prompt", description: "Review code", promptResourceCommandIdentity: identity },
    ]);
    await expect(runtime.resolveCompletion({ kind: "file", query: "src", from: 5, to: 9, fileScope: "tracked" })).resolves.toEqual([
      { kind: "file", replaceFrom: 5, replaceTo: 9, insertText: "@src/index.ts", detail: "tracked" },
    ]);
    await expect(runtime.resolveCompletion({ kind: "model", query: "cla", from: 0, to: 4 })).resolves.toEqual([]);

    expect(runtime.supportedCompletionKinds).toEqual(new Set(["command", "file"]));
    expect(runtime.inputModeForDraft("!echo should stay literal")).toEqual({ kind: "normal" });
    expect(runtime.inputModeForDraft("!!echo should stay literal")).toEqual({ kind: "normal" });
    expect(runtime.inputModeForDraft("/review")).toEqual({ kind: "command" });
    expect(catalog).toHaveBeenCalledWith("project-1", "workspace-1", "remote-a");
    expect(files).toHaveBeenCalledWith("src", { scope: "tracked", machineId: "remote-a", projectId: "project-1", workspaceId: "workspace-1" });
  });

  it("exposes no destination providers until the destination is complete", async () => {
    const catalog = vi.spyOn(workspacesApi, "promptResourceCatalog").mockResolvedValue({ available: true, commands: [], diagnostics: [] });
    const files = vi.spyOn(api, "files").mockResolvedValue([]);
    const runtime = createPreSessionComposerRuntime({ machineId: "local" });

    expect(runtime.supportedCompletionKinds).toEqual(new Set());
    await expect(runtime.resolveCompletion(commandTrigger("/re", "re"))).resolves.toEqual([]);
    await expect(runtime.resolveCompletion({ kind: "file", query: "src", from: 5, to: 9, fileScope: "tracked" })).resolves.toEqual([]);
    expect(catalog).not.toHaveBeenCalled();
    expect(files).not.toHaveBeenCalled();
  });

  it("distinguishes provider failure from successful zero matches", async () => {
    vi.spyOn(workspacesApi, "promptResourceCatalog").mockResolvedValueOnce({ available: true, commands: [], diagnostics: [] });
    const runtime = createPreSessionComposerRuntime({ machineId: "local", projectId: "project-1", workspaceId: "workspace-1" });

    await expect(runtime.resolveCompletion(commandTrigger("/re", "re"))).resolves.toEqual([]);

    vi.spyOn(workspacesApi, "promptResourceCatalog").mockResolvedValueOnce({ available: false, reason: "busy", message: "busy" });
    await expect(runtime.resolveCompletion(commandTrigger("/re", "re"))).rejects.toThrow("busy");
  });
});

describe("session composer runtime", () => {
  it("requests commands for the session and maps command completions", async () => {
    const commands = vi.spyOn(api, "commands").mockResolvedValue([{ name: "tree", source: "builtin", description: "Browse" }]);
    const runtime = createSessionComposerRuntime({ sessionId: "session-1", cwd: "/repo", machineId: "remote-a" });

    await expect(runtime.resolveCompletion(commandTrigger("/tr", "tr"))).resolves.toEqual([
      { kind: "command", replaceFrom: 0, replaceTo: 3, insertText: "/tree", detail: "builtin", description: "Browse" },
    ]);
    expect(commands).toHaveBeenCalledWith({ id: "session-1", cwd: "/repo" }, "remote-a");
    expect(runtime.inputModeForDraft("!echo active")).toEqual({ kind: "shell", excludeFromContext: false });
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

  it("distinguishes session provider failures from missing context", async () => {
    vi.spyOn(api, "commands").mockRejectedValue(new Error("commands unavailable"));
    vi.spyOn(api, "models").mockRejectedValue(new Error("models unavailable"));
    const runtime = createSessionComposerRuntime({ sessionId: "session-1", cwd: "/repo", machineId: "local" });
    const noSessionRuntime = createSessionComposerRuntime({ machineId: "local" });

    await expect(runtime.resolveCompletion(commandTrigger("/tr", "tr"))).rejects.toThrow("commands unavailable");
    await expect(runtime.resolveCompletion({ kind: "model", query: "cla", from: 0, to: 4 })).rejects.toThrow("models unavailable");
    await expect(noSessionRuntime.resolveCompletion(commandTrigger("/tr", "tr"))).resolves.toEqual([]);
    await expect(noSessionRuntime.resolveCompletion({ kind: "model", query: "cla", from: 0, to: 4 })).resolves.toEqual([]);
  });
});

function commandTrigger(text: string, query: string): Extract<PromptCompletionTrigger, { kind: "command" }> {
  return { kind: "command", query, from: 0, to: text.length };
}
