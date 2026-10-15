import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { ModelRuntime, SessionManager, createAgentSessionServices, createCodemodeExtension, defineTool, type SessionBeforeTreeEvent, type SessionBeforeTreeResult } from "@earendil-works/pi-coding-agent";
import { calculateCost } from "@earendil-works/pi-ai";
import { AssistantEntry, LiveDoc, ToolTask, UsageDoc, defineTask } from "@earendil-works/pi-durable";
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
  vi.restoreAllMocks();
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture(customTools: Parameters<typeof DurableAgentSession.open>[0]["customTools"] = [], codemode = false, defaultTools?: string[], skillFile?: string, keepRecentTokens = 20_000, priced = false, extensionTools: NonNullable<Parameters<typeof DurableAgentSession.open>[0]["customTools"]> = [], contextAppendix?: string, treeHandler?: (event: SessionBeforeTreeEvent) => SessionBeforeTreeResult | Promise<SessionBeforeTreeResult>) {
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
  } } : provider.provider); await modelRuntime.refresh({ allowNetwork: false });
  const model = modelRuntime.getModel("faux", "faux-1");
  if (model === undefined) throw new Error("Configured provider must have a model");
  let contextCalls = 0;
  const services = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
      ...(skillFile === undefined ? {} : { additionalSkillPaths: [join(directory, "skills", "handoff", "SKILL.md")] }),
      extensionFactories: [...(codemode ? [{ name: "codemode", factory: createCodemodeExtension() }] : []),
        { name: "registered-test-tools", factory(pi) {
          for (const tool of extensionTools) pi.registerTool(tool);
          pi.on("session_before_tree", (event) => treeHandler?.(event));
          pi.on("context", (event) => {
            contextCalls++;
            if (contextAppendix !== undefined) return { messages: [...event.messages, { role: "user", content: contextAppendix, timestamp: 1 }] };
            return undefined;
          });
        } }], } });
  services.settingsManager.applyOverrides({ compaction: { enabled: false, keepRecentTokens }, ...(defaultTools === undefined ? codemode ? { defaultTools: ["read", "bash", "edit", "write", "+codemode"] } : {} : { defaultTools }) });
  const manager = SessionManager.create(directory, join(directory, "sessions"));
  const session = await DurableAgentSession.open({ services, sessionManager: manager, initialModel: model, customTools });
  sessions.push(session);
  const events: unknown[] = [];
  const errors: string[] = [];
  session.subscribe((event) => events.push(event));
  await session.bindExtensions({ onError: (error) => errors.push(error.error) });
  return { directory, provider, manager, session, events, errors, services, contextCalls: () => contextCalls };
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
  it("observes parent task graph changes even when child hosting is disabled", async () => {
    const { session, provider, events } = await fixture();
    provider.setResponses([fauxAssistantMessage("done")]);
    events.length = 0;
    await session.prompt("one turn");
    await vi.waitFor(() => { expect(events).toContainEqual({ type: "durable_children_changed" }); });
    expect((await session.taskActivity()).kind).toBe("ready");
  });

  it("keeps the status child count and task projection scoped to the parent's ownership family", async () => {
    const { session } = await fixture();
    const harness = session.journal.harness;
    const parent = session.journal.conversation;
    // An unregistered kind stays live but blocked, without running model or task code.
    const hold = defineTask<null, { phase: "hold" }, null>({ name: "test.unregistered-hold", version: 1, initial: () => ({ phase: "hold" }), phases: { hold: () => Promise.resolve() }, abort: () => Promise.resolve() });
    const anchor = await parent.commit(tx => tx.createTask(hold, null, { ownership: { kind: "conversation" }, background: true }), context);
    const child = await harness.createConversation({ ownership: { kind: "task", taskId: anchor } }, context);
    await child.commit(tx => tx.createTask(hold, null, { ownership: { kind: "conversation" } }), context);
    const sibling = await harness.createConversation({ ownership: { kind: "ownerless" } }, context);
    await sibling.commit(tx => tx.createTask(hold, null, { ownership: { kind: "conversation" } }), context);
    await vi.waitFor(() => { expect(session.workingDurableChildren).toBe(1); });
    const activity = await session.taskActivity();
    expect(activity.backgroundAgents).toBe(session.workingDurableChildren);
    expect(activity.tasks.map(task => task.conversationId)).not.toContain(sibling.id);
  });

  it("dispatches a shared-journal fork's tools and context hooks to the fork, even after its parent closes", async () => {
    const tool = defineTool({ name: "where_am_i", label: "Where", description: "Report logical session", parameters: Type.Object({}),
      execute: (_id, _args, _signal, _update, ctx) => Promise.resolve({ content: [{ type: "text" as const, text: ctx.sessionManager.getSessionId() }], details: undefined }) });
    const { session: parent, provider, services, directory, contextCalls } = await fixture([tool]);
    provider.setResponses([fauxAssistantMessage("parent answer")]);
    await parent.prompt("parent input");
    const leaf = (await parent.getDurableTree()).activeLeafId;
    if (leaf === null) throw new Error("Missing parent tip");
    const manager = SessionManager.create(directory, join(directory, "sessions"));
    const forked = await parent.nativeHistory.fork(leaf, "at", manager.getSessionId(), context);
    let forkContextCalls = 0;
    const forkServices = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime: services.modelRuntime,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true,
        extensionFactories: [{ name: "fork-context", factory(pi) { pi.on("context", () => { forkContextCalls++; }); } }] } });
    forkServices.settingsManager.applyOverrides({ compaction: { enabled: false } });
    const fork = await DurableAgentSession.open({ handle: forked.handle, services: forkServices, sessionManager: manager, customTools: [tool] });
    sessions.push(fork);
    await fork.bindExtensions({});
    expect(fork.journal.harness).toBe(parent.journal.harness);
    const parentContextCalls = contextCalls();
    await parent.close();
    provider.setResponses([fauxAssistantMessage([fauxToolCall("where_am_i", {})], { stopReason: "toolUse" }), fauxAssistantMessage("fork answer")]);
    await fork.prompt("fork input");
    expect(fork.messages.find((message) => message.role === "toolResult")?.content).toEqual([{ type: "text", text: fork.sessionId }]);
    expect(contextCalls()).toBe(parentContextCalls);
    expect(forkContextCalls).toBe(2);
    expect((await parent.journal.conversation.entries({ order: "ascending" }, 100, undefined, context)).items.flatMap((entry) => entry.model ?? []).some((message) => message.role === "toolResult")).toBe(false);
    const address = fork.durableAddress;
    const file = fork.sessionFile;
    if (file === undefined) throw new Error("Fork export must exist");
    await fork.close();
    const reopened = await DurableAgentSession.open({ services: forkServices, sessionManager: SessionManager.open(file), customTools: [tool] });
    sessions.push(reopened);
    expect(reopened.durableAddress).toEqual(address);
    expect(reopened.messages.some((message) => message.role === "toolResult")).toBe(true);
  });

  it("keeps a parent's and fork's active tool declarations, descriptions and replay policies separate", async () => {
    const { session: parent, provider, services, directory } = await fixture([], false, ["read"]);
    await parent.prompt("seed the parent");
    const tip = (await parent.getDurableTree()).activeLeafId;
    if (tip === null) throw new Error("Missing tip");
    const manager = SessionManager.create(directory, join(directory, "sessions"));
    const candidate = await parent.nativeHistory.fork(tip, "at", manager.getSessionId(), context);
    const forkServices = await createAgentSessionServices({ cwd: directory, agentDir: join(directory, "agent"), modelRuntime: services.modelRuntime,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true } });
    forkServices.settingsManager.applyOverrides({ defaultTools: ["bash"], compaction: { enabled: false } });
    const override = defineTool({ name: "read", label: "Fork read", description: "Fork-only read override", defaultActive: false, parameters: Type.Object({}),
      execute: () => Promise.resolve({ content: [{ type: "text" as const, text: "must remain inactive" }], details: undefined }) });
    const fork = await DurableAgentSession.open({ handle: candidate.handle, services: forkServices, sessionManager: manager, customTools: [override] });
    sessions.push(fork);
    await fork.bindExtensions({});
    const parentAgent = await parent.journal.conversation.agent(context);
    const forkAgent = await fork.journal.conversation.agent(context);
    expect(parentAgent.tools.map((tool) => tool.name)).toEqual(["read"]);
    expect(forkAgent.tools.map((tool) => tool.name)).toEqual(["bash"]);
    expect(parentAgent.extensions.filter(item => item.name.startsWith("forgerie.gated-actions:")).map(item => item.name)).toEqual([`forgerie.gated-actions:${String(parent.journal.conversation.id)}`]);
    expect(forkAgent.extensions.filter(item => item.name.startsWith("forgerie.gated-actions:")).map(item => item.name)).toEqual([`forgerie.gated-actions:${String(fork.journal.conversation.id)}`]);
    expect(parentAgent.tools[0]?.description).not.toBe("Fork-only read override");
    expect(parentAgent.tools[0]?.replay).toBe("safe");
    provider.setResponses([fauxAssistantMessage([fauxToolCall("read", {})], { stopReason: "toolUse" }), fauxAssistantMessage("inactive read rejected")]);
    await fork.prompt("try an inactive read");
    expect(fork.messages.find((message) => message.role === "toolResult")?.isError).toBe(true);
    expect((await parent.journal.conversation.agent(context)).tools[0]?.replay).toBe("safe");
    await parent.reload();
    expect((await fork.journal.conversation.agent(context)).tools.map((tool) => tool.name)).toEqual(["bash"]);
  });

  it("selects native continuations without appending their inherited prefix again", async () => {
    const { session, provider } = await fixture();
    provider.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("abandoned answer"), fauxAssistantMessage("new branch answer")]);
    await session.prompt("first input");
    const firstTree = await session.getDurableTree();
    const firstLeaf = firstTree.activeLeafId;
    if (firstLeaf === null) throw new Error("Missing first tip");
    await session.prompt("abandoned input");
    const original = session.journal.conversation;
    const before = (await original.entries({ order: "ascending" }, 100, undefined, context)).items;
    await session.navigateTree(firstLeaf);
    const selected = session.journal.conversation;
    expect(selected.id).not.toBe(original.id);
    const prefix = (await selected.entries({ order: "ascending" }, 100, undefined, context)).items;
    const cut = prefix.at(-1);
    if (cut === undefined) throw new Error("Selected prefix must retain its origin");
    expect(prefix.map((entry) => entry.id)).toEqual(before.filter((entry) => entry.id <= cut.id).map((entry) => entry.id));
    expect(prefix.every((entry) => entry.conversationId !== selected.id)).toBe(true);
    await session.prompt("new branch input");
    const after = (await selected.entries({ order: "ascending" }, 100, undefined, context)).items;
    expect(after.flatMap((entry) => entry.model ?? []).filter((message) => message.role === "user" && message.content === "first input")).toHaveLength(1);
    expect(after.flatMap((entry) => entry.model ?? []).some((message) => message.role === "user" && message.content === "abandoned input")).toBe(false);
    expect(session.messages.some((message) => message.role === "user" && message.content === "abandoned input")).toBe(false);
    expect((await original.entries({ order: "ascending" }, 100, undefined, context)).items).toEqual(before);
  });

  it("reopens an idle selected continuation without restoring the abandoned export leaf", async () => {
    const { session, provider, services } = await fixture();
    provider.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("abandoned answer")]);
    await session.prompt("first input");
    const target = (await session.getDurableTree()).activeLeafId;
    if (target === null) throw new Error("Missing first tip");
    await session.prompt("abandoned input");
    await session.navigateTree(target);
    const address = session.durableAddress;
    const file = session.sessionFile;
    if (file === undefined) throw new Error("Export must exist");
    await session.close();
    const reopened = await DurableAgentSession.open({ services, sessionManager: SessionManager.open(file) });
    sessions.push(reopened);
    expect(reopened.durableAddress).toEqual(address);
    expect(reopened.messages.filter((message) => message.role === "user").map((message) => message.content)).toEqual(["first input"]);
    expect(provider.state.callCount).toBe(2);
  });

  it.each(["provider", "extension"] as const)("appends a successful %s branch summary only to the selected continuation", async (source) => {
    let treeHooks = 0;
    const { session, provider } = await fixture([], false, undefined, undefined, undefined, false, [], undefined, (event) => {
      treeHooks++;
      expect(event.preparation.entriesToSummarize.some((entry) => entry.type === "message" && entry.message.role === "user" && entry.message.content === "abandoned input")).toBe(true);
      return source === "extension" ? { summary: { summary: "abandoned branch summary" } } : {};
    });
    provider.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("abandoned answer"), fauxAssistantMessage("abandoned branch summary")]);
    await session.prompt("first input");
    const target = (await session.getDurableTree()).activeLeafId;
    if (target === null) throw new Error("Missing first tip");
    await session.prompt("abandoned input");
    const original = session.journal.conversation;
    const originalEntries = (await original.entries({ order: "ascending" }, 100, undefined, context)).items;
    await session.navigateTree(target, { summarize: true, customInstructions: "keep the findings" });
    expect(treeHooks).toBe(1);
    expect(provider.state.callCount).toBe(source === "provider" ? 3 : 2);
    expect((await original.entries({ order: "ascending" }, 100, undefined, context)).items).toEqual(originalEntries);
    const summaries = (await session.journal.conversation.entries({ order: "ascending" }, 100, undefined, context)).items.filter((entry) => entry.kind === "forgerie.branch-summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.data).toBe(source === "extension" ? "abandoned branch summary"
      : "The user explored a different conversation branch before returning here.\nSummary of that exploration:\n\nabandoned branch summary");
    expect(summaries[0]?.conversationId).toBe(session.journal.conversation.id);
    expect(session.sessionManager.getBranch().filter((entry) => entry.type === "branch_summary")).toHaveLength(1);
  });

  it("leaves the native selection and entries unchanged when a branch summary hook cancels", async () => {
    const { session, provider } = await fixture([], false, undefined, undefined, undefined, false, [], undefined, () => ({ cancel: true }));
    provider.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("second answer")]);
    await session.prompt("first input");
    const target = (await session.getDurableTree()).activeLeafId;
    if (target === null) throw new Error("Missing first tip");
    await session.prompt("second input");
    const original = session.journal.conversation;
    const entries = (await original.entries({ order: "ascending" }, 100, undefined, context)).items;
    expect(await session.navigateTree(target, { summarize: true })).toEqual({ cancelled: true });
    expect(session.journal.conversation.id).toBe(original.id);
    expect((await original.entries({ order: "ascending" }, 100, undefined, context)).items).toEqual(entries);
    expect(provider.state.callCount).toBe(2);
  });

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

  it("estimates committed model context after compaction rather than the full display history", async () => {
    const { provider, session } = await fixture([], false, undefined, undefined, 100);
    provider.setResponses([fauxAssistantMessage("A long answer. ".repeat(400)), fauxAssistantMessage("A second answer."), fauxAssistantMessage("A short summary.")]);
    await session.prompt("Remember these details. ".repeat(400));
    await session.prompt("What next?");
    const before = session.getContextUsage();
    await session.compact();
    const { estimateTokens } = await import("@earendil-works/pi-coding-agent");
    const native = await session.journal.conversation.context(context);
    const tools = (await session.journal.conversation.agent(context)).tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
    const prompt = session.extensionRunner.createCommandContext().getSystemPrompt();
    const promptTokens = native.messages.some((message) => message.role === "system") ? 0 : Math.ceil((prompt.length + JSON.stringify(tools).length) / 4);
    const expected = native.messages.reduce((total, message) => total + estimateTokens(message), promptTokens);
    expect(session.getContextUsage()).toMatchObject({ tokens: expected, estimate: "next-request" });
    expect(expected).toBeLessThan(before?.tokens ?? 0);
    // A status read must not prepare a request or call the provider again.
    session.getContextUsage(); session.getContextUsage();
    expect(provider.state.callCount).toBe(3);
  });

  it("records the prepared extension-adjusted estimate without running context hooks during status reads", async () => {
    const { session, provider, contextCalls } = await fixture([], false, undefined, undefined, undefined, false, [], "Injected context. ".repeat(1000));
    expect(session.getContextUsage()).toMatchObject({ estimate: "next-request" });
    expect(session.getContextUsage()?.tokens).toBeGreaterThan(0);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    provider.setResponses([async () => { enter(); await held; return fauxAssistantMessage("done"); }]);
    const running = session.prompt("start");
    try {
      await entered;
      await vi.waitFor(() => { expect(session.isStreaming).toBe(true); });
      await session.refreshDurableReads();
      const { estimateTokens } = await import("@earendil-works/pi-coding-agent");
      const native = await session.journal.conversation.context(context);
      const nativeTokens = native.messages.reduce((total, message) => total + estimateTokens(message), 0);
      const usage = session.getContextUsage();
      expect(usage).toMatchObject({ estimate: "prepared-request" });
      expect(usage?.tokens).toBeGreaterThan(nativeTokens);
      session.getContextUsage(); session.getContextUsage();
      expect(contextCalls()).toBe(1);
      expect(provider.state.callCount).toBe(1);
    } finally { release(); await running; }
  });

  it("binds committed parent capabilities and a native tree without using the export as read authority", async () => {
    const { session, provider, manager } = await fixture();
    provider.setResponses([fauxAssistantMessage("native answer")]);
    await session.prompt("native input");
    const address = session.durableAddress;
    expect(address.sessionId).toBe(manager.getSessionId());
    expect(address.conversationId).toBe(session.journal.conversation.id);
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("Fixture must persist");
    await rm(file);
    const tree = await session.getDurableTree();
    expect(tree.nodes.some((node) => node.kind === "user" && node.summary.includes("native input"))).toBe(true);
    const history = await session.parentReadModel.history(undefined, context);
    expect(JSON.stringify(history)).toContain("native answer");
    await session.parentState.setSessionName("Committed native title", context);
    await session.flushDurableMutations();
    await vi.waitFor(() => { expect(session.parentAppSnapshot.sessionName).toBe("Committed native title"); });
    expect(provider.state.callCount).toBe(1);
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

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { PiSessionService } from "./piSessionService.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import { registerSessionRoutes } from "./sessionRoutes.js";
import { emptyArchiveStore, sessionGateway } from "./piSessionService.testSupport.js";

it("opens the production Durable facade without a native reader and labels its existing sequential cut", async () => {
  const { session, provider, manager, services, directory } = await fixture();
  const hub = new SessionEventHub();
  const service = new PiSessionService(hub, { agentDir: join(directory, "agent"), modelRuntime: services.modelRuntime,
    sessionManager: { ...sessionGateway([]), create: () => manager }, archiveStore: emptyArchiveStore(),
    createAgentRuntime: () => Promise.resolve({ session, cwd: directory, setRebindSession: () => { /* This fixture never replaces its facade. */ }, fork: () => Promise.reject(new Error("Not exercised")), dispose: () => Promise.resolve() }), heartbeatIntervalMs: 60_000 });
  const app = Fastify(); await app.register(websocket); registerSessionRoutes(app, service, hub);
  try {
    await service.start(directory);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    provider.setResponses([async () => { await held; return fauxAssistantMessage("finished during the open"); }]);
    const prompting = session.prompt("production facade input");
    await vi.waitFor(() => { expect(session.isStreaming).toBe(true); });
    const original = service.streamSnapshot.bind(service);
    vi.spyOn(service, "streamSnapshot").mockImplementationOnce(async ref => {
      const snapshot = await original(ref);
      release(); await prompting;
      await vi.waitFor(() => { expect(session.isStreaming).toBe(false); });
      return snapshot;
    });
    const response = await app.inject({ url: `/sessions/${session.sessionId}/open?${new URLSearchParams({ cwd: directory, limit: "50" })}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ readPath: "classic", cut: "sequential", session: { id: session.sessionId, cwd: directory }, status: { isStreaming: false } });
    const result = response.json<{ seq: number; snapshot: { seq: number }; statusSeq: number }>();
    expect(result.snapshot.seq).toBe(result.seq);
    expect(result.statusSeq).toBeGreaterThanOrEqual(result.seq);
  } finally { await app.close(); await service.dispose(); }
});


import { createActiveDurableSessionReader } from "../sessiond/durableSessionReader.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { createPiSessionManagerGateway } from "./piSessionManagerGateway.js";
import type { SessionOpenResult } from "./sessionOpen.js";
import { WebSocket } from "ws";
import { z } from "zod";
import { createSessionOpenSchema } from "../../shared/sessionOpen.js";
import { durableBrowserMessageSchema } from "../../shared/durableBrowserSnapshot.js";

it("reads a native reply and tool completion during preparation while the SDK event line is stalled, then streams strictly after the cut", async () => {
  const tool = defineTool({ name: "checkpoint_tool", label: "Checkpoint", description: "Complete a tool", parameters: Type.Object({}),
    execute: () => Promise.resolve({ content: [{ type: "text" as const, text: "tool completed" }], details: undefined }) });
  const { session, provider, manager, services, directory } = await fixture([tool]);
  const hub = new SessionEventHub();
  const reader = createActiveDurableSessionReader(ref => service.activeDurableRead(ref));
  const service = new PiSessionService(hub, { agentDir: join(directory, "agent"), modelRuntime: services.modelRuntime, durableReader: reader,
    sessionManager: { ...sessionGateway([]), create: () => manager }, archiveStore: emptyArchiveStore(),
    createAgentRuntime: () => Promise.resolve({ session, cwd: directory, setRebindSession: () => { /* This test retains its original facade. */ }, fork: () => Promise.reject(new Error("Not exercised")), dispose: () => Promise.resolve() }), heartbeatIntervalMs: 60_000 });
  const app = Fastify(); await app.register(websocket); registerSessionRoutes(app, service, hub);
  let releaseProvider!: () => void, releaseSdk!: () => void;
  const heldProvider = new Promise<void>(resolve => { releaseProvider = resolve; });
  const heldSdk = new Promise<void>(resolve => { releaseSdk = resolve; });
  const nativeOpenSchema = createSessionOpenSchema(durableBrowserMessageSchema, z.unknown());
  const frames: z.infer<typeof nativeOpenSchema>[] = [];
  let socket: WebSocket | undefined;
  const eventTypes: string[] = [];
  try {
    await service.start(directory);
    provider.setResponses([async () => { await heldProvider; return fauxAssistantMessage([fauxToolCall("checkpoint_tool", {}, { id: "checkpoint-call" })], { stopReason: "toolUse" }); }, fauxAssistantMessage("finished during native open")]);
    const prompting = session.prompt("native cut input");
    await vi.waitFor(() => { expect(session.isStreaming).toBe(true); });
    const refresh = session.refreshDurableReads.bind(session);
    vi.spyOn(session, "refreshDurableReads").mockImplementation(async () => { await heldSdk; await refresh(); });
    const acquireRead = DurableSessionJournal.pool.acquireRead.bind(DurableSessionJournal.pool);
    vi.spyOn(DurableSessionJournal.pool, "acquireRead").mockImplementationOnce(async (address, ctx) => {
      const handle = await acquireRead(address, ctx);
      const entries = handle.conversation.entries.bind(handle.conversation);
      vi.spyOn(handle.conversation, "entries").mockImplementationOnce(async (...args) => {
        releaseProvider();
        await vi.waitFor(async () => { expect((await session.journal.harness.snapshot(LiveDoc, session.journal.conversation.id, context))?.run).toBeUndefined(); });
        return entries(...args);
      });
      return handle;
    });
    const response = await app.inject({ url: `/sessions/${session.sessionId}/open?${new URLSearchParams({ cwd: directory, limit: "50" })}` });
    expect(response.statusCode).toBe(200);
    const cut = response.json<SessionOpenResult>();
    expect(cut).toMatchObject({ readPath: "native", cut: "native", snapshot: { partial: null }, status: { isStreaming: false } });
    expect(cut.page.messages.map(message => message.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(cut.page.messages[1]?.content).toMatchObject([{ type: "toolCall", id: "checkpoint-call" }]);
    expect(cut.page.messages[2]?.content).toMatchObject([{ type: "text", text: "tool completed" }]);
    expect(cut.page.messages[3]?.content).toMatchObject([{ type: "text", text: "finished during native open" }]);
    expect(new Set(cut.page.messages.map(message => message.id)).size).toBe(4);
    expect(session.isStreaming).toBe(true); // The SDK projection is deliberately not the cut authority.
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    socket = new WebSocket(`${origin.replace("http:", "ws:")}/sessions/${session.sessionId}/events?${new URLSearchParams({ cwd: directory, native: "1", open: "1" })}`);
    socket.on("message", data => {
      const raw: unknown = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : new TextDecoder().decode(data instanceof ArrayBuffer ? data : Buffer.concat(data)));
      const frame = z.object({ type: z.string(), open: nativeOpenSchema.optional() }).parse(raw);
      eventTypes.push(frame.type);
      if (frame.type === "session.open" && frame.open !== undefined) frames.push(frame.open);
    });
    await vi.waitFor(() => { expect(frames[0]).toBeDefined(); });
    const baseline = frames.at(-1);
    expect(baseline?.page.messages).toEqual(cut.page.messages);
    const beforeNext = frames.length;
    releaseSdk(); await prompting;
    await vi.waitFor(() => { expect(session.isStreaming).toBe(false); });
    provider.setResponses([fauxAssistantMessage("next reply")]);
    await session.prompt("next input");
    await vi.waitFor(() => { expect(frames.at(-1)?.page.messages).toHaveLength(6); });
    const later = frames.slice(beforeNext);
    expect(later.every(frame => frame.seq > cut.seq)).toBe(true);
    expect(frames.every((frame, index) => index === 0 || frame.seq > (frames[index - 1]?.seq ?? -1))).toBe(true);
    expect(later.every(frame => frame.page.messages.slice(0, 4).map(message => message.id).join() === cut.page.messages.map(message => message.id).join())).toBe(true);
    expect(frames.at(-1)?.page.messages.map(message => message.role)).toEqual(["user", "assistant", "toolResult", "assistant", "user", "assistant"]);
    const messages = await service.messages({ id: session.sessionId, cwd: directory });
    expect(messages.messages).toEqual(frames.at(-1)?.page.messages);
    const tree = await service.tree({ id: session.sessionId, cwd: directory });
    const transcriptIds = frames.at(-1)?.page.messages.map(message => message.id);
    expect(tree.tree.nodes.filter(node => ["user", "assistant", "tool-result"].includes(node.kind)).map(node => node.id)).toEqual(transcriptIds);
    expect(tree.tree.activePathIds.filter(id => transcriptIds?.includes(id) === true)).toEqual(transcriptIds);
    expect(eventTypes).not.toContain("message.end");
    expect(eventTypes).not.toContain("tool.end");
    expect(eventTypes).not.toContain("status.update");
  } finally {
    releaseProvider(); releaseSdk();
    if (socket !== undefined && socket.readyState !== WebSocket.CLOSED) await new Promise<void>(resolve => { socket?.once("close", () => { resolve(); }); socket?.close(); });
    await app.close(); await service.dispose();
  }
});

it("keeps inactive native admission read-only and gives a later Durable runtime its own execution hooks", async () => {
  const { session, provider, services, manager, directory, contextCalls } = await fixture();
  provider.setResponses([fauxAssistantMessage("saved before closing")]);
  await session.prompt("saved input");
  const file = manager.getSessionFile();
  if (file === undefined) throw new Error("Missing session file");
  await session.close();
  const hub = new SessionEventHub();
  const reader = createActiveDurableSessionReader(ref => service.activeDurableRead(ref));
  const gateway = createPiSessionManagerGateway({ agentDir: join(directory, "agent"), env: { TEST_SESSION_DIR: join(directory, "sessions") }, sessionDirEnvKeys: ["TEST_SESSION_DIR"] });
  const service = new PiSessionService(hub, { agentDir: join(directory, "agent"), modelRuntime: services.modelRuntime, durableReader: reader, sessionManager: gateway, archiveStore: emptyArchiveStore(), heartbeatIntervalMs: 60_000 });
  const acquire = vi.spyOn(DurableSessionJournal.pool, "acquire");
  const acquireRead = vi.spyOn(DurableSessionJournal.pool, "acquireRead");
  try {
    const ref = { id: session.sessionId, cwd: directory };
    const opened = await service.open(ref, { limit: 50 });
    expect(opened).toMatchObject({ readPath: "classic", cut: "classic", snapshot: { partial: null }, status: { isStreaming: false } });
    expect(opened.page.messages.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(await service.attachOpenBrowser(ref, async () => { /* An inactive session cannot send a native seed. */ }, () => { /* No native failure expected. */ })).toBeUndefined();
    expect(acquire).not.toHaveBeenCalled(); expect(acquireRead).not.toHaveBeenCalled();
    const before = contextCalls();
    const reopened = await DurableAgentSession.open({ services, sessionManager: SessionManager.open(file) }); sessions.push(reopened);
    await reopened.bindExtensions({});
    reopened.subscribe(() => { /* Binding owns observation; assertions read the public state. */ });
    provider.setResponses([fauxAssistantMessage("execution hooks preserved")]);
    await reopened.prompt("later input");
    expect(contextCalls()).toBeGreaterThan(before);
    expect(reopened.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "execution hooks preserved" }] });
    expect(acquire).toHaveBeenCalledTimes(1); expect(acquireRead).not.toHaveBeenCalled();
  } finally { acquire.mockRestore(); acquireRead.mockRestore(); await service.dispose(); }
});

it("returns an active native owner-close error instead of reopening a family or silently choosing classic", async () => {
  const { session, manager, services, directory } = await fixture();
  const hub = new SessionEventHub();
  const reader = createActiveDurableSessionReader(ref => service.activeDurableRead(ref));
  const service = new PiSessionService(hub, { agentDir: join(directory, "agent"), modelRuntime: services.modelRuntime, durableReader: reader,
    sessionManager: { ...sessionGateway([]), create: () => manager }, archiveStore: emptyArchiveStore(),
    createAgentRuntime: () => Promise.resolve({ session, cwd: directory, setRebindSession: () => { /* This test retains its original facade. */ }, fork: () => Promise.reject(new Error("Not exercised")), dispose: () => Promise.resolve() }), heartbeatIntervalMs: 60_000 });
  const original = DurableSessionJournal.pool.acquireRead.bind(DurableSessionJournal.pool);
  const acquire = vi.spyOn(DurableSessionJournal.pool, "acquireRead").mockImplementationOnce(async (address, ctx) => {
    await session.close(); return original(address, ctx);
  });
  try {
    await service.start(directory);
    await expect(service.open({ id: session.sessionId, cwd: directory }, { limit: 50 })).rejects.toThrow("Active Durable read owner closed");
    expect(acquire).toHaveBeenCalledTimes(1);
  } finally { acquire.mockRestore(); await service.dispose(); }
});


it("keeps an inactive classic route when the Durable session activates during preparation, then routes the next read natively", async () => {
  const { session, provider, services, directory } = await fixture();
  provider.setResponses([fauxAssistantMessage("saved answer")]); await session.prompt("saved input");
  const hub = new SessionEventHub();
  const reader = createActiveDurableSessionReader(ref => service.activeDurableRead(ref));
  const gateway = createPiSessionManagerGateway({ agentDir: join(directory, "agent"), env: { TEST_SESSION_DIR: join(directory, "sessions") }, sessionDirEnvKeys: ["TEST_SESSION_DIR"] });
  const service = new PiSessionService(hub, { agentDir: join(directory, "agent"), modelRuntime: services.modelRuntime, durableReader: reader, sessionManager: gateway, archiveStore: emptyArchiveStore(),
    createAgentRuntime: () => Promise.resolve({ session, cwd: directory, setRebindSession: () => { /* This test retains its original facade. */ }, fork: () => Promise.reject(new Error("Not exercised")), dispose: () => Promise.resolve() }), heartbeatIntervalMs: 60_000 });
  const catalog = service.unreadCatalog.bind(service);
  vi.spyOn(service, "unreadCatalog").mockImplementationOnce(async () => { await service.start(directory); return catalog(); });
  const acquireRead = vi.spyOn(DurableSessionJournal.pool, "acquireRead");
  try {
    const ref = { id: session.sessionId, cwd: directory };
    const classic = await service.open(ref, { limit: 50 });
    expect(classic).toMatchObject({ readPath: "classic", cut: "classic" });
    expect(classic.page.messages.map(message => message.role)).toEqual(["user", "assistant"]);
    expect(acquireRead).not.toHaveBeenCalled();
    const native = await service.open(ref, { limit: 50 });
    expect(native).toMatchObject({ readPath: "native", cut: "native" });
    expect(acquireRead).toHaveBeenCalledTimes(1);
    expect(native.page.messages.map(message => message.role)).toEqual(["user", "assistant"]);
  } finally { await service.dispose(); }
});
