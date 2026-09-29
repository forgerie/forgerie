import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createHandoffSessionToolDefinition } from "./handoffSessionTool.js";

const dispatchModel = { provider: "anthropic", id: "claude-sonnet" };

function ctxFor(sessionId: string, sessionFile: string | undefined, model?: unknown, thinkingLevel?: string): ExtensionToolContext {
  const sessionManager = {
    getSessionId: () => sessionId,
    getSessionFile: () => sessionFile,
    getLeafId: () => "leaf-1",
  };
  // The handoff tool reads only the current session identity, file, model, and thinking level.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub with the minimal surface the tool reads.
  return { sessionManager, ...(model === undefined ? {} : { model }), ...(thinkingLevel === undefined ? {} : { thinkingLevel }) } as unknown as ExtensionToolContext;
}

describe("createHandoffSessionToolDefinition", () => {
  it("starts the detached handoff immediately and terminates the source turn", async () => {
    const handoff = vi.fn(() => Promise.resolve({
      handoffId: "handoff-1",
      sourceSessionId: "source-1",
      destinationSessionId: "destination-1",
      cwd: "/repos/a-feature",
      state: "preparing" as const,
    }));
    const tool = createHandoffSessionToolDefinition("/repos/a", { handoff });

    const result = await tool.execute(
      "call-1",
      { focus: "Continue the deployment", cwd: "/repos/a-feature" },
      undefined,
      undefined,
      ctxFor("source-1", "/sessions/source-1.jsonl", dispatchModel, "high"),
    );

    expect(handoff).toHaveBeenCalledWith({
      spawningCwd: "/repos/a",
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: "Continue the deployment",
      cwd: "/repos/a-feature",
      model: dispatchModel,
      thinkingLevel: "high",
    });
    expect(result.terminate).toBe(true);
    expect(result.details).toMatchObject({ destinationSessionId: "destination-1", state: "preparing" });
    const content = result.content[0];
    expect(content?.type).toBe("text");
    expect(content?.type === "text" ? content.text : "").toContain("destination-1");
  });

  it("rejects a handoff before spawning when the source transcript has no file", async () => {
    const handoff = vi.fn();
    const tool = createHandoffSessionToolDefinition("/repos/a", { handoff });

    await expect(tool.execute("call-2", {}, undefined, undefined, ctxFor("source-1", undefined)))
      .rejects.toThrow("Current session transcript is not durable yet");
    expect(handoff).not.toHaveBeenCalled();
  });

  it("inherits cwd and model unless the user provides overrides", async () => {
    const handoff = vi.fn(() => Promise.resolve({
      handoffId: "handoff-2",
      sourceSessionId: "source-1",
      destinationSessionId: "destination-2",
      cwd: "/repos/a",
      model: "openai/gpt-5",
      state: "preparing" as const,
    }));
    const tool = createHandoffSessionToolDefinition("/repos/a", { handoff });

    await tool.execute(
      "call-3",
      { model: "openai/gpt-5" },
      undefined,
      undefined,
      ctxFor("source-1", "/sessions/source-1.jsonl", dispatchModel),
    );

    expect(handoff).toHaveBeenCalledWith({
      spawningCwd: "/repos/a",
      sourceSessionId: "source-1",
      sourceSessionFile: "/sessions/source-1.jsonl",
      sourceLeafId: "leaf-1",
      focus: undefined,
      cwd: undefined,
      model: dispatchModel,
      modelSpec: "openai/gpt-5",
    });
  });
});
