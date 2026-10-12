import { randomUUID } from "node:crypto";
import type { AgentTool, AgentToolCallOutcome, AgentToolResult } from "@earendil-works/pi-agent-core";
import { defineTool as sdkDefineTool, createReadToolDefinition, createBashToolDefinition, createEditToolDefinition, createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, wrapRegisteredTool, createSyntheticSourceInfo, type ExtensionRunner, type SettingsManager, type ToolDefinition, type ExecuteToolOptions } from "@earendil-works/pi-coding-agent";
import { defineExtension, defineTool, type ConversationId, type Extension, type ToolRegistration } from "@earendil-works/pi-durable";
import { Value } from "typebox/value";
import { durableJson } from "./durableJson.js";
import { isChildNativeTool } from "./durableChildRuntime.js";

// These tools act on the parent session or its approval surfaces, not a child conversation.
const PARENT_ONLY = new Set(["child_agent", "ask_user", "end_turn", "spawn_session", "handoff_session", "workflow_finish", "workflow_stop", "propose_workflow", "subagent", "bg_wait", "web_enable"]);
// Agent files translate these to child-native bash; never share the parent's implementations.
const CHILD_TRANSLATED = new Set(["grep", "find", "ls"]);
function shareWithChild(tool: ToolDefinition, deny: readonly string[]): boolean {
  return !isChildNativeTool(tool.name) && !CHILD_TRANSLATED.has(tool.name) && !PARENT_ONLY.has(tool.name) && !tool.name.startsWith("propose_")
    && tool.exposure !== "model-only" && tool.exposure !== "hidden" && !deny.includes(tool.name);
}

export interface DurableSdkToolsOptions {
  cwd: string;
  settings: SettingsManager;
  runner: ExtensionRunner;
  customTools: readonly ToolDefinition[];
  beforeCall(): Promise<void>;
  emit(event: unknown): void;
}

/** One registry for direct and codemode calls. Neither path constructs an Agent or AgentSession. */
export class DurableSdkTools {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly callable = new Map<string, AgentTool>();
  private readonly replaySafe = new Set<string>();
  private active: string[] = [];
  private readonly nestedCounts = new Map<string, number>();
  private initialized = false;
  private activatedOnRegistration = new Set<string>();

  constructor(private readonly options: DurableSdkToolsOptions) { this.refresh(); }

  refresh(): void {
    const { cwd, settings, runner } = this.options;
    const commandPrefix = settings.getShellCommandPrefix();
    const shellPath = settings.getShellPath();
    // Replay policy is paired with the concrete factory. Names do not establish safety.
    const base: { definition: ToolDefinition; replay: "safe" | "unsafe" }[] = [
      { definition: sdkDefineTool(createReadToolDefinition(cwd, { autoResizeImages: settings.getImageAutoResize() })), replay: "safe" }, // Reads files; image transforms stay in memory.
      { definition: sdkDefineTool(createBashToolDefinition(cwd, { ...(commandPrefix === undefined ? {} : { commandPrefix }), ...(shellPath === undefined ? {} : { shellPath }) })), replay: "unsafe" }, // Arbitrary commands.
      { definition: sdkDefineTool(createEditToolDefinition(cwd)), replay: "unsafe" }, // Writes files.
      { definition: sdkDefineTool(createWriteToolDefinition(cwd)), replay: "unsafe" }, // Writes files.
      // Both call ensureTool(), which can download and install executables in the Pi profile.
      { definition: sdkDefineTool(createGrepToolDefinition(cwd)), replay: "unsafe" },
      { definition: sdkDefineTool(createFindToolDefinition(cwd)), replay: "unsafe" },
      { definition: sdkDefineTool(createLsToolDefinition(cwd)), replay: "safe" }, // Only filesystem existence/stat/readdir.
    ];
    const previouslyActive = this.active;
    this.definitions.clear();
    this.replaySafe.clear();
    for (const { definition, replay } of base) {
      this.definitions.set(definition.name, definition);
      if (replay === "safe") this.replaySafe.add(definition.name);
    }
    // The SDK has no replay contract for extensions/custom tools. Unreviewed tools and
    // same-name overrides fail closed, including codemode, which can call effectful tools.
    for (const tool of runner.getAllRegisteredTools()) { this.definitions.set(tool.definition.name, tool.definition); this.replaySafe.delete(tool.definition.name); }
    for (const definition of this.options.customTools) { this.definitions.set(definition.name, definition); this.replaySafe.delete(definition.name); }
    this.definitions.delete("question");
    this.callable.clear();
    for (const definition of this.definitions.values()) {
      this.callable.set(definition.name, wrapRegisteredTool({ definition, sourceInfo: createSyntheticSourceInfo(`<durable:${definition.name}>`, { source: "sdk" }) }, runner));
    }
    // SettingsManager already resolves +name/-name. A plain list replaces the defaults, including an empty list.
    const selection = new Set(this.initialized ? previouslyActive : settings.getDefaultTools() ?? ["read", "bash", "edit", "write"]);
    const registered = [...runner.getAllRegisteredTools().map((item) => item.definition), ...this.options.customTools];
    const newlyDeclarable = new Set(registered.filter((tool) => tool.defaultActive !== false
      && (tool.exposure === undefined || tool.exposure === "direct" || tool.exposure === "model-only")).map((tool) => tool.name));
    for (const name of newlyDeclarable) if (!this.activatedOnRegistration.has(name)) selection.add(name);
    this.activatedOnRegistration = newlyDeclarable;
    this.initialized = true;
    this.setActive([...selection]);
  }

  getDefinitions(): readonly ToolDefinition[] { return [...this.definitions.values()]; }
  getCallable(): readonly AgentTool[] {
    return [...this.callable.values()].filter((tool) => {
      const exposure = this.definitions.get(tool.name)?.exposure ?? "direct";
      return exposure === "codemode" || exposure === "deferred" || (exposure === "direct" && this.active.includes(tool.name));
    });
  }
  getActive(): string[] { return [...this.active]; }
  setActive(names: readonly string[]): void {
    this.active = [...new Set(names)].filter((name) => {
      const tool = this.definitions.get(name);
      return tool !== undefined && tool.exposure !== "hidden";
    });
  }

  extension(dispatch?: (conversationId: ConversationId) => DurableSdkTools, extensionName = "forgerie.sdk-tools"): Extension {
    const declared = this.active.flatMap((name) => { const tool = this.callable.get(name); return tool === undefined ? [] : [tool]; });
    const hidden = new Set<string>();
    const descriptions = new Map<string, string>();
    for (const name of this.active) {
      const change = this.definitions.get(name)?.prepareLoadout?.({
        declared, callable: this.getCallable(), registered: [...this.callable.values()],
        getExposure: (tool) => this.definitions.get(tool)?.exposure ?? "direct",
        getNamespace: (tool) => this.definitions.get(tool)?.namespace,
        getPromptGuidelines: (tool) => this.definitions.get(tool)?.promptGuidelines ?? [],
      });
      for (const tool of change?.hiddenDeclarations ?? []) hidden.add(tool);
      for (const [tool, description] of Object.entries(change?.descriptions ?? {})) descriptions.set(tool, description);
    }
    const tools: ToolRegistration[] = this.active.filter((name) => {
      const exposure = this.definitions.get(name)?.exposure ?? "direct";
      return !hidden.has(name) && (exposure === "direct" || exposure === "model-only");
    }).map((name) => {
      const definition = this.definitions.get(name);
      if (definition === undefined) throw new Error(`Missing active tool: ${name}`);
      return defineTool({
        name, description: descriptions.get(name) ?? definition.description, parameters: definition.parameters,
        ...(definition.prepareArguments === undefined ? {} : { prepareArguments: definition.prepareArguments }),
        ...(definition.executionMode === undefined ? {} : { executionMode: definition.executionMode }),
        // A custom override named read is not automatically safe. Safety belongs to the implementation.
        replay: this.replaySafe.has(name) ? "safe" : "unsafe",
        execute: async (args, api, context) => {
          const target = dispatch?.(api.conversationId) ?? this;
          const outcome = await target.execute(api.callId, name, args, context.abortSignal, undefined, async (partial) => {
            await api.details(durableJson(partial), context);
          });
          return {
            content: outcome.result.content,
            isError: outcome.isError,
            ...(outcome.result.details === undefined ? {} : { details: durableJson(outcome.result.details) }),
            ...(outcome.result.usage === undefined ? {} : { usage: outcome.result.usage }),
            ...(outcome.result.terminate === true ? { control: { terminate: true as const } } : {}),
          };
        },
      });
    });
    return defineExtension({ name: extensionName, tools });
  }

  /** Snapshot declarations, but resolve and check the live session registry again for every call (including reload). */
  childTools(current: () => DurableSdkTools, deny: readonly string[]): ToolRegistration[] {
    return this.getDefinitions().filter((tool) => shareWithChild(tool, deny)).map((definition) => defineTool({
      name: definition.name, description: definition.description, parameters: definition.parameters,
      ...(definition.prepareArguments === undefined ? {} : { prepareArguments: definition.prepareArguments }),
      ...(definition.executionMode === undefined ? {} : { executionMode: definition.executionMode }),
      replay: "unsafe",
      execute: async (args, api, context) => {
        const tools = current();
        const live = tools.definitions.get(definition.name);
        if (live === undefined || !shareWithChild(live, deny)) {
          return { content: [{ type: "text", text: `Not available here: ${definition.name}` }], isError: true };
        }
        // Model-generated ids may repeat across conversations. The durable child task makes this id its own.
        const id = `child:${String(api.conversationId)}:${String(api.taskId)}:${api.callId}`;
        const outcome = await tools.execute(id, definition.name, args, context.abortSignal, undefined, async (partial) => {
          await api.details(durableJson(partial), context);
        }, "child");
        return { content: outcome.result.content, isError: outcome.isError,
          ...(outcome.result.details === undefined ? {} : { details: durableJson(outcome.result.details) }),
          ...(outcome.result.usage === undefined ? {} : { usage: outcome.result.usage }),
          ...(outcome.result.terminate === true ? { control: { terminate: true as const } } : {}) };
      },
    }));
  }

  async executeNested(parentId: string, name: string, args: unknown, options: ExecuteToolOptions): Promise<AgentToolCallOutcome> {
    const index = (this.nestedCounts.get(parentId) ?? 0) + 1;
    this.nestedCounts.set(parentId, index);
    return this.execute(`${parentId}/${String(index)}`, name, args, options.signal, parentId, options.onUpdate);
  }

  /** `caller: "child"` runs a shared session tool for a child: `childTools` has already checked it against the deny list, and it need not be active for the parent. */
  private async execute(callId: string, name: string, args: unknown, signal?: AbortSignal, parentToolCallId?: string, onUpdate?: (partial: AgentToolResult<unknown>) => void | Promise<void>, caller: "parent" | "child" = "parent"): Promise<AgentToolCallOutcome> {
    const tool = this.callable.get(name);
    const definition = this.definitions.get(name);
    const json = durableJson(args);
    const input = typeof json === "object" && json !== null && !Array.isArray(json) ? json : {};
    const toolCall = { type: "toolCall" as const, id: callId, name, arguments: input };
    const error = (text: string): AgentToolCallOutcome => ({ toolCall, result: { content: [{ type: "text", text }], details: undefined }, isError: true });
    if (tool === undefined || definition === undefined) return error(`Unknown tool: ${name}`);
    if (caller === "parent" && parentToolCallId === undefined && !this.active.includes(name)) return error(`Tool ${name} is not active for this conversation.`);
    if (parentToolCallId !== undefined && !this.getCallable().some((candidate) => candidate.name === name)) return error(`Tool ${name} is not callable from codemode.`);
    if (!Value.Check(tool.parameters, args)) return error(`Invalid arguments for tool ${name}`);
    await this.options.beforeCall();
    const eventBase = { toolCallId: callId, toolName: name, args, input, ...(parentToolCallId === undefined ? {} : { parentToolCallId }) };
    const blocked = await this.options.runner.emitToolCall({ type: "tool_call", ...eventBase });
    if (blocked?.block === true) return error(blocked.reason ?? `Tool ${name} was blocked`);
    if (parentToolCallId !== undefined) this.options.emit({ type: "tool_execution_start", ...eventBase });
    try {
      const result = await tool.execute(callId || randomUUID(), args, signal, (partial) => {
        if (parentToolCallId !== undefined) this.options.emit({ type: "tool_execution_update", ...eventBase, partialResult: partial });
        const pending = onUpdate?.(partial);
        if (pending !== undefined) void Promise.resolve(pending).catch((cause: unknown) => {
          this.options.runner.emitError({ extensionPath: "<durable>", event: "tool_update", error: String(cause) });
        });
      });
      const outcome: AgentToolCallOutcome = { toolCall, result, isError: result.isError === true };
      const replacement = await this.options.runner.emitToolResult({ type: "tool_result", ...eventBase, content: result.content, details: result.details, isError: outcome.isError });
      const final = replacement === undefined ? outcome : { ...outcome, result: { ...result, ...replacement }, isError: replacement.isError ?? outcome.isError };
      if (parentToolCallId !== undefined) this.options.emit({ type: "tool_execution_end", ...eventBase, result: final, isError: final.isError });
      return final;
    } catch (cause) {
      const result = error(cause instanceof Error ? cause.message : String(cause));
      if (parentToolCallId !== undefined) this.options.emit({ type: "tool_execution_end", ...eventBase, result, isError: true });
      return result;
    }
  }
}
