import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRuntime, SessionManager, createAgentSessionServices, createCodemodeExtension, defineTool } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { DurableAgentSession } from "./durableAgentSession.js";

const directories: string[] = [];
const sessions: DurableAgentSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture(customTools: Parameters<typeof DurableAgentSession.open>[0]["customTools"] = [], codemode = false, defaultTools?: string[]) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-session-"));
  directories.push(directory);
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider();
  modelRuntime.registerNativeProvider(provider.provider);
  const model = modelRuntime.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("Configured provider must have a model");
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
      ...(codemode ? { extensionFactories: [{ name: "codemode", factory: createCodemodeExtension() }] } : {}) } });
  services.settingsManager.applyOverrides({ compaction: { enabled: false }, ...(defaultTools === undefined ? codemode ? { defaultTools: ["read", "bash", "edit", "write", "+codemode"] } : {} : { defaultTools }) });
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  const session = await DurableAgentSession.open({ services, sessionManager: manager, initialModel: model, customTools });
  sessions.push(session);
  const events: unknown[] = [];
  const errors: string[] = [];
  session.subscribe((event) => events.push(event));
  await session.bindExtensions({ onError: (error) => errors.push(error.error) });
  return { directory, provider, manager, session, events, errors, services };
}

describe("SDK-compatible Durable execution", () => {
  it("executes the SDK read tool through Durable and saves the transcript", async () => {
    const { directory, provider, manager, session, errors } = await fixture();
    await writeFile(join(directory, "input.txt"), "journaled input");
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: "input.txt" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("read complete"),
    ]);
    await session.prompt("read the input");
    expect(provider.state.callCount).toBe(2);
    const result = manager.buildSessionContext().messages.find((message) => message.role === "toolResult");
    expect(result?.content).toEqual([{ type: "text", text: "journaled input" }]);
    expect(session.getSessionStats().toolCalls).toBe(1);
    expect(errors).toEqual([]);
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    expect(await readFile(file, "utf8")).toContain("forgerieDurableEntryId");
  });
  it("preserves turn termination without another model request", async () => {
    const ended = defineTool({ name: "end_turn", label: "End", description: "End the turn", parameters: Type.Object({}),
      execute: () => Promise.resolve({ content: [{ type: "text" as const, text: "done" }], details: { awaiting: "reply" }, terminate: true }) });
    const { provider, session } = await fixture([ended]);
    provider.setResponses([fauxAssistantMessage([fauxToolCall("end_turn", {})], { stopReason: "toolUse" })]);
    await session.prompt("end the turn");
    expect(provider.state.callCount).toBe(1);
    expect(session.messages.some((message) => message.role === "toolResult" && message.toolName === "end_turn")).toBe(true);
  });
  it("runs real QuickJS codemode through the same tool registry", async () => {
    const { directory, provider, session } = await fixture([], true);
    await writeFile(join(directory, "code-input.txt"), "nested read");
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall("codemode", { code: "return await tools.read({path: 'code-input.txt'})" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("script complete"),
    ]);
    await session.prompt("read using a script");
    const result = session.messages.find((message) => message.role === "toolResult" && message.toolName === "codemode");
    expect(result?.role === "toolResult" && result.isError).toBe(false);
    expect(JSON.stringify(result)).toContain("nested read");
    expect(session.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
  });
  it("respects a plain defaultTools allowlist instead of adding it to the built-ins", async () => {
    const { session } = await fixture([], false, ["read"]);
    expect(session.extensionRunner.getActiveTools()).toEqual(["read"]);
  });
  it("respects an empty defaultTools list", async () => {
    const { session } = await fixture([], false, []);
    expect(session.extensionRunner.getActiveTools()).toEqual([]);
  });
  it("rebinds extensions on reload without replacing the native conversation", async () => {
    const { session, provider } = await fixture();
    const oldRunner = session.extensionRunner;
    const conversation = session.journal.conversation.id;
    await session.reload();
    expect(session.extensionRunner).not.toBe(oldRunner);
    expect(session.journal.conversation.id).toBe(conversation);
    provider.setResponses([fauxAssistantMessage("after reload")]);
    await session.prompt("continue after reload");
    expect(provider.state.callCount).toBe(1);
  });
  it("does not grant replay safety to an extension that overrides read", async () => {
    const override = defineTool({ name: "read", label: "Effect", description: "A custom read with a write", parameters: Type.Object({}),
      execute: () => Promise.resolve({ content: [{ type: "text" as const, text: "custom" }], details: undefined }) });
    const { session } = await fixture([override]);
    expect((await session.journal.conversation.agent((await import("@earendil-works/chord/context")).BACKGROUND_CONTEXT)).tools.find((tool) => tool.name === "read")?.replay).toBe("unsafe");
  });
});
