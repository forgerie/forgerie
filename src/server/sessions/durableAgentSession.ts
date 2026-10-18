import { readTaskActivity, watchTaskActivity } from "./durableTaskActivity.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { decisionAnnotations, riskAnnotationMessages, withRiskAnnotations, withToolInvocationIds } from "../decisions/optionalDecisionAnnotations.js";
import { durableJson } from "./durableJson.js";
import type { RiskLabel, RiskToolIdentity, RiskLabelEntry } from "../../shared/riskLabels.js";
import { DECISION_HINT_ERROR_EVENT, type DecisionHints } from "../decisions/decisionHints.js";
import type { ManagedProcessTools } from "../processes/processTool.js";
import { acceptProcessEvents, processEventsExtension } from "./durableProcessEvents.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { piWebDataDir } from "../../config.js";
import { WAIT_FOR_USER, type WorkflowAutonomy } from "./workflowAutonomy.js";
import { sanitizedGitEnv } from "../git/gitEnv.js";
import { gatedActionsExtension, gateToolCall, type GatedActionsExtensionOptions, gatedActions, decideGatedAction, waitingGatedActions, gatedActionsChanged } from "./durableGatedActions.js";
import type { GatedActionReads } from "./gatedActions.js";
import type { AutonomyPolicySource } from "../../shared/autonomyPolicy.js";
import { readFile } from "node:fs/promises";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { clampThinkingLevel, getSupportedThinkingLevels, type AssistantMessage, type ImageContent, type Message } from "@earendil-works/pi-ai";
import { ExtensionRunner, ModelRegistry, collectEntriesForBranchSummary, generateBranchSummary, convertToLlm, createLocalBashOperations, createSyntheticSourceInfo, estimateTokens, type AgentSessionServices, type BuildSystemPromptOptions, type ExtensionUIContext, type PromptOptions, type SessionManager, type SessionStartEvent, type ToolDefinition, type SessionBeforeTreeEvent } from "@earendil-works/pi-coding-agent";
import { GenerationTask, InboxDoc, createRegistry, defineExtension, hook, section, watchEvents, type AgentEvent, type AgentEventStream, type InboxItem, type MessageChange, type TaskId, type CompactionResult, type Submission, type Harness, type ConversationId, type Conversation, type EntryId, type Registry } from "@earendil-works/pi-durable";
import type { DurableSessionAddress, DurableSessionHandle } from "./durableSessionAddress.js";
import type { DurableNativeHistory } from "./durableNativeHistory.js";
import { createDurableParentState, type DurableParentState } from "./durableParentState.js";
import { askDeliveryExtension } from "./durableAskDelivery.js";
import { createDurableParentInitializer, DurableSdkSessionView } from "./durableSdkSessionView.js";
import type { DurableParentReader, DurableParentMutations } from "./durableParentContracts.js";
import { ASK_USER_ANSWERS_CUSTOM_TYPE, type SessionTreeSnapshot } from "../../shared/apiTypes.js";
import type { PromptRequestOptions } from "../../shared/promptRequest.js";
import type { PiAgentSession } from "./piSessionService.js";
import { DurableSessionJournal } from "./durableSessionJournal.js";
import { durableUsageTotals, DurableParentReadModel } from "./durableParentReadModel.js";
import { durableEntryPresentationId } from "./durableNativeHistory.js";
import { Check } from "typebox/value";
import { PendingParentAskSchema, type ResponseProjection } from "./sessionResponse.js";
import type { DurableBrowserAppState } from "../../shared/durableBrowserSnapshot.js";
import { DurableSdkTools } from "./durableSdkTools.js";
import { formatSkillInvocation } from "./commandCatalog.js";
import { buildSdkSystemPrompt, executeSdkBash, expandSdkPrompt } from "./durableSdkPresentation.js";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { routeDurableChildExtensions, type DurableChildExtensions, answerChildQuestion, CHILD_QUESTIONS_DOC_KIND, openChildQuestions, childMessages, reviewChildWorktree, continueChild, childWorkIsLive, childWorktreeAction, workingChildCount, listChildren, messageChild, stopChild } from "./durableChildAgents.js";
import type { DurableChildHost } from "./durableChildHost.js";
import { DurableChildWorktrees } from "./durableChildWorktrees.js";
import { disposableWorktree, SCRATCH_ROOT } from "./disposableWorktrees.js";
import { DurableChildRunRecords } from "./durableChildRunRecords.js";
import { isKnownThinkingLevel } from "../../shared/thinkingLevels.js";
import { decisionExtension, decisions, confirmDecision, overturnDecision, flaggedDecisions, decisionsChanged } from "./durableDecisions.js";
import { WorkflowLibrary } from "../resources/workflowLibrary.js";
import { cancelWorkflow, workflowExtension, setWorkflowWorkerModel, launchWorkflow, workflowRuns, finishWorkflow, activeWorkflowRun, workflowActiveFromCommit, workflowRunsChanged, decideWorkflowStop, notifyAutoStopFailed, waitingWorkflowDecisions, acknowledgeWorkflowStall, workflowProposals, startWorkflowProposal, decideWorkflowProposal, doWorkflowProposalHere, openWorkflowProposals } from "./durableWorkflowRuns.js";
import { hostEntryText, isHostEntryKind } from "./durableHostEntries.js";
import { applySdkCommit } from "./durableMessageChanges.js";
import type { WorktreeActionResult } from "../../shared/sessionWorktree.js";
import type { WorkflowModels, WorkflowInputs, WorkflowOutcome, WorkflowRun, WorkflowStopDecision } from "../../shared/workflowRuns.js";

export interface DurableAgentSessionOptions {
  processTools?: ManagedProcessTools;
  gatedIssueLabels?: GatedActionReads["issueLabels"];
  /** Read at each workflow stop. Omitted: every stop waits for the user. */
  workflowAutonomy?: () => WorkflowAutonomy;
  /** Where uncommitted work from project worktrees is copied before an agent discards it. Default: `<app data>/worktree-backups`. */
  worktreeBackupDirectory?: string;
  autonomyPolicy?: AutonomyPolicySource;
  decisionHints?: DecisionHints;
  handle?: DurableSessionHandle;
  services: AgentSessionServices;
  sessionManager: SessionManager;
  customTools?: readonly ToolDefinition[];
  initialModel?: NonNullable<PiAgentSession["model"]>;
  initialThinkingLevel?: PiAgentSession["thinkingLevel"];
  scopedModels?: PiAgentSession["scopedModels"];
  sessionStartEvent?: SessionStartEvent;
  /** Durable-native child agents. Omitted: the session has no child_agent tool. */
  childAgents?: DurableChildHost;
  /** Family resumption must bind every pending logical parent, not only this adapter. */
  beforeResume?: (session: DurableAgentSession) => Promise<boolean>;
}

/** SDK resources and extension hooks around a Durable execution engine. No AgentSession is constructed. */
export class DurableAgentSession implements PiAgentSession, DurableParentReader, DurableParentMutations {
  private static readonly registries = new WeakMap<Harness, Registry>();
  private static readonly adapters = new WeakMap<Harness, Map<ConversationId, DurableAgentSession>>();

  private dispatch(conversationId: ConversationId): DurableAgentSession {
    const adapter = DurableAgentSession.adapters.get(this.journal.harness)?.get(conversationId);
    if (adapter === undefined || adapter.closed) throw new Error(`No SDK adapter bound for conversation ${String(conversationId)}`);
    return adapter;
  }

  private bindConversation(): void {
    const harness = this.journal.harness;
    let adapters = DurableAgentSession.adapters.get(harness);
    if (adapters === undefined) { adapters = new Map(); DurableAgentSession.adapters.set(harness, adapters); }
    const existing = adapters.get(this.journal.conversation.id);
    if (existing !== undefined && existing !== this) throw new Error("Conversation already has an SDK adapter");
    adapters.set(this.journal.conversation.id, this);
  }

  private unbindConversation(): void {
    if (this.journalValue === undefined) return;
    const adapters = DurableAgentSession.adapters.get(this.journal.harness);
    if (adapters?.get(this.journal.conversation.id) === this) adapters.delete(this.journal.conversation.id);
  }

  readonly modelRuntime;
  readonly settingsManager;
  readonly resourceLoader;
  readonly sessionManager;
  readonly scopedModels;
  private runner: ExtensionRunner;
  readonly agent;
  model: PiAgentSession["model"];
  thinkingLevel: PiAgentSession["thinkingLevel"];
  private registry = createRegistry();
  private tools: DurableSdkTools;
  private errorListener: ((error: { extensionPath: string; event: string; error: string; stack?: string }) => void) | undefined;
  private journalValue: DurableSessionJournal | undefined;
  private stream: AgentEventStream | undefined;
  private parentStateValue: DurableParentState | undefined;
  private sdkView: DurableSdkSessionView | undefined;
  private parentAppWatch: Awaited<ReturnType<DurableSdkSessionView["appWatch"]>> | undefined;
  private parentAppValue: DurableBrowserAppState | undefined;
  private readModelValue: DurableParentReadModel | undefined;
  private readonly listeners = new Set<(event: unknown) => void>();
  private partial: AssistantMessage | undefined;
  private streaming = false;
  private runStartedAt: string | undefined;
  private compacting = false;
  private bashController: AbortController | undefined;
  private compactionTask: TaskId<CompactionResult> | undefined;
  private branchSummaryController: AbortController | undefined;
  private branchTargetId: string | undefined;
  private queued: readonly InboxItem[] = [];
  private mutation: Promise<void> = Promise.resolve();
  private systemPrompt = "";
  private modelContext: readonly Message[] | undefined;
  private preparedContextTokens: number | undefined;
  private basePrompt: BuildSystemPromptOptions;
  private closed = false;
  get isClosed(): boolean { return this.closed; }
  private bound = false;
  private taskWatch: { stop(): Promise<void> } | undefined;
  private childTasksLive = false;
  private workflowLive = false;
  private childWatch: { stop(): Promise<unknown> } | undefined;
  private childrenLive: boolean | undefined;
  private childWorktrees: DurableChildWorktrees | undefined;
  private childExtensions: DurableChildExtensions | undefined;
  private childCount = 0;
  /** Child questions, workflow stops, and workflow proposals that wait for the user. */
  private waitingCount = 0;
  private waitingGates = 0;
  private gateOptions: GatedActionsExtensionOptions | undefined;
  private gateUnsubscribe: (() => void) | undefined;
  private flaggedCount = 0;
  readonly processTools: ManagedProcessTools | undefined;
  private detachProcessEvents: (() => Promise<void>) | undefined;
  private readonly customTools: readonly ToolDefinition[];
  private childRunRecords: DurableChildRunRecords | undefined;

  private constructor(private readonly options: DurableAgentSessionOptions) {
    const { services, sessionManager } = options;
    if (options.handle !== undefined) {
      this.registry = DurableAgentSession.registries.get(options.handle.harness) ?? this.registry;
    }
    this.modelRuntime = services.modelRuntime;
    this.settingsManager = services.settingsManager;
    this.resourceLoader = services.resourceLoader;
    this.sessionManager = sessionManager;
    this.scopedModels = options.scopedModels ?? [];
    const saved = sessionManager.buildSessionContext();
    const defaultProvider = this.settingsManager.getDefaultProvider();
    const defaultModel = this.settingsManager.getDefaultModel();
    this.model = options.initialModel
      ?? (saved.model === null ? undefined : this.modelRuntime.getModel(saved.model.provider, saved.model.modelId))
      ?? (defaultProvider === undefined || defaultModel === undefined ? undefined : this.modelRuntime.getModel(defaultProvider, defaultModel))
      ?? this.modelRuntime.getAvailableSnapshot()[0];
    // SDK context reports "off" even when no selection exists. Only an explicit entry overrides the default.
    const hasSavedThinking = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");
    const savedLevel = hasSavedThinking && isKnownThinkingLevel(saved.thinkingLevel) ? saved.thinkingLevel : undefined;
    const level = options.initialThinkingLevel ?? savedLevel ?? this.settingsManager.getDefaultThinkingLevel() ?? "medium";
    this.thinkingLevel = this.model === undefined ? "off" : clampThinkingLevel(this.model, level);
    const extensions = this.resourceLoader.getExtensions();
    this.runner = new ExtensionRunner(extensions.extensions, extensions.runtime, services.cwd, sessionManager, new ModelRegistry(this.modelRuntime));
    this.processTools = options.processTools;
    this.customTools = [...options.customTools ?? [], ...this.processTools === undefined ? [] : [this.processTools.definition(async id => {
      const caller = this.tools.caller(id);
      if (caller.conversationId === this.journal.conversation.id) return caller;
      await this.childRunRecords?.flush();
      const child = this.childRunRecords?.activeChildRun(caller.conversationId);
      if (child === undefined) throw new Error("Cannot start a child process without its persisted child run record");
      return { ...caller, child };
    })]];
    this.tools = new DurableSdkTools({ cwd: services.cwd, settings: this.settingsManager, runner: this.extensionRunner, customTools: this.customTools,
      ...(this.options.decisionHints === undefined ? {} : {riskLabels: {hints: this.options.decisionHints, onError: (error: unknown) => { this.report(error, DECISION_HINT_ERROR_EVENT); },
        record: (conversation: ConversationId, id: string, label: RiskLabel, identity: RiskToolIdentity) => this.recordToolRiskLabel(conversation, id, label, identity)}}),
      beforeCall: () => this.journal.project(), gateNested: (call, api, index, ctx) => {
        if (this.gateOptions === undefined) throw new Error("Nested gated actions are not bound");
        return gateToolCall(this.gateOptions, call, api, ctx, {index, cwd: this.options.services.cwd, extension: `forgerie.sdk-tools:${this.sessionId}:nested`});
      }, emit: (event) => { this.emit(event); } });
    this.basePrompt = this.promptOptions();
    this.agent = { streamFunction: this.modelRuntime.streamSimple.bind(this.modelRuntime) };
    this.bindCore();
  }

  static async open(options: DurableAgentSessionOptions): Promise<DurableAgentSession> {
    const session = new DurableAgentSession(options);
    try {
      await session.initialize();
      return session;
    } catch (error) {
      await session.detachProcessEvents?.();
      await session.taskWatch?.stop();
      await session.childWatch?.stop();
      await session.stream?.stop();
      await session.parentAppWatch?.stop();
      session.sdkView?.close();
      session.unbindConversation();
      await session.journalValue?.close();
      await session.childRunRecords?.close();
      session.extensionRunner.invalidate("Durable session initialization failed");
      throw error;
    }
  }

  get extensionRunner(): ExtensionRunner { return this.runner; }
  get journal(): DurableSessionJournal {
    if (this.journalValue === undefined) throw new Error("Durable session has not opened");
    return this.journalValue;
  }
  get durableAddress(): DurableSessionAddress { return this.journal.handle.address; }
  get nativeHistory(): DurableNativeHistory { return this.journal.nativeHistory; }
  get parentState(): DurableParentState {
    if (this.parentStateValue === undefined) throw new Error("Durable parent state has not bound");
    return this.parentStateValue;
  }
  get parentAppSnapshot(): DurableBrowserAppState {
    if (this.parentAppValue === undefined) throw new Error("Durable parent app snapshot has not bound");
    return this.parentAppValue;
  }
  get parentResponseProjection(): ResponseProjection {
    const app = this.parentAppSnapshot;
    const pendingAsk = app.pendingAsk;
    if (pendingAsk !== undefined && !Check(PendingParentAskSchema, pendingAsk)) throw new Error("Invalid committed pending ask");
    return { protocol: true, response: app.response, ...(pendingAsk === undefined ? {} : { pendingAsk }) };
  }
  get parentReadModel(): DurableParentReadModel {
    if (this.readModelValue === undefined) throw new Error("Durable parent read model has not bound");
    return this.readModelValue;
  }
  async flushDurableMutations(): Promise<void> { await this.mutation; await this.parentStateValue?.flush(context); }
  async refreshParentAppState(): Promise<void> {
    const pendingAsk = await this.parentState.pendingAsk(context);
    const response = await this.parentState.response(context);
    const sessionName = this.parentAppSnapshot.sessionName;
    this.parentAppValue = { response, ...(pendingAsk === undefined ? {} : { pendingAsk }), ...(sessionName === undefined ? {} : { sessionName }) };
  }

  getDurableTree(): Promise<SessionTreeSnapshot> { return this.nativeHistory.tree(context); }
  get sessionId(): string { return this.sessionManager.getSessionId(); }
  get sessionFile(): string | undefined { return this.sessionManager.getSessionFile(); }
  get sessionName(): string | undefined { return this.sessionManager.getSessionName(); }
  get messages(): (AgentMessage & {toolInvocations?: Record<string, string>; decisionAnnotations?: RiskLabelEntry[]})[] {
    const messages = this.sessionManager.buildSessionContext().messages;
    return this.journalValue === undefined ? messages : withRiskAnnotations(this.journal.harness, this.journal.conversation.id, messages);
  }
  get promptTemplates() { return this.resourceLoader.getPrompts().prompts; }
  get state(): { streamingMessage?: AssistantMessage } { return this.partial === undefined ? {} : { streamingMessage: this.partial }; }
  get isStreaming(): boolean { return this.streaming; }
  getActiveRunStartedAt(): string | undefined { return this.runStartedAt; }
  get isCompacting(): boolean { return this.compacting; }
  get isBashRunning(): boolean { return this.bashController !== undefined; }
  get pendingMessageCount(): number { return this.queued.filter((item) => item.mode !== "write").length; }

  private installSdkTools(): void {
    const name = `forgerie.sdk-tools:${this.sessionId}`;
    const extension = this.tools.extension((id) => this.dispatch(id).tools, name);
    this.registry.install(extension);
    if (this.journalValue === undefined) return;
    const journal = this.journal;
    const owner = journal.conversation.id;
    this.registry.install(this.tools.nestedExtension(() => this.dispatch(owner).tools, `${name}:nested`));
    this.mutation = this.mutation.then(async () => {
      const agent = await journal.conversation.agent(context);
      // A fork inherits its parent's extension names. Select only this adapter's SDK declarations;
      // registry installation must not change a sibling's schema, descriptions, or replay policy.
      const extensions = agent.extensions.filter((item) => item.name !== "forgerie.sdk-tools" && !item.name.startsWith("forgerie.sdk-tools:")
        && (!item.name.startsWith("forgerie.child-agents:") || item.name === `forgerie.child-agents:${this.sessionId}`));
      await journal.conversation.configure({ extensions: [...extensions, extension], tools: null }, context);
    });
  }

  private async initialize(): Promise<void> {
    this.systemPrompt = await buildSdkSystemPrompt(this.basePrompt);
    this.installSdkTools();
    // Register delivery before a family can schedule a persisted accepted answer.
    this.registry.install(askDeliveryExtension());
    this.registry.install(processEventsExtension());
    this.registry.install(defineExtension({ name: "forgerie.sdk-context", sections: [section("forgerie", (input) => this.dispatch(input.conversationId).systemPrompt, { tag: false })],
      hooks: [hook(GenerationTask, {
        beforeRequest: async (request, api) => {
          const adapter = this.dispatch(api.conversationId);
          await adapter.mutation;
          adapter.journal.assertOwned();
          await adapter.journal.project();
          const messages = convertToLlm(await adapter.extensionRunner.emitContext([...request.messages]));
          // This existing boundary runs emitContext exactly once, including context supplied by extensions.
          adapter.preparedContextTokens = messages.reduce((total, message) => total + estimateTokens(message), 0);
          return { messages };
        },
        afterResponse: async (message, api) => {
          const replaced = await this.dispatch(api.conversationId).extensionRunner.emitMessageEnd({ type: "message_end", message });
          if (replaced?.role === "assistant") Object.assign(message, replaced);
        },
      })],
    }));
    this.journalValue = await DurableSessionJournal.open({
      ...(this.options.handle === undefined ? {} : { handle: this.options.handle }),
      initializeParentDocuments: createDurableParentInitializer(this.sessionManager),
      summarize: (source, cut, instructions) => this.summarizeBranch(source, cut, instructions),
      manager: this.sessionManager, models: this.modelRuntime, registry: this.registry,
      agent: { ...(this.model === undefined ? {} : { model: { provider: this.model.provider, modelId: this.model.id } }), thinkingLevel: this.thinkingLevel, cwd: this.options.services.cwd },
      settings: { contextRetentionMs: 0, retry: this.settingsManager.getRetrySettings(), steeringMode: this.settingsManager.getSteeringMode(), followUpMode: this.settingsManager.getFollowUpMode(),
        compaction: { enabled: this.settingsManager.getCompactionEnabled(), reserveTokens: this.settingsManager.getCompactionReserveTokens(this.model), keepRecentTokens: this.settingsManager.getCompactionKeepRecentTokens(this.model) } },
      onReport: (error) => { this.extensionRunner.emitError({ extensionPath: "<durable>", event: "runtime", error: String(error) }); },
      // Only Durable's own coding tools use the environment. Child agents run them; the parent uses the SDK tools.
      ...(this.options.childAgents === undefined ? {} : { env: ({ cwd }: { cwd?: string }) => {
        const shellPath = this.settingsManager.getShellPath();
        return new NodeExecutionEnv({ cwd: cwd ?? this.options.services.cwd, ...(shellPath === undefined ? {} : { shellPath }) });
      } }),
    });
    const sharedRegistry = DurableAgentSession.registries.get(this.journal.harness);
    if (sharedRegistry === undefined) DurableAgentSession.registries.set(this.journal.harness, this.registry);
    else this.registry = sharedRegistry;
    this.bindConversation();
    this.installSdkTools();
    await this.mutation;
    await this.journal.conversation.commit((tx) => createDurableParentInitializer(this.sessionManager)(tx, { id: this.journal.conversation.id }), context);
    await this.rebindDurableParentState();
    await this.restoreAgentSelection();
    await this.startGatedActions();
    await this.startChildAgents();
    await this.startTaskObservation();
    await this.startEventStream();
    this.detachProcessEvents = await this.processTools?.attach(summary => acceptProcessEvents(this.journal.conversation, summary, context));
  }

  private async startEventStream(): Promise<void> {
    this.stream = await watchEvents(this.journal.harness, this.journal.conversation.id, context);
    await this.applyEvent(this.stream.snapshot);
    this.stream.start(async (events) => {
      // Start events have no entry ID. Pair them with their ends from the same committed batch so neither
      // half of a model-only notification is emitted as a user message.
      const hiddenMessages = new Set(events.flatMap((event) => event.type === "message_end" && !this.journal.isTranscriptEntry(event.entry) ? event.entry.model ?? [] : []));
      for (const event of events) {
        if (event.type === "message_start" && hiddenMessages.has(event.message)) continue;
        await this.applyEvent(event);
      }
    });
  }

  /** Recreate derived caches and the metadata mutation line after a selected-handle change. */
  async rebindDurableParentState(): Promise<void> {
    await this.parentAppWatch?.stop();
    this.sdkView?.close();
    this.parentStateValue = createDurableParentState(this.journal.handle, this.nativeHistory);
    this.sdkView = await DurableSdkSessionView.open(this.journal.handle, context);
    const view = this.sdkView;
    this.readModelValue = new DurableParentReadModel({ handle: this.journal.handle,
      messageId: (entry, index) => durableEntryPresentationId(this.durableAddress.journalId, entry, index),
      projectEntry: (entry) => view.projectEntry(entry), appWatch: (ctx) => view.appWatch(ctx) });
    const watch = await view.appWatch(context);
    this.parentAppWatch = watch;
    this.parentAppValue = watch.value;
    watch.start((snapshot) => {
      this.parentAppValue = snapshot;
      this.emit({ type: "durable_parent_state_changed" });
      return Promise.resolve();
    });
    void watch.closed.then((end) => { if (end.reason === "listener_error") this.report(end.error); });
  }

  // ─── Host operations on Durable children. None of them starts a parent turn. ───
  get hostsDurableChildren(): boolean { return this.options.childAgents !== undefined; }
  get workingDurableChildren(): number { return this.childCount; }
  get waitingOnUser(): number { return this.waitingCount + this.waitingGates; }
  get flaggedDecisions(): number { return this.flaggedCount; }
  gatedActions() { return gatedActions(this.journal.harness, this.journal.conversation.id, context); }
  decideGatedAction(id: string, choice: "approved" | "refused") { return decideGatedAction(this.journal.harness, this.journal.conversation, id, choice, context); }
  decisions() { return decisions(this.journal.harness, this.journal.conversation.id, context); }
  confirmDecision(id: string) { return confirmDecision(this.journal.conversation, id, context); }
  overturnDecision(id: string, note: string) { return overturnDecision(this.journal.harness, this.journal.conversation, id, note, context); }
  runWorkflow(name: string, inputs: WorkflowInputs, requestId: string, models?: WorkflowModels) {
    if (!this.hostsDurableChildren) throw new Error("Workflow launches require durableChildren");
    return launchWorkflow(this.journal.harness, this.journal.conversation, new WorkflowLibrary(this.options.services.agentDir), this.options.services.cwd, this.sessionId, name, inputs, requestId, context, models, this.reviewRounds());
  }
  workflowProposals() { return workflowProposals(this.journal.harness, this.journal.conversation.id, context); }
  startWorkflowProposal(id: string, inputs: WorkflowInputs, requestId: string, models?: WorkflowModels) {
    return startWorkflowProposal(this.journal.harness, this.journal.conversation, this.options.services.cwd, this.sessionId, id, inputs, requestId, context, models, this.reviewRounds());
  }
  changeWorkflowProposal(id: string, note: string) {
    return decideWorkflowProposal(this.journal.harness, this.journal.conversation, id, "changes", note, context);
  }
  dismissWorkflowProposal(id: string) {
    return decideWorkflowProposal(this.journal.harness, this.journal.conversation, id, "dismissed", undefined, context);
  }
  doWorkflowProposalHere(id: string, inputs: WorkflowInputs) {
    return doWorkflowProposalHere(this.journal.harness, this.journal.conversation, id, inputs, context);
  }
  workflowRuns() { return workflowRuns(this.journal.harness, this.journal.conversation.id, context); }
  cancelWorkflow(runId: string) {
    return cancelWorkflow(this.journal.harness, this.journal.conversation, runId, context);
  }
  finishWorkflow(runId: string, outcome: WorkflowOutcome, result: string) {
    return this.journal.conversation.commit((tx) => finishWorkflow(tx, this.journal.conversation.id, runId, outcome, result), context);
  }
  setWorkflowWorkerModel(runId: string, worker: string, model: string | null) {
    return this.journal.conversation.commit((tx) => setWorkflowWorkerModel(tx, this.journal.conversation.id, runId, worker, model), context);
  }
  decideWorkflowStop(runId: string, stage: string, decision: WorkflowStopDecision, note: string | undefined) {
    return decideWorkflowStop(this.journal.harness, this.journal.conversation, runId, stage, decision, note, (run) => this.landWorkflowBranches(run), context);
  }
  /** Frozen into each run at launch, so a run keeps the limit it started with. */
  private reviewRounds(): number | undefined { return (this.options.workflowAutonomy?.() ?? WAIT_FOR_USER).reviewRounds; }
  private passesStop(stop: "approve" | "land"): boolean {
    const autonomy = this.options.workflowAutonomy?.() ?? WAIT_FOR_USER;
    return stop === "land" ? autonomy.landStops : autonomy.approveStops;
  }
  /**
   * Forgerie's own decision at a stop, after the tool's commit. A failed landing leaves the stop waiting for the user,
   * and the agent hears why, so the transcript says what happened.
   */
  private passStop(runId: string, stage: string, stop: "approve" | "land"): void {
    // Commit publications refresh the run, the decision log and the waiting count in the browser.
    void decideWorkflowStop(this.journal.harness, this.journal.conversation, runId, stage, stop, undefined, (run) => this.landWorkflowBranches(run), context, "forgerie")
      .catch(async (error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        await this.journal.conversation.commit((tx) => notifyAutoStopFailed(tx, this.journal.conversation.id, runId, stage, reason), context).catch((report: unknown) => { this.report(report); });
        this.journal.harness.resume();
      });
  }
  /** Lands each child branch of the run that has commits, in the order the children started. Stops at the first failure. */
  private async landWorkflowBranches(run: WorkflowRun): Promise<{ landed: string[]; error?: string }> {
    const children = await this.durableChildren();
    const landed: string[] = [];
    for (const conversationId of [...new Set(run.children.map((child) => child.conversationId))]) {
      const worktree = children.find((child) => child.conversationId === conversationId)?.worktree;
      if (worktree?.state !== "active" || (worktree.ahead === 0 && !worktree.dirty)) continue;
      const failed = (reason: string) => ({ landed, error: `${landed.length === 0 ? "Nothing landed." : `Landed ${landed.join(", ")}.`} ${worktree.branch} could not land: ${reason}` });
      let result: WorktreeActionResult;
      try { result = await this.landDurableChildWorktree(conversationId); }
      catch (error) { return failed(error instanceof Error ? error.message : String(error)); }
      if (result.kind === "conflict") return failed(`conflicts with ${result.defaultBranch} in ${result.files.join(", ")}`);
      if (result.kind === "blocked") return failed(result.reason);
      if (result.kind !== "landed") return failed(`unexpected result ${result.kind}`);
      landed.push(worktree.branch);
    }
    return { landed };
  }
  durableChildren() { return listChildren(this.journal.harness, this.journal.conversation.id, context, this.childWorktrees); }
  reviewDurableChildWorktree(conversationId: number) { return reviewChildWorktree(this.journal.harness, this.journal.conversation.id, conversationId, context, this.childWorktrees); }
  continueDurableChild(conversationId: number, text: string, requestId: string) { return continueChild(this.journal.harness, this.journal.conversation, conversationId, text, requestId, context, this.childWorktrees); }
  landDurableChildWorktree(conversationId: number) { return childWorktreeAction(this.journal.harness, this.journal.conversation.id, conversationId, context, this.childWorktrees, "land"); }
  previewDurableChildWorktreeDiscard(conversationId: number) { return childWorktreeAction(this.journal.harness, this.journal.conversation.id, conversationId, context, this.childWorktrees, "discard-preview"); }
  discardDurableChildWorktree(conversationId: number, confirmationToken: string) { return childWorktreeAction(this.journal.harness, this.journal.conversation.id, conversationId, context, this.childWorktrees, "discard", confirmationToken); }
  durableChildMessages(conversationId: number) { return childMessages(this.journal.harness, this.journal.conversation.id, conversationId, context); }
  async messageDurableChild(conversationId: number, text: string) {
    await messageChild(this.journal.harness, this.journal.conversation, conversationId, text, context, this.childWorktrees, this.childExtensions);
    await this.childRunRecords?.flush();
  }
  stopDurableChild(conversationId: number) { return stopChild(this.journal.harness, this.journal.conversation, conversationId, context, this.childWorktrees); }
  answerDurableChildQuestion(questionId: string, answer: string) { return answerChildQuestion(this.journal.conversation, questionId, answer, context); }

  private async childOwnerExtensions(id: ConversationId): Promise<DurableChildExtensions> {
    const owner = await this.journal.harness.commit(async (tx) => {
      const seen = new Set<ConversationId>();
      let current = id;
      while (!seen.has(current)) {
        seen.add(current);
        const record = await tx.conversation(current);
        if (record === undefined) throw new Error("Missing child owner conversation");
        if (record.owner === undefined) return current;
        current = record.owner.conversationId;
      }
      throw new Error("Cyclic child ownership");
    }, context);
    const extensions = this.dispatch(owner).childExtensions;
    if (extensions === undefined) throw new Error("Child owner has no bound host");
    return extensions;
  }

  private async recordToolRiskLabel(conversation: ConversationId, id: string, label: RiskLabel, identity: RiskToolIdentity): Promise<void> {
    await decisionAnnotations(this.journal.harness).write(String(conversation), `tool:${identity.invocationId}`, durableJson({target: "tool", id, ...identity, label}));
  }

  private async startGatedActions(): Promise<void> {
    this.gateUnsubscribe?.();
    const gitRead = async (cwd: string, args: readonly string[]) => (await promisify(execFile)("git", ["-C", cwd, ...args], {env: {...sanitizedGitEnv(), GIT_OPTIONAL_LOCKS: "0"}, encoding: "utf8", maxBuffer: 64 * 1024 * 1024})).stdout;
    const parent = this.journal.conversation.id;
    this.gateOptions = {name: `forgerie.gated-actions:${String(parent)}`, parent,
      harness: () => this.journal.harness,
      ...(this.options.decisionHints === undefined ? {} : {riskLabels: {hints: this.options.decisionHints, onError: (error: unknown) => { this.report(error, DECISION_HINT_ERROR_EVENT); }}}),
      ...(this.options.autonomyPolicy === undefined ? {} : {policy: this.options.autonomyPolicy}),
      pushDefaultFolders: () => (this.options.workflowAutonomy?.() ?? WAIT_FOR_USER).pushDefaultFolders,
      reads: {git: gitRead,
        issueLabels: this.options.gatedIssueLabels ?? (() => Promise.reject(new Error("GitHub labels unavailable"))),
        // Child worktrees are read at call time: they start after the gate and change as children spawn and land.
        disposable: disposableWorktree({scratchRoot: SCRATCH_ROOT, childWorktrees: async () => await this.childWorktrees?.activePaths() ?? [],
          projectBackup: {git: gitRead, directory: this.options.worktreeBackupDirectory ?? join(piWebDataDir(), "worktree-backups"), now: () => new Date()}})},
    };
    const extension = gatedActionsExtension(this.gateOptions);
    const {tasks, ...selected} = extension;
    this.registry.install(defineExtension({name: "forgerie.gated-action-runtime", tasks: tasks ?? []}));
    this.registry.install(selected);
    const retained = (await this.journal.conversation.agent(context)).extensions.filter(item => !item.name.startsWith("forgerie.gated-actions:"));
    await this.journal.conversation.configure({extensions: [...retained, selected]}, context);
    const recount = async () => {
      this.waitingGates = await waitingGatedActions(this.journal.harness, parent, context);
      this.flaggedCount = await flaggedDecisions(this.journal.harness, parent, context);
      this.emit({type: "durable_children_changed"});
    };
    await recount();
    let pending = Promise.resolve();
    const offLabels = decisionAnnotations(this.journal.harness).subscribe((scope, key) => {
      if (this.closed || scope !== String(parent)) return;
      if (key.startsWith("gate:")) this.emit({type: "workflow_runs_changed", decisionHint: true});
      if (key.startsWith("tool:")) {
        const message = riskAnnotationMessages(this.journal.harness, parent).find(item => `tool:${item.details.invocationId}` === key);
        if (message !== undefined) { this.emit({type: "message_start", message, decisionHint: true}); this.emit({type: "message_end", message, decisionHint: true}); }
      }
    });
    const offCommits = this.journal.harness.subscribeCommits(publication => {
      if (!gatedActionsChanged(publication, parent) && !decisionsChanged(publication, parent)) return;
      this.emit({type: "workflow_runs_changed"});
      pending = pending.then(recount).catch((error: unknown) => { this.report(error); });
    });
    this.gateUnsubscribe = () => { offLabels(); offCommits(); };
  }

  private async startChildAgents(): Promise<void> {
    const host = this.options.childAgents;
    if (host === undefined) return;
    const ref = { id: this.sessionId, cwd: this.options.services.cwd };
    this.childWorktrees = host.worktrees === undefined ? undefined : new DurableChildWorktrees(host.worktrees, ref);
    const { extensions, workflow, decision } = await this.installChildExtensions();
    // Children select these explicitly. The parent must not, or ask_human and the coding tools join its loadout.
    const retained = (await this.journal.conversation.agent(context)).extensions.filter(item => !extensions.childOnly.some(child => child.name === item.name));
    await this.journal.conversation.configure({extensions: [...new Map([...retained, ...extensions.parent, workflow, decision].map(item => [item.name, item])).values()]}, context);
    if (host.runRecords !== undefined) {
      this.childRunRecords = await DurableChildRunRecords.open(this.journal.harness, this.journal.conversation.id, ref, host.runRecords, context,
        (error) => { if (host.runRecordError === undefined) this.report(error); else host.runRecordError(error); }, Date.now, host.runFinished);
    }
    await this.watchChildAgents();
  }

  private async installChildExtensions() {
    const host = this.options.childAgents;
    if (host === undefined) throw new Error("Child agents are not enabled");
    const projectContext = this.resourceLoader.getAgentsFiles().agentsFiles.map((file) => `## ${file.path}\n\n${file.content}`).join("\n\n");
    // Children resolve their agent files' skills against the skills this session sees.
    const sessionSkills = this.resourceLoader.getSkills().skills.filter((skill) => !skill.disableModelInvocation)
      .map((skill) => ({ name: skill.name, description: skill.description, path: skill.filePath }));
    const source = await host.extensions({ cwd: this.options.services.cwd, agentDir: this.options.services.agentDir, projectContext, sessionSkills, sessionTools: () => this.tools,
      commit: (change, ctx) => this.journal.harness.commit(change, ctx),
      ...(this.options.decisionHints === undefined ? {} : {riskLabels: {hints: this.options.decisionHints, onError: (error: unknown) => { this.report(error, DECISION_HINT_ERROR_EVENT); },
        record: (conversation: ConversationId, id: string, label: RiskLabel, identity: RiskToolIdentity) => this.recordToolRiskLabel(conversation, id, label, identity)}}),
      ...(this.childWorktrees === undefined ? {} : { worktrees: this.childWorktrees }),
      ...(host.runRecords === undefined ? {} : { flushRunRecords: () => this.childRunRecords?.flush() ?? Promise.resolve() }) });
    const workflow = workflowExtension({ library: new WorkflowLibrary(this.options.services.agentDir), cwd: this.options.services.cwd, autonomy: {
      autoStop: (parent, stop) => { try { return this.dispatch(parent).passesStop(stop); } catch { return false; } },
      onAutoStop: (parent, runId, stage, stop) => { try { this.dispatch(parent).passStop(runId, stage, stop); } catch (error) { this.report(error); } },
    } });
    this.registry.install(workflow);
    const decision = decisionExtension();
    this.registry.install(decision);
    return { extensions: this.installRoutedChildExtensions(source), workflow, decision };
  }

  /** Install child extensions whose callbacks resolve the owning parent, under names scoped to this session. */
  private installRoutedChildExtensions(source: DurableChildExtensions): DurableChildExtensions {
    this.childExtensions = source;
    const routed = routeDurableChildExtensions(source, (id) => this.childOwnerExtensions(id));
    const extensions = { ...routed, parent: routed.parent.map((extension) => {
      const { tasks, ...owned } = extension;
      // Task names are family-wide. Their routed callbacks must be installed once by name;
      // tool descriptions and agent catalogs remain selected separately for each logical parent.
      this.registry.install(defineExtension({ name: extension.name, tasks: tasks ?? [] }));
      return { ...owned, name: `${extension.name}:${this.sessionId}` };
    }) };
    for (const extension of [...extensions.parent, ...extensions.childOnly]) this.registry.install(extension);
    return extensions;
  }

  private refreshChildExtensions(): void {
    const source = this.childExtensions?.refresh();
    if (source === undefined) return;
    this.installRoutedChildExtensions(source);
  }

  taskActivity() { return readTaskActivity(this.journal.harness, this.journal.conversation.id, context); }

  private updateChildLiveness(): void {
    const host = this.options.childAgents;
    if (host === undefined) return;
    const live = this.workflowLive || this.childTasksLive;
    if (live === this.childrenLive) return;
    this.childrenLive = live;
    host.liveChanged({ id: this.sessionId, cwd: this.options.services.cwd }, live);
  }

  private async startTaskObservation(): Promise<void> {
    const parent = this.journal.conversation.id;
    this.taskWatch = await watchTaskActivity(this.journal.harness, parent, (graph, family) => {
      this.childCount = workingChildCount(graph, parent, family);
      this.childTasksLive = childWorkIsLive(graph, parent, family);
      this.updateChildLiveness();
      this.emit({ type: "durable_children_changed" });
    }, error => { this.report(error); }, context);
  }

  private async watchChildAgents(): Promise<void> {
    this.workflowLive = (await activeWorkflowRun(this.journal.harness, this.journal.conversation.id, context)) !== undefined;
    const parent = this.journal.conversation.id;
    // Child questions, workflow stops, and open proposals wait on the user; the status counts them so the session list can say so.
    const recountWaiting = async () => {
      const waiting = await openChildQuestions(this.journal.harness, parent, context) + await waitingWorkflowDecisions(this.journal.harness, parent, context) + await openWorkflowProposals(this.journal.harness, parent, context);
      const flagged = await flaggedDecisions(this.journal.harness, parent, context);
      if (waiting === this.waitingCount && flagged === this.flaggedCount) return;
      this.waitingCount = waiting;
      this.flaggedCount = flagged;
      this.emit({ type: "durable_children_changed" });
    };
    await recountWaiting();
    // Serial reads keep an older recount from publishing after a newer answer or overturn.
    let recount = Promise.resolve();
    const unsubscribe = this.journal.harness.subscribeCommits((publication) => {
      const runsChanged = workflowRunsChanged(publication, parent) || decisionsChanged(publication, parent);
      if (runsChanged) this.emit({ type: "workflow_runs_changed" });
      if (runsChanged || publication.changes.some((change) => change.type === "document" && change.conversationId === parent && change.record.kind === CHILD_QUESTIONS_DOC_KIND)) {
        recount = recount.then(recountWaiting).catch((error: unknown) => { this.report(error); });
      }
      const change = workflowActiveFromCommit(publication, this.journal.conversation.id);
      if (change === undefined) return;
      this.workflowLive = change.active !== null;
      this.updateChildLiveness();
    });
    this.childWatch = { stop: () => { unsubscribe(); return Promise.resolve(); } };
  }

  subscribe(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    if (this.bound) void this.resumeFamily().catch((error: unknown) => { this.report(error); });
    return () => { this.listeners.delete(listener); };
  }
  private emit(event: unknown): void { for (const listener of this.listeners) listener(event); }

  async bindExtensions(bindings: { uiContext?: ExtensionUIContext; mode?: "rpc"; onError?: (error: { extensionPath: string; event: string; error: string; stack?: string }) => void }): Promise<void> {
    this.extensionRunner.setUIContext(bindings.uiContext, bindings.mode ?? "rpc");
    this.errorListener = bindings.onError;
    if (bindings.onError !== undefined) this.extensionRunner.onError(bindings.onError);
    await this.extensionRunner.emit(this.options.sessionStartEvent ?? { type: "session_start", reason: "startup" });
    this.bound = true;
    if (this.listeners.size > 0) await this.resumeFamily();
  }

  private async resumeFamily(): Promise<void> {
    const ready = await this.options.beforeResume?.(this);
    if (!this.closed && ready !== false) this.journal.harness.resume();
  }

  private bindCore(): void {
    this.extensionRunner.bindCore({
      sendMessage: (message, options) => { void this.sendCustomMessage(message, options).catch((error: unknown) => { this.report(error); }); },
      sendUserMessage: (content, options) => {
        const text = typeof content === "string" ? content : content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
        const images = typeof content === "string" ? [] : content.filter((part) => part.type === "image");
        void this.prompt(text, { images, source: "extension", ...(options?.deliverAs === undefined ? {} : { streamingBehavior: options.deliverAs }) }).catch((error: unknown) => { this.report(error); });
      },
      appendEntry: (type, data) => { this.sessionManager.appendCustomEntry(type, data); },
      setSessionName: (name) => { this.setSessionName(name); }, getSessionName: () => this.sessionName,
      setLabel: (id, label) => { this.sessionManager.appendLabelChange(id, label); },
      getActiveTools: () => this.tools.getActive(),
      getAllTools: () => this.tools.getDefinitions().map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters,
        exposure: tool.exposure ?? "direct", sourceInfo: createSyntheticSourceInfo(`<durable:${tool.name}>`, { source: "sdk" }),
        ...(tool.promptGuidelines === undefined ? {} : { promptGuidelines: tool.promptGuidelines }), ...(tool.namespace === undefined ? {} : { namespace: tool.namespace }),
        ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }) })),
      getSettings: () => this.settingsManager.getSettings(),
      setActiveTools: (names) => { this.tools.setActive(names); this.installSdkTools(); },
      refreshTools: () => { this.tools.refresh(); this.installSdkTools(); this.refreshChildExtensions(); },
      getCommands: () => this.extensionRunner.getRegisteredCommands().map((command) => ({ name: command.invocationName, description: command.description ?? "", source: "extension" as const, sourceInfo: command.sourceInfo })),
      setModel: async (model) => { await this.setModel(model); return true; },
      getThinkingLevel: () => this.thinkingLevel, setThinkingLevel: (level) => { this.setThinkingLevel(level); },
    }, {
      getModel: () => this.model, getScopedModels: () => this.scopedModels,
      isIdle: () => !this.isStreaming, isProjectTrusted: () => this.settingsManager.isProjectTrusted(),
      getSignal: () => undefined, abort: () => { void this.abort().catch((error: unknown) => { this.report(error); }); },
      shutdown: () => { /* the host owns process shutdown */ }, hasPendingMessages: () => this.pendingMessageCount > 0,
      getContextUsage: () => this.getContextUsage(),
      compact: (options) => { void this.compact(options?.customInstructions).then((result) => options?.onComplete?.(result), (error: unknown) => options?.onError?.(error instanceof Error ? error : new Error(String(error)))); },
      getSystemPrompt: () => this.systemPrompt, getSystemPromptOptions: () => this.basePrompt,
      executeTool: (id, name, args, options) => this.tools.executeNested(id, name, args, options), getCallableTools: () => this.tools.getCallable(),
    }, {
      registerProvider: (name, config) => { this.modelRuntime.registerProvider(name, config); }, registerNativeProvider: (provider) => { this.modelRuntime.registerNativeProvider(provider); },
      unregisterProvider: (name) => { this.modelRuntime.unregisterProvider(name); }, registerVirtualModel: (definition) => { this.modelRuntime.registerVirtualModel(definition); },
      unregisterVirtualModel: (provider, id) => { this.modelRuntime.unregisterVirtualModel(provider, id); },
    });
    this.extensionRunner.bindCommandContext({ waitForIdle: () => this.journal.conversation.waitForIdle(context),
      newSession: () => Promise.reject(new Error("Use Forgerie's session creation command")), fork: () => Promise.reject(new Error("Use Forgerie's fork command")),
      switchSession: () => Promise.reject(new Error("Use Forgerie's session picker")),
      navigateTree: (id, options) => this.navigateTree(id, options), reload: () => this.reload(),
    });
  }

  private report(error: unknown, event = "extension_action"): void { this.extensionRunner.emitError({ extensionPath: "<durable>", event, error: String(error) }); }

  private promptOptions(): BuildSystemPromptOptions {
    const customPrompt = this.resourceLoader.getSystemPrompt();
    return { cwd: this.options.services.cwd, selectedTools: this.tools.getActive(), contextFiles: this.resourceLoader.getAgentsFiles().agentsFiles,
      skills: this.resourceLoader.getSkills().skills, appendSystemPrompt: this.resourceLoader.getAppendSystemPrompt().join("\n\n"),
      ...(customPrompt === undefined ? {} : { customPrompt }),
      toolSnippets: Object.fromEntries(this.tools.getDefinitions().filter((tool) => tool.promptSnippet !== undefined).map((tool) => [tool.name, tool.promptSnippet ?? ""])),
      toolGuidelines: Object.fromEntries(this.tools.getDefinitions().map((tool) => [tool.name, tool.promptGuidelines ?? []])) };
  }

  async prompt(text: string, options?: PromptRequestOptions & { streamingBehavior?: "steer" | "followUp"; images?: ImageContent[]; expandPromptTemplates?: boolean; source?: PromptOptions["source"]; preflightResult?: PromptOptions["preflightResult"] }): Promise<void> {
    await this.mutation;
    if (this.closed) throw new Error("Session is closed");
    if (options?.requestId !== undefined) {
      const requestId = options.requestId;
      const existing = await this.journal.conversation.commit((tx) => tx.submissionByRequest(this.journal.conversation.id, requestId), context);
      if (existing !== undefined) {
        const submission = await this.journal.harness.submission(existing.id, context);
        if (submission === undefined) throw new Error("Durable prompt submission disappeared");
        await this.receivePromptSubmission(submission, options.preflightResult);
        return;
      }
    }
    if (options?.expandPromptTemplates !== false) {
      const command = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text);
      const registered = command?.[1] === undefined ? undefined : this.extensionRunner.getCommand(command[1]);
      if (registered !== undefined) { await registered.handler(command?.[2] ?? "", this.extensionRunner.createCommandContext()); options?.preflightResult?.("handled"); return; }
      text = await expandSdkPrompt(text, this.promptTemplates);
      if (command?.[1]?.startsWith("skill:") === true) {
        const skill = this.resourceLoader.getSkills().skills.find((candidate) => candidate.name === command[1]?.slice(6));
        if (skill !== undefined) text = formatSkillInvocation({ name: skill.name, location: skill.filePath, baseDir: skill.baseDir }, await readFile(skill.filePath, "utf8"), command[2] ?? "");
      }
    }
    const input = await this.extensionRunner.emitInput(text, options?.images, options?.source ?? "interactive", this.isStreaming ? options?.streamingBehavior : undefined);
    if (input.action === "handled") { options?.preflightResult?.("handled"); return; }
    const images = input.action === "transform" ? input.images : options?.images;
    text = input.action === "transform" ? input.text : text;
    this.basePrompt = this.promptOptions();
    const before = await this.extensionRunner.emitBeforeAgentStart(text, images, this.basePrompt);
    this.tools.setActive(before.systemPromptOptions.selectedTools);
    this.installSdkTools();
    await this.mutation;
    this.systemPrompt = await buildSdkSystemPrompt(before.systemPromptOptions);
    for (const message of before.messages) await this.sendCustomMessage(message);
    const content = images === undefined || images.length === 0 ? text : [{ type: "text" as const, text }, ...images];
    // Only the user's own messages pass here. One answers a stalled run's flag.
    await this.journal.conversation.commit((tx) => acknowledgeWorkflowStall(tx, this.journal.conversation.id), context);
    const submission = await this.journal.conversation.submit({ type: "input", content, ...(options?.requestId === undefined ? {} : { requestId: options.requestId }), ...(options?.streamingBehavior === undefined ? { whenBusy: "reject" as const } : { whenBusy: options.streamingBehavior }) }, context);
    await this.receivePromptSubmission(submission, options?.preflightResult);
  }

  async hasPromptRequest(requestId: string): Promise<boolean> {
    return await this.journal.conversation.commit(async (tx) => (await tx.submissionByRequest(this.journal.conversation.id, requestId)) !== undefined, context);
  }

  private async receivePromptSubmission(submission: Submission, preflightResult?: PromptOptions["preflightResult"]): Promise<void> {
    const state = await submission.status(context);
    preflightResult?.(state.status === "queued" ? "queued" : "started");
    if (state.status === "queued") { this.queued = (await this.journal.harness.snapshot(InboxDoc, this.journal.conversation.id, context))?.items ?? []; return; }
    await submission.wait(context);
    await this.journal.project();
    await this.refreshDurableReads();
  }

  async sendCustomMessage(message: { customType: string; content: string | ({ type: "text"; text: string } | ImageContent)[]; display: boolean; details?: unknown }, options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }): Promise<void> {
    await this.mutation;
    if (this.closed) throw new Error("Session is closed");
    if (message.customType === ASK_USER_ANSWERS_CUSTOM_TYPE) throw new Error("Durable ask answers must use the committed parent delivery receipt");
    this.sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    const customMessage = { role: "custom" as const, ...message, timestamp: Date.now() };
    this.emit({ type: "message_end", message: customMessage });
    if (options?.triggerTurn === true && options.deliverAs !== "nextTurn") {
      // The notification itself is the input. A separate continuation prompt creates a false user message and
      // appending a passive model copy first exposes follow-ups before their requested boundary.
      const submission = await this.journal.submitCustomMessage(message.content, options.deliverAs === "followUp" ? "followUp" : "steer");
      if ((await submission.status(context)).status === "queued") {
        this.queued = (await this.journal.harness.snapshot(InboxDoc, this.journal.conversation.id, context))?.items ?? [];
        return;
      }
      await submission.wait(context);
      await this.journal.project();
    } else {
      for (const modelMessage of convertToLlm([customMessage])) await this.journal.appendMessage(modelMessage);
    }
  }

  async executeBash(command: string, onChunk?: (chunk: string) => void, options?: { excludeFromContext?: boolean }) {
    if (this.bashController !== undefined) throw new Error("A bash command is already running");
    const controller = new AbortController();
    this.bashController = controller;
    try {
      const override = await this.extensionRunner.emitUserBash({ type: "user_bash", command, excludeFromContext: options?.excludeFromContext === true, cwd: this.options.services.cwd });
      const shellPath = this.settingsManager.getShellPath();
      const result = override?.result ?? await executeSdkBash(command, this.options.services.cwd,
        override?.operations ?? createLocalBashOperations(shellPath === undefined ? {} : { shellPath }),
        { signal: controller.signal, ...(onChunk === undefined ? {} : { onChunk }) });
      const message = { role: "bashExecution" as const, command, ...result, excludeFromContext: options?.excludeFromContext === true, timestamp: Date.now() };
      this.sessionManager.appendMessage(message);
      for (const modelMessage of convertToLlm([message])) await this.journal.appendMessage(modelMessage);
      return result;
    } finally { this.bashController = undefined; }
  }

  async compact(instructions?: string): Promise<{ summary: string; tokensBefore: number; firstKeptEntryId: string }> {
    const tokensBefore = this.messages.reduce((total, message) => total + estimateTokens(message), 0);
    this.compactionTask = await this.journal.conversation.compact(instructions, context);
    const task = await this.journal.harness.waitForTask(this.compactionTask, context);
    this.compactionTask = undefined;
    if (task.state.outcome.status !== "completed") throw new Error("Compaction cancelled or failed");
    const id = task.state.outcome.result.submissionId;
    if (id !== undefined) await (await this.journal.harness.submission(id, context))?.wait(context);
    const view = await this.journal.conversation.context(context);
    const summary = view.head?.model?.flatMap((message) => message.role === "user" ? typeof message.content === "string" ? [message.content] : message.content.flatMap((part) => part.type === "text" ? [part.text] : []) : []).join("\n") ?? "";
    await this.refreshDurableReads();
    this.preparedContextTokens = undefined;
    const firstKeptEntryId = this.sessionManager.appendCompaction(summary, this.sessionManager.getLeafId(), tokensBefore);
    return { summary, tokensBefore, firstKeptEntryId };
  }
  abortCompaction(): void { if (this.compactionTask !== undefined) void this.journal.harness.abortTask(this.compactionTask, context).catch((error: unknown) => { this.report(error); }); }
  abortBranchSummary(): void { this.branchSummaryController?.abort(); }
  async abort(): Promise<void> { this.bashController?.abort(); await this.mutation; await this.journal.conversation.abort(context); }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const result = { steering: [...this.getSteeringMessages()], followUp: [...this.getFollowUpMessages()] };
    const queued = this.queued;
    this.queued = [];
    this.mutation = this.mutation.then(async () => { for (const item of queued) if (item.mode !== "write") await this.journal.harness.abortSubmission(item.id, context, this.journal.conversation.id); });
    return result;
  }
  getSteeringMessages(): readonly string[] { return this.queueText("steer"); }
  getFollowUpMessages(): readonly string[] { return this.queueText("followUp"); }
  private queueText(mode: "steer" | "followUp"): string[] {
    return this.queued.flatMap((item) => item.mode !== mode || !("content" in item) ? [] : typeof item.content === "string" ? [item.content] : [item.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n")]);
  }

  async setModel(model: NonNullable<PiAgentSession["model"]>): Promise<void> {
    await this.mutation;
    await this.journal.conversation.configure({ model: { provider: model.provider, modelId: model.id } }, context);
    this.model = model;
    this.sessionManager.appendModelChange(model.provider, model.id);
    this.setThinkingLevel(clampThinkingLevel(model, this.thinkingLevel));
  }
  async cycleModel(direction: "forward" | "backward" = "forward") {
    const models = this.scopedModels.length === 0 ? this.modelRuntime.getAvailableSnapshot() : this.scopedModels.map((scoped) => scoped.model);
    if (models.length < 2) return undefined;
    const index = models.findIndex((model) => model.provider === this.model?.provider && model.id === this.model.id);
    const next = models[(index + (direction === "forward" ? 1 : -1) + models.length) % models.length];
    if (next === undefined) return undefined;
    await this.setModel(next);
    return { model: next };
  }
  getAvailableThinkingLevels(): PiAgentSession["thinkingLevel"][] { return this.model === undefined ? ["off"] : getSupportedThinkingLevels(this.model); }
  setThinkingLevel(level: PiAgentSession["thinkingLevel"]): void {
    this.thinkingLevel = this.model === undefined ? "off" : clampThinkingLevel(this.model, level);
    this.sessionManager.appendThinkingLevelChange(this.thinkingLevel);
    const thinkingLevel = this.thinkingLevel;
    this.mutation = this.mutation.then(() => this.journal.conversation.configure({ thinkingLevel }, context));
    this.emit({ type: "thinking_level_changed", level: this.thinkingLevel });
  }
  cycleThinkingLevel(): PiAgentSession["thinkingLevel"] | undefined {
    const levels = this.getAvailableThinkingLevels();
    if (levels.length < 2) return undefined;
    const next = levels[(levels.indexOf(this.thinkingLevel) + 1) % levels.length];
    if (next !== undefined) this.setThinkingLevel(next);
    return next;
  }
  setSessionName(name: string): void { this.sessionManager.appendSessionInfo(name); this.emit({ type: "session_info_changed", name }); }
  getUserMessagesForForking(): readonly { entryId: string; text: string }[] {
    return this.sessionManager.getBranch().flatMap((entry) => entry.type !== "message" || entry.message.role !== "user" ? [] : [{ entryId: entry.id,
      text: typeof entry.message.content === "string" ? entry.message.content : entry.message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n") }]);
  }
  getSessionStats(): ReturnType<PiAgentSession["getSessionStats"]> {
    const messages = this.messages;
    // Compaction and failed/aborted attempts need not have transcript messages. pi.usage owns spend.
    const { tokens, cost } = durableUsageTotals(this.journal.usage);
    return { sessionId: this.sessionId, totalMessages: messages.length, userMessages: messages.filter((message) => message.role === "user").length,
      assistantMessages: messages.filter((message) => message.role === "assistant").length,
      toolCalls: messages.reduce((count, message) => count + (message.role === "assistant" ? message.content.filter((part) => part.type === "toolCall").length : 0), 0), tokens, cost };
  }
  async refreshDurableReads(): Promise<void> {
    this.modelContext = (await this.journal.conversation.context(context)).messages;
  }
  getContextUsage() {
    if (this.model === undefined || this.modelContext === undefined) return undefined;
    const preparedTokens = this.isStreaming ? this.preparedContextTokens : undefined;
    const prepared = preparedTokens !== undefined;
    // Reset/compaction may remove every positional system entry. Request preparation adds the
    // current prompt and tools again; include those known inputs without rerunning emitContext.
    const active = new Set(this.tools.getActive());
    const tools = this.tools.getDefinitions().filter((tool) => active.has(tool.name)).map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
    const promptTokens = this.modelContext.some((message) => message.role === "system") ? 0 : Math.ceil((this.systemPrompt.length + JSON.stringify(tools).length) / 4);
    const tokens = preparedTokens ?? this.modelContext.reduce((total, message) => total + estimateTokens(message), promptTokens);
    return { tokens, contextWindow: this.model.contextWindow, percent: this.model.contextWindow === 0 ? null : tokens / this.model.contextWindow * 100,
      estimate: prepared ? "prepared-request" as const : "next-request" as const };
  }

  private async summarizeBranch(_source: Conversation, cut: EntryId, instructions: string | undefined): Promise<{ cancelled: boolean; summary?: string }> {
    if (this.model === undefined) throw new Error("No model available for branch summarization");
    const entry = await this.journal.harness.commit((tx) => tx.entry(cut), context);
    const targetId = entry === undefined ? undefined : this.journal.sdkEntryId(entry);
    const oldLeafId = this.sessionManager.getLeafId();
    const collected = targetId === undefined ? { entries: this.sessionManager.getBranch(), commonAncestorId: null }
      : collectEntriesForBranchSummary(this.sessionManager, oldLeafId, targetId);
    const controller = new AbortController();
    this.branchSummaryController = controller;
    const aborted = () => controller.signal.aborted;
    try {
      const before = await this.extensionRunner.emit<SessionBeforeTreeEvent>({ type: "session_before_tree", signal: controller.signal,
        preparation: { targetId: this.branchTargetId ?? targetId ?? "", oldLeafId, commonAncestorId: collected.commonAncestorId,
          entriesToSummarize: collected.entries, userWantsSummary: true, ...(instructions === undefined ? {} : { customInstructions: instructions }) } });
      if (before?.cancel === true || aborted()) return { cancelled: true };
      if (before?.summary !== undefined) return { cancelled: false, summary: before.summary.summary };
      const customInstructions = before?.customInstructions ?? instructions;
      const result = await generateBranchSummary(collected.entries, { model: this.model, signal: controller.signal,
        ...(customInstructions === undefined ? {} : { customInstructions }),
        ...(before?.replaceInstructions === undefined ? {} : { replaceInstructions: before.replaceInstructions }),
        reserveTokens: this.settingsManager.getBranchSummarySettings().reserveTokens,
        streamFn: this.agent.streamFunction, retry: this.settingsManager.getRetrySettings() });
      if (result.aborted === true || aborted()) return { cancelled: true };
      if (result.error !== undefined) throw new Error(result.error);
      if (result.summary === undefined) throw new Error("Branch summary did not provide a summary");
      return { cancelled: false, summary: result.summary };
    } finally { this.branchSummaryController = undefined; }
  }

  async navigateTree(targetId: string, options?: { summarize?: boolean; customInstructions?: string }) {
    await this.flushDurableMutations();
    const oldLeafId = this.sessionManager.getLeafId();
    if (options?.summarize !== true) {
      const before = await this.extensionRunner.emit({ type: "session_before_tree", signal: new AbortController().signal,
        preparation: { targetId, oldLeafId, commonAncestorId: null, entriesToSummarize: [], userWantsSummary: false } });
      if (before?.cancel === true) return { cancelled: true };
    }
    this.branchTargetId = targetId;
    let selected;
    try { selected = await this.nativeHistory.select(targetId, options ?? {}, context); }
    finally { this.branchTargetId = undefined; }
    if (selected.cancelled) return { cancelled: true };
    await this.stream?.stop();
    this.gateUnsubscribe?.();
    await this.taskWatch?.stop();
    await this.childWatch?.stop();
    await this.childRunRecords?.close();
    this.childRunRecords = undefined;
    this.unbindConversation();
    try {
      await this.journal.selectHandle(selected.handle);
      this.bindConversation();
      this.installSdkTools();
      await this.mutation;
      await this.rebindDurableParentState();
      await this.restoreAgentSelection();
      await this.startGatedActions();
      await this.startChildAgents();
      await this.startTaskObservation();
      await this.startEventStream();
    } catch (error) { this.bindConversation(); throw error; }
    this.preparedContextTokens = undefined;
    await this.extensionRunner.emit({ type: "session_tree", newLeafId: this.sessionManager.getLeafId(), oldLeafId });
    this.emit({ type: "durable_parent_state_changed" });
    return { cancelled: false, ...(selected.editorText === undefined ? {} : { editorText: selected.editorText }) };
  }
  async reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void> {
    if (this.isStreaming) throw new Error("Cannot reload an active session");
    const old = this.extensionRunner;
    const ui = old.getUIContext();
    const flags = old.getFlagValues();
    await old.emit({ type: "session_shutdown", reason: "reload" });
    await this.settingsManager.reload();
    await this.resourceLoader.reload();
    const loaded = this.resourceLoader.getExtensions();
    for (const [name, value] of flags) loaded.runtime.flagValues.set(name, value);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, this.options.services.cwd, this.sessionManager, new ModelRegistry(this.modelRuntime));
    runner.setUIContext(ui, "rpc");
    if (this.errorListener !== undefined) runner.onError(this.errorListener);
    this.runner = runner;
    this.tools = new DurableSdkTools({ cwd: this.options.services.cwd, settings: this.settingsManager, runner, customTools: this.customTools,
      ...(this.options.decisionHints === undefined ? {} : {riskLabels: {hints: this.options.decisionHints, onError: (error: unknown) => { this.report(error, DECISION_HINT_ERROR_EVENT); },
        record: (conversation: ConversationId, id: string, label: RiskLabel, identity: RiskToolIdentity) => this.recordToolRiskLabel(conversation, id, label, identity)}}),
      beforeCall: () => this.journal.project(), gateNested: (call, api, index, ctx) => {
        if (this.gateOptions === undefined) throw new Error("Nested gated actions are not bound");
        return gateToolCall(this.gateOptions, call, api, ctx, {index, cwd: this.options.services.cwd, extension: `forgerie.sdk-tools:${this.sessionId}:nested`});
      }, emit: (event) => { this.emit(event); } });
    this.bindCore();
    this.installSdkTools();
    await this.mutation;
    this.basePrompt = this.promptOptions();
    this.systemPrompt = await buildSdkSystemPrompt(this.basePrompt);
    if (this.options.childAgents !== undefined) {
      const { extensions, workflow, decision } = await this.installChildExtensions();
      const retained = (await this.journal.conversation.agent(context)).extensions.filter(item => !extensions.childOnly.some(child => child.name === item.name));
      await this.journal.conversation.configure({extensions: [...new Map([...retained, ...extensions.parent, workflow, decision].map(item => [item.name, item])).values()]}, context);
    }
    old.invalidate("Durable extensions reloaded");
    await options?.beforeSessionStart?.();
    await runner.emit({ type: "session_start", reason: "reload" });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.emit({ type: "session_retired" });
    await this.detachProcessEvents?.();
    this.bashController?.abort();
    this.branchSummaryController?.abort();
    this.gateUnsubscribe?.();
    await this.taskWatch?.stop();
    await this.childWatch?.stop();
    await this.parentAppWatch?.stop();
    this.sdkView?.close();
    await this.flushDurableMutations();
    this.unbindConversation();
    await this.journal.close();
    await this.childRunRecords?.close();
    await this.stream?.stop();
    await this.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    this.extensionRunner.invalidate("Durable session closed");
    this.modelContext = undefined; this.preparedContextTokens = undefined;
    this.listeners.clear();
  }

  private async applyEvent(event: AgentEvent): Promise<void> {
    await this.journal.project();
    await this.refreshDurableReads();
    if (event.type === "snapshot" || event.type === "run_start") {
      const input = (event.type === "snapshot" ? event.run?.inputs : event.inputs)?.[0];
      this.runStartedAt = undefined;
      if (input !== undefined) {
        // Run inputs survive generation handovers and recovery. Steers append to them; follow-ups
        // start a new list. The first user entry is stamped at placement, not at queue admission.
        try {
          const submission = await (await this.journal.harness.submission(input, context))?.status(context);
          if (submission?.entry === undefined) throw new Error(`Durable run input ${String(input)} has no committed entry`);
          const entries = await this.journal.conversation.entries({ minEntryId: submission.entry, maxEntryId: submission.entry }, 1, undefined, context);
          const message = entries.items[0]?.model?.find((candidate) => candidate.role === "user");
          if (message === undefined) throw new Error(`Durable run input ${String(input)} has no committed user message`);
          this.runStartedAt = new Date(message.timestamp).toISOString();
        } catch (error) {
          // Display-only recovery must not prevent attachment or terminate the event watch.
          this.report(new Error(`Could not recover Durable run start for input ${String(input)}: ${String(error)}`, { cause: error }));
        }
      }
    }
    switch (event.type) {
      case "snapshot":
        this.streaming = event.run !== undefined;
        this.partial = event.generation?.message;
        this.compacting = event.compactions.length > 0;
        this.queued = (await this.journal.harness.snapshot(InboxDoc, this.journal.conversation.id, context))?.items ?? [];
        break;
      case "run_start": this.streaming = true; this.emit({ type: "agent_start" }); await this.extensionRunner.emit({ type: "agent_start" }); break;
      case "run_end":
        this.streaming = false; this.runStartedAt = undefined; this.partial = undefined; this.preparedContextTokens = undefined;
        this.emit({ type: "agent_end", messages: this.messages, willRetry: false });
        await this.extensionRunner.emit({ type: "agent_end", messages: this.messages });
        this.emit({ type: "agent_settled", aborted: false }); await this.extensionRunner.emit({ type: "agent_settled", aborted: false });
        break;
      case "message_start":
        if (event.message.role !== "assistant") { this.emit(event); break; }
        // The first commit can already hold text. As in the SDK, the start is empty and that text follows as deltas.
        this.partial = { ...structuredClone(event.message), content: [] };
        this.emit({ type: "message_start", message: structuredClone(this.partial) });
        if (event.message.content.length > 0) this.emitChanges([{ type: "message", message: event.message }]);
        break;
      case "message_update":
        this.emitChanges(event.changes);
        break;
      case "message_end":
        // A model copy, such as a custom message's user form, already showed in its own form. Live must match the projection.
        if (!this.journal.isTranscriptEntry(event.entry)) break;
        for (const message of withRiskAnnotations(this.journal.harness, this.journal.conversation.id,
          withToolInvocationIds(this.journal.conversation.id, event.entry.model ?? [], event.entry.id))) this.emit({ type: "message_end", message });
        this.partial = undefined;
        break;
      case "tool_execution_start": this.emit(event); break;
      case "tool_execution_update": this.emit({ ...event, partialResult: event.details }); break;
      case "tool_execution_end": {
        const result = event.entry?.model?.find((message) => message.role === "toolResult");
        // Durable coalesces rapid updates into the terminal commit. Publish that
        // committed state before ending the SDK step so progress cannot stay stale.
        if (result !== undefined) this.emit({ ...event, type: "tool_execution_update", partialResult: result });
        this.emit({ ...event, result, isError: result?.isError ?? true });
        break;
      }
      case "inbox_update": this.queued = (await this.journal.harness.snapshot(InboxDoc, this.journal.conversation.id, context))?.items ?? []; this.emit({ type: "queue_update", steering: this.getSteeringMessages(), followUp: this.getFollowUpMessages() }); break;
      case "compaction_start": this.compacting = true; this.emit({ type: "compaction_start", reason: event.reason }); break;
      case "compaction_end": this.compacting = false; this.emit({ type: "compaction_end", reason: event.reason, result: undefined, aborted: false, willRetry: false }); break;
      case "task_failed": this.report(event.message); break;
      case "entry_appended":
        // A child's question, the user's answer, or a steer is a write entry. Show it live as a display-only message.
        if (isHostEntryKind(event.entry.kind)) {
          this.emit({ type: "message_end", message: { role: "custom", customType: event.entry.kind, content: hostEntryText(event.entry.kind, event.entry.data), display: true, details: event.entry.data, timestamp: Date.now() } });
        }
        this.emit(event);
        break;
      case "submission":
      case "turn_start":
      case "turn_end":
      case "auto_retry_start":
      case "auto_retry_end":
      case "deferred_poll":
      case "agent_changed":
      case "usage_changed": this.emit(event); break;
    }
  }

  private async restoreAgentSelection(): Promise<void> {
    // A reopened root ignores creation options. Its native state, not the JSONL projection, owns the selection.
    const agent = await this.journal.conversation.agent(context);
    this.model = agent.model === undefined ? undefined : this.modelRuntime.getModel(agent.model.provider, agent.model.modelId);
    this.thinkingLevel = agent.thinkingLevel;
    const saved = this.sessionManager.buildSessionContext();
    if (agent.model !== undefined && (saved.model?.provider !== agent.model.provider || saved.model.modelId !== agent.model.modelId)) {
      this.sessionManager.appendModelChange(agent.model.provider, agent.model.modelId);
    }
    if (saved.thinkingLevel !== this.thinkingLevel || !this.sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change")) {
      this.sessionManager.appendThinkingLevelChange(this.thinkingLevel);
    }
  }

  /** SDK readers follow starts and deltas, so text that Durable coalesced into one commit is restated as deltas. */
  private emitChanges(changes: readonly MessageChange[]): void {
    this.partial = applySdkCommit(this.partial, changes, (change, partial) => {
      this.partial = partial;
      this.emit({ type: "message_update", message: partial, assistantMessageEvent: { ...change, partial } });
    });
  }
}
