import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ModelRuntime, SessionManager, createAgentSessionServices, createCodemodeExtension, defineTool } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableAgentSession } from "./durableAgentSession.js";

const directories: string[] = [];
const sessions: DurableAgentSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture(customTools: Parameters<typeof DurableAgentSession.open>[0]["customTools"] = [], codemode = false, defaultTools?: string[], skillFile?: string) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-session-"));
  directories.push(directory);
  if (skillFile !== undefined) {
    await mkdir(join(directory, "skills", "handoff"), { recursive: true });
    await writeFile(join(directory, "skills", "handoff", "SKILL.md"), skillFile);
  }
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider();
  modelRuntime.registerNativeProvider(provider.provider);
  const model = modelRuntime.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("Configured provider must have a model");
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
      ...(skillFile === undefined ? {} : { additionalSkillPaths: [join(directory, "skills", "handoff", "SKILL.md")] }),
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

function ends(events: readonly unknown[]): { role: unknown; content: unknown }[] {
  return messagesOfType(events, "message_end");
}
function messagesOfType(events: readonly unknown[], type: "message_start" | "message_end"): { role: unknown; content: unknown }[] {
  return events.flatMap((event) => {
    if (typeof event !== "object" || event === null || !("type" in event) || event.type !== type || !("message" in event)) return [];
    const message = event.message;
    if (typeof message !== "object" || message === null || !("role" in message) || !("content" in message)) return [];
    return [{ role: message.role, content: message.content }];
  });
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
  it("expands a /skill: command in Pi's exact block shape so the browser can show it as a skill", async () => {
    const skill = "---\nname: handoff\ndescription: Hand off the session.\n---\n\n# Handoff\n\nCall the tool.\n";
    const { directory, provider, session } = await fixture([], false, undefined, skill);
    provider.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
    const location = join(directory, "skills", "handoff", "SKILL.md");
    const block = `<skill name="handoff" location="${location}">\nReferences are relative to ${join(directory, "skills", "handoff")}.\n\n# Handoff\n\nCall the tool.\n</skill>`;
    const userTexts = () => session.messages.filter((message) => message.role === "user")
      .map((message) => typeof message.content === "string" ? message.content : message.content.map((part) => part.type === "text" ? part.text : "").join(""));

    await session.prompt("/skill:handoff resize the sidebar");
    await session.prompt("/skill:handoff");

    expect(userTexts()).toEqual([`${block}\n\nresize the sidebar`, block]);
  });
  it("shows a custom message once, as the custom message, not as its model copy", async () => {
    const { provider, session, events } = await fixture();
    provider.setResponses([fauxAssistantMessage("noted")]);
    const content = "<process_event type=\"lifecycle\" kind=\"success\" process_id=\"p\"></process_event>";
    await session.sendCustomMessage({ customType: "ad-process:notification", content, display: true });
    await session.prompt("after the event");
    // Events arrive in commit order, so the answer's end proves the custom write's events were already seen.
    await vi.waitFor(() => { expect(ends(events).some((message) => message.role === "assistant")).toBe(true); });
    const carrying = ends(events).filter((message) => JSON.stringify(message.content).includes("process_event"));
    expect(carrying.map((message) => message.role)).toEqual(["custom"]);
    expect(messagesOfType(events, "message_start").filter((message) => JSON.stringify(message.content).includes("process_event"))).toEqual([]);
  });
  it("resumes an idle session with the notification itself, without adding a user prompt", async () => {
    const { provider, session, manager, events, services } = await fixture();
    const content = "Background work finished.";
    const requests: string[] = [];
    provider.setResponses([fauxAssistantMessage("first answer"), (request) => {
      requests.push(JSON.stringify(request.messages));
      return fauxAssistantMessage("notification handled");
    }]);
    await session.prompt("start work");
    await session.sendCustomMessage({ customType: "test:notification", content, display: true }, { triggerTurn: true });
    await vi.waitFor(() => { expect(ends(events).filter((message) => message.role === "assistant")).toHaveLength(2); });
    expect(provider.state.callCount).toBe(2);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.split(content)).toHaveLength(2);
    expect(requests[0]).not.toContain("Continue with the new message");
    expect(messagesOfType(events, "message_start").filter((message) => JSON.stringify(message.content).includes(content))).toEqual([]);
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(ends(events).filter((message) => JSON.stringify(message.content).includes(content)).map((message) => message.role)).toEqual(["custom"]);
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    await session.close();
    const reopened = await DurableAgentSession.open({ services, sessionManager: SessionManager.open(file), ...(session.model === undefined ? {} : { initialModel: session.model }) });
    sessions.push(reopened);
    expect(reopened.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(reopened.messages.filter((message) => message.role === "custom" && message.customType === "test:notification")).toHaveLength(1);
    expect(JSON.stringify((await reopened.journal.conversation.context(context)).messages).split(content)).toHaveLength(2);
  });
  it.each(["steer", "followUp"] as const)("delivers a busy %s notification at its native boundary without an extra user prompt", async (deliverAs) => {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const held = defineTool({ name: "held", label: "Held", description: "Wait for release", parameters: Type.Object({}),
      execute: async () => { enter(); await released; return { content: [{ type: "text" as const, text: "released" }], details: undefined }; } });
    const { provider, session, events } = await fixture([held]);
    const content = "A background result arrived.";
    const requests: string[] = [];
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall("held", {})], { stopReason: "toolUse" }),
      (request) => {
        requests.push(JSON.stringify(request.messages));
        return fauxAssistantMessage("original work complete");
      },
      (request) => { requests.push(JSON.stringify(request.messages)); return fauxAssistantMessage("follow-up handled"); },
    ]);
    const running = session.prompt("do the work");
    try {
      await entered;
      await session.sendCustomMessage({ customType: "test:notification", content, display: true }, { triggerTurn: true, deliverAs });
      expect(session.pendingMessageCount).toBe(1);
    } finally { release(); }
    await running;
    await session.journal.conversation.waitForIdle(context);
    await session.journal.project();
    await vi.waitFor(() => { expect(provider.state.callCount).toBe(deliverAs === "steer" ? 2 : 3); });
    expect(requests[0]?.includes(content)).toBe(deliverAs === "steer");
    expect(requests.at(-1)?.split(content)).toHaveLength(2);
    expect(messagesOfType(events, "message_start").filter((message) => JSON.stringify(message.content).includes(content))).toEqual([]);
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(JSON.stringify(session.messages)).not.toContain("Continue with the new message");
    expect(ends(events).filter((message) => JSON.stringify(message.content).includes(content)).map((message) => message.role)).toEqual(["custom"]);
  });
  it("keeps next-turn notifications passive even when triggerTurn is true", async () => {
    const { provider, session } = await fixture();
    provider.setResponses([fauxAssistantMessage("seen")]);
    await session.sendCustomMessage({ customType: "test:notification", content: "Read this next turn.", display: true }, { triggerTurn: true, deliverAs: "nextTurn" });
    expect(provider.state.callCount).toBe(0);
    await session.prompt("next user input");
    expect(provider.state.callCount).toBe(1);
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(JSON.stringify((await session.journal.conversation.context(context)).messages)).toContain("Read this next turn.");
  });
  it("does not hide a real user input that has the same content as a notification", async () => {
    const { provider, session, events } = await fixture();
    provider.setResponses([fauxAssistantMessage("notification handled"), fauxAssistantMessage("user answered")]);
    const content = "The same text.";
    await session.sendCustomMessage({ customType: "test:notification", content, display: false }, { triggerTurn: true });
    await session.prompt(content);
    await vi.waitFor(() => { expect(ends(events).filter((message) => message.role === "assistant")).toHaveLength(2); });
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(ends(events).filter((message) => JSON.stringify(message.content).includes(content)).map((message) => message.role)).toEqual(["custom", "user"]);
    expect(messagesOfType(events, "message_start").filter((message) => JSON.stringify(message.content).includes(content)).map((message) => message.role)).toEqual(["user"]);
  });
  it("delivers repeated notifications and image content without a model-only duplicate", async () => {
    const { provider, session } = await fixture();
    const requests: string[] = [];
    provider.setResponses([1, 2].map(() => (request) => { requests.push(JSON.stringify(request.messages)); return fauxAssistantMessage("seen"); }));
    const content = [{ type: "text" as const, text: "Notification with image." }, { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" }];
    await session.sendCustomMessage({ customType: "test:notification", content, display: true }, { triggerTurn: true });
    await session.sendCustomMessage({ customType: "test:notification", content, display: true }, { triggerTurn: true });
    expect(requests.map((request) => request.split("Notification with image.").length - 1)).toEqual([1, 2]);
    expect(requests[0]).toContain("aGVsbG8=");
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(0);
    expect(session.messages.filter((message) => message.role === "custom")).toHaveLength(2);
  });
  it("does not show a user bash command's model copy as a message", async () => {
    const { provider, session, events } = await fixture();
    provider.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("seen")]);
    await session.prompt("before the command");
    await session.executeBash("echo marker-output");
    await session.prompt("after the command");
    await vi.waitFor(() => { expect(ends(events).filter((message) => message.role === "assistant")).toHaveLength(2); });
    expect(ends(events).filter((message) => JSON.stringify(message.content).includes("marker-output"))).toEqual([]);
  });
  it("does not grant replay safety to an extension that overrides read", async () => {
    const override = defineTool({ name: "read", label: "Effect", description: "A custom read with a write", parameters: Type.Object({}),
      execute: () => Promise.resolve({ content: [{ type: "text" as const, text: "custom" }], details: undefined }) });
    const { session } = await fixture([override]);
    expect((await session.journal.conversation.agent((await import("@earendil-works/chord/context")).BACKGROUND_CONTEXT)).tools.find((tool) => tool.name === "read")?.replay).toBe("unsafe");
  });
});
