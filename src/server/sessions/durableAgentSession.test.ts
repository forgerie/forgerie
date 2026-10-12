import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ModelRuntime, SessionManager, createAgentSessionServices, createCodemodeExtension, defineTool } from "@earendil-works/pi-coding-agent";
import { calculateCost } from "@earendil-works/pi-ai";
import { AssistantEntry, LiveDoc, ToolTask, UsageDoc } from "@earendil-works/pi-durable";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { durableSessionPaths } from "./durableSessionJournal.js";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DurableAgentSession } from "./durableAgentSession.js";
import { createEndTurnToolDefinition } from "./endTurnTool.js";

const directories: string[] = [];
const sessions: DurableAgentSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture(customTools: Parameters<typeof DurableAgentSession.open>[0]["customTools"] = [], codemode = false, defaultTools?: string[], skillFile?: string, keepRecentTokens = 20_000, priced = false, extensionTools: NonNullable<Parameters<typeof DurableAgentSession.open>[0]["customTools"]> = []) {
  const directory = await mkdtemp(join(tmpdir(), "forgerie-durable-session-"));
  directories.push(directory);
  if (skillFile !== undefined) {
    await mkdir(join(directory, "skills", "handoff"), { recursive: true });
    await writeFile(join(directory, "skills", "handoff", "SKILL.md"), skillFile);
  }
  const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: join(directory, "models.json") });
  const provider = fauxProvider({ models: [{ id: "faux-1", cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5 } }] });
  modelRuntime.registerNativeProvider(priced ? { ...provider.provider, streamSimple: (model, transcript, options) => {
    const stream = provider.provider.streamSimple(model, transcript, options);
    const result = stream.result.bind(stream);
    stream.result = async () => { const message = await result(); calculateCost(model, message.usage); return message; };
    return stream;
  } } : provider.provider);
  const model = modelRuntime.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("Configured provider must have a model");
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
      ...(skillFile === undefined ? {} : { additionalSkillPaths: [join(directory, "skills", "handoff", "SKILL.md")] }),
      extensionFactories: [...(codemode ? [{ name: "codemode", factory: createCodemodeExtension() }] : []),
        { name: "registered-test-tools", factory(pi) { for (const tool of extensionTools) pi.registerTool(tool); } }], } });
  services.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens }, ...(defaultTools === undefined ? codemode ? { defaultTools: ["read", "bash", "edit", "write", "+codemode"] } : {} : { defaultTools }) });
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
  it("reuses an idle prompt after its receipt is lost, including after reopen", async () => {
    const { provider, session, services, manager, events } = await fixture();
    provider.setResponses([fauxAssistantMessage("one answer"), fauxAssistantMessage("duplicate answer")]);
    const options = { requestId: "lost-receipt-1" };
    await session.prompt("send once", options);
    // The caller loses the receipt and retries after the original run is idle.
    await session.prompt("send once", options);
    expect(provider.state.callCount).toBe(1);
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
    await vi.waitFor(() => { expect(ends(events).filter((message) => message.role === "user")).toHaveLength(1); });
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    await session.close();
    const reopened = await DurableAgentSession.open({ services, sessionManager: SessionManager.open(file), initialModel: provider.getModel() });
    sessions.push(reopened);
    await reopened.prompt("send once", options);
    expect(provider.state.callCount).toBe(1);
    expect(reopened.messages.filter((message) => message.role === "user")).toHaveLength(1);
    await reopened.prompt("send once", { requestId: "new-send-2" });
    expect(provider.state.callCount).toBe(2);
    expect(reopened.messages.filter((message) => message.role === "user")).toHaveLength(2);
  });

  it.each(["steer", "followUp"] as const)("deduplicates a busy %s input by request ID", async (streamingBehavior) => {
    const { provider, session } = await fixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    provider.setResponses([
      async () => { enter(); await held; return fauxAssistantMessage("first answer"); },
      fauxAssistantMessage("queued answer"),
    ]);
    const running = session.prompt("first input", { requestId: "first-input" });
    try {
      await entered;
      await session.prompt("next input", { requestId: "busy-input", streamingBehavior });
      await session.prompt("next input", { requestId: "busy-input", streamingBehavior });
      expect(session.pendingMessageCount).toBe(1);
    } finally { release(); await running; }
    await session.journal.conversation.waitForIdle(context);
    await session.journal.project();
    expect(provider.state.callCount).toBe(2);
    expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
  });

  it("Durable starts input while manual compaction is still summarizing", async () => {
    const { provider, session } = await fixture([], false, undefined, undefined, 1);
    await session.prompt("seed the context");
    await session.prompt("one more turn");
    let entered!: () => void;
    let release!: () => void;
    const summarizing = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    provider.setResponses([
      async () => { entered(); await held; return fauxAssistantMessage("compacted context"); },
      fauxAssistantMessage("input answered before compaction finishes"),
    ]);
    const compacting = session.compact();
    try {
      await Promise.race([summarizing, compacting.then(() => { throw new Error("Compaction settled without requesting a summary"); })]);
      await session.prompt("input during compaction", { streamingBehavior: "followUp" });
      expect(provider.state.callCount).toBe(4);
      expect(session.messages.filter((message) => message.role === "user")).toHaveLength(3);
      expect(session.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "input answered before compaction finishes" }] });
    } finally { release(); await compacting; }
  });

  it("includes compaction spend while keeping transcript message counts, including after reopen", async () => {
    const { provider, session, manager, services } = await fixture([], false, undefined, undefined, 100, true);
    provider.setResponses([fauxAssistantMessage("A long answer. ".repeat(400)), fauxAssistantMessage("A second answer."), fauxAssistantMessage("The summary of prior work.")]);
    await session.prompt("Remember these details. ".repeat(400));
    await session.prompt("What next?");
    const before = session.getSessionStats();
    expect(before.cost).toBeGreaterThan(0);
    await session.compact();
    expect(provider.state.callCount).toBe(3);
    const ledger = await session.journal.harness.snapshot(UsageDoc, session.journal.conversation.id, context);
    const usage = ledger?.models["faux/faux-1"];
    if (usage === undefined) throw new Error("Compaction must record model usage");
    expect(usage.cost.total).toBeGreaterThan(before.cost);
    const stats = session.getSessionStats();
    expect(stats).toMatchObject({ cost: usage.cost.total, tokens: { input: usage.input, output: usage.output,
      cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, total: usage.totalTokens },
      totalMessages: session.messages.length, userMessages: session.messages.filter(message => message.role === "user").length,
      assistantMessages: session.messages.filter(message => message.role === "assistant").length, toolCalls: 0 });
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    await session.close();
    const reopened = await DurableAgentSession.open({ services, sessionManager: SessionManager.open(file) });
    sessions.push(reopened);
    expect(reopened.getSessionStats().tokens).toEqual(stats.tokens);
    expect(reopened.getSessionStats().cost).toBe(stats.cost);
  });
  it("reports a run-start timestamp failure and continues watching later commits", async () => {
    const { provider, session, errors, events } = await fixture();
    let entered = false;
    provider.setResponses([async (_request, options) => {
      entered = true;
      await new Promise<void>((resolve) => {
        if (options?.signal?.aborted === true) resolve();
        else options?.signal?.addEventListener("abort", () => { resolve(); }, { once: true });
      });
      return fauxAssistantMessage("Interrupted", { stopReason: "aborted" });
    }]);
    await session.journal.conversation.submit({ type: "input", content: "Held run" }, context);
    await vi.waitFor(() => { expect(entered).toBe(true); });
    await vi.waitFor(() => { expect(session.getActiveRunStartedAt()).toBeDefined(); });
    await session.journal.conversation.commit(async (tx) => {
      const live = await tx.doc(LiveDoc, session.journal.conversation.id);
      if (live.run === undefined) throw new Error("Run must be active");
      const input = await tx.createSubmission({ conversationId: session.journal.conversation.id, type: "input", status: "unanswered", reason: "aborted" });
      live.run.inputs = [input.id];
    }, context);
    await vi.waitFor(() => { expect(errors.some((error) => error.includes("has no committed entry"))).toBe(true); });
    expect(session.isStreaming).toBe(true);
    expect(session.getActiveRunStartedAt()).toBeUndefined();
    await session.journal.conversation.configure({ thinkingLevel: "low" }, context);
    await vi.waitFor(() => { expect(events).toContainEqual(expect.objectContaining({ type: "agent_changed" })); });
    await session.abort();
  });

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
  it("ends the run with the text-only reply that follows a silent end_turn refusal", async () => {
    const declare = vi.fn();
    const { provider, session } = await fixture([createEndTurnToolDefinition({ declare })]);
    provider.setResponses([
      fauxAssistantMessage([{ type: "thinking", thinking: "The result is ready." }, fauxToolCall("end_turn", { awaiting: "reply" }, { id: "silent" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("The result is ready. Which fix do you want?"),
    ]);
    await session.prompt("Tell the user the result, then end the run.");
    expect(provider.state.callCount).toBe(2);
    expect(JSON.stringify(session.messages.find(message => message.role === "toolResult" && message.toolName === "end_turn"))).toContain("call no tool");
    expect(session.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "The result is ready. Which fix do you want?" }] });
    expect(declare).not.toHaveBeenCalled();
  });
  it("bounds silent end_turn retries through the production runtime without declaring completion", async () => {
    const declare = vi.fn();
    const { provider, session } = await fixture([createEndTurnToolDefinition({ declare })]);
    provider.setResponses(Array.from({ length: 3 }, (_, index) => fauxAssistantMessage([
      { type: "thinking", thinking: "The result is ready." },
      fauxToolCall("end_turn", { awaiting: "nothing" }, { id: `empty-${String(index)}` }),
    ], { stopReason: "toolUse" })));
    await session.prompt("Tell the user the result, then end the run.");
    expect(provider.state.callCount).toBe(2);
    const results = session.messages.filter(message => message.role === "toolResult" && message.toolName === "end_turn");
    expect(results).toHaveLength(2);
    expect(results.every(message => message.role === "toolResult" && message.isError)).toBe(true);
    expect(JSON.stringify(results.at(-1))).toContain("run stopped");
    expect(declare).not.toHaveBeenCalled();

    // The next actual input gets its own correction budget, not the previous run's exhausted one.
    provider.setResponses([
      fauxAssistantMessage([fauxToolCall("end_turn", { awaiting: "nothing" }, { id: "next-empty" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([{ type: "text", text: "The result is ready." }, fauxToolCall("end_turn", { awaiting: "nothing" }, { id: "corrected" })], { stopReason: "toolUse" }),
    ]);
    await session.prompt("Continue and write visible text.");
    expect(declare).toHaveBeenCalledExactlyOnceWith("nothing");
    expect(session.messages.at(-1)).toMatchObject({ role: "toolResult", toolCallId: "corrected", isError: false });
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
  it("reads every parent ledger bucket without adding child spend or changing message counts", async () => {
    const { session } = await fixture();
    const usage = { input: 3, output: 5, cacheRead: 7, cacheWrite: 11, totalTokens: 26,
      cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 } };
    await session.journal.conversation.commit(async tx => {
      const ledger = await tx.doc(UsageDoc, session.journal.conversation.id);
      ledger.models = { "provider/one": usage, "provider/two": usage };
      ledger.tools = { metered: usage };
    }, context);
    const child = await session.journal.harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    await child.commit(async tx => { (await tx.doc(UsageDoc, child.id)).models = { "provider/child": usage }; }, context);
    expect(session.getSessionStats()).toEqual({ sessionId: session.sessionId, totalMessages: 0, userMessages: 0, assistantMessages: 0,
      toolCalls: 0, tokens: { input: 9, output: 15, cacheRead: 21, cacheWrite: 33, total: 78 }, cost: 3 });
  });
  it("audits SDK implementations, not tool names", async () => {
    const { session } = await fixture([], true, ["read", "ls", "grep", "find", "bash", "edit", "write", "+codemode"]);
    const tools = (await session.journal.conversation.agent(context)).tools;
    expect(Object.fromEntries(tools.map(tool => [tool.name, tool.replay]))).toMatchObject({
      read: "safe", ls: "safe", grep: "unsafe", find: "unsafe", bash: "unsafe", edit: "unsafe", write: "unsafe", codemode: "unsafe",
    });
  });
  it.each(["read", "write", "override"] as const)("recovers a saved %s intent according to its replay policy", async (kind) => {
    let effects = 0;
    const override = defineTool({ name: "read", label: "Override", description: "Effectful override", parameters: Type.Object({ path: Type.String() }),
      execute: () => { effects++; return Promise.resolve({ content: [{ type: "text" as const, text: "effect" }], details: undefined }); } });
    const customTools = kind === "override" ? [override] : [];
    const { session, manager, directory, services } = await fixture(customTools);
    const name = kind === "write" ? "write" : "read";
    const args = kind === "write" ? { path: "output.txt", content: "must not be written" } : { path: "input.txt" };
    const policy = (await session.journal.conversation.agent(context)).tools.find(tool => tool.name === name)?.replay ?? "unsafe";
    // Persist a call and task while scheduling is disabled. Replace its initial phase with the
    // exact durable intent that a process crash leaves behind, using the public Storage contract.
    const taskId = await session.journal.conversation.commit(async tx => {
      const entry = await tx.appendEntry(AssistantEntry, session.journal.conversation.id, {
        model: [fauxAssistantMessage([fauxToolCall(name, args, { id: "crashed-call" })], { stopReason: "toolUse" })],
      });
      return tx.createTask(ToolTask, { assistant: entry.id, callId: "crashed-call" }, { ownership: { kind: "conversation" } });
    }, context);
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    await session.close();
    const storage = await openNodeSqliteStorage(durableSessionPaths(file).database);
    try {
      const task = await storage.task(taskId, context);
      if (task === undefined) throw new Error("Intent task missing");
      await storage.commit([{ type: "task", value: { ...task, memos: {}, state: { status: "running",
        checkpoint: { phase: "execute", arguments: args, replay: policy } } } }], context);
    } finally { await storage.close(context); }
    // A safe read must obtain the post-crash contents, not a saved result.
    await writeFile(join(directory, "input.txt"), "available after crash");
    const recovered = await DurableAgentSession.open({ services, sessionManager: SessionManager.open(file), customTools });
    sessions.push(recovered);
    await recovered.journal.harness.waitForTask(taskId, context);
    await recovered.journal.project();
    const result = recovered.messages.find(message => message.role === "toolResult" && message.toolCallId === "crashed-call");
    expect(result?.role).toBe("toolResult");
    if (kind === "read") expect(result).toMatchObject({ isError: false, content: [{ type: "text", text: "available after crash" }] });
    else {
      expect(result).toMatchObject({ isError: true });
      expect(JSON.stringify(result)).toContain("interrupted");
      expect(effects).toBe(0);
      await expect(readFile(join(directory, "output.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
  it.each(["read", "ls"])("keeps a registered extension override of %s unsafe, including after reload", async name => {
    const override = defineTool({ name, label: "Override", description: "Registered override", parameters: Type.Object({}),
      execute: () => Promise.resolve({ content: [{ type: "text" as const, text: "custom" }], details: undefined }) });
    const { session } = await fixture([], false, undefined, undefined, undefined, false, [override]);
    expect((await session.journal.conversation.agent(context)).tools.find(tool => tool.name === name)?.replay).toBe("unsafe");
    await session.reload();
    expect((await session.journal.conversation.agent(context)).tools.find(tool => tool.name === name)?.replay).toBe("unsafe");
  });
  it("does not grant replay safety to a custom tool that overrides read", async () => {
    const override = defineTool({ name: "read", label: "Effect", description: "A custom read with a write", parameters: Type.Object({}),
      execute: () => Promise.resolve({ content: [{ type: "text" as const, text: "custom" }], details: undefined }) });
    const { session } = await fixture([override]);
    expect((await session.journal.conversation.agent((await import("@earendil-works/chord/context")).BACKGROUND_CONTEXT)).tools.find((tool) => tool.name === "read")?.replay).toBe("unsafe");
  });
});
