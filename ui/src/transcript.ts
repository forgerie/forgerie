import { RISK_LABEL_ENTRY_KIND, type RiskLabel } from "@shared/riskLabels";
import { riskLabelEntryOf, messageRiskLabels, riskWords, type RiskWords } from "./riskLabelsModel";
import type { CompleteAttachment, ThreadMessageLike } from "@assistant-ui/react";
import { outputOf, partsOf, textOf, type PiMessage, type SessionEvent } from "./contracts";
import { imageSource } from "./images";
import { handoffDoorOf, type HandoffDoor } from "./handoffDoor";
import { parseSkillInvocation, skillLoadOf, type SkillInvocation } from "./skills";
import { STEP_PREFIX } from "./ui/stepPart";
import { PULL_NOTICE_TYPE, pullNoticeOf, type PullNotice } from "./pullRequests/pullNotice";
import { PROCESS_EVENT_TYPE, parseProcessEvent, type ProcessEvent } from "./processes/processEvent";
import { ACTION_RUN_NOTICE_TYPE, actionRunNoticeOf, type ActionRunNotice } from "./actionRuns/actionRunNotice";
import { childEntryOf, type ChildEntry } from "./childAgents/childAgentsModel";
import { isOldIssueOutcome, oldIssueOutcomeOf, oldIssueProposalOf, type OldIssueProposal } from "./issues/oldIssueProposal";
import { issueOutcomeFrom, issueOutcomeOf, type IssueOutcome } from "./issues/fileIssueResult";
import { workflowEntryOf, type WorkflowEntry } from "./workflows/workflowsModel";
import { gatedEntryOf, type GatedActionEntry } from "./gatedActions/gatedActionsModel";
import { appendOutput, finishRun, interruptRun, isRecordOf, isSameRun, isSavedCopy, reopenRun, runFromRecord, shellText, startedRun, unknownRun,
  type ShellEnd, type ShellRun } from "./shellRun";

/**
 * One tool execution. A call id owns exactly one state, whether the call
 * arrived in an assistant message, through `tool.*` events, or both.
 */
export type ToolState =
  | { type: "pending" }
  | { type: "running"; output: string }
  | { type: "done"; output: string; isError: boolean; images?: readonly string[]; door?: HandoffDoor; issue?: IssueOutcome }
  | { type: "interrupted" };
export type TranscriptPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  /** An image the assistant itself produced. User images are attachments. */
  | { type: "image"; src: string }
  | { type: "tool"; id: string; invocationId?: string; name: string; args: unknown; state: ToolState; riskLabel?: RiskLabel }
  /** A `!` command the user ran. It is the only part of a `shell` message. */
  | { type: "shell"; run: ShellRun };
/** The skill a user message invoked. Its typed argument stays in the message's text. */
export type SkillRecord = Omit<SkillInvocation, "argument">;
export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "system" | "shell";
  parts: readonly TranscriptPart[];
  attachments?: CompleteAttachment[];
  skill?: SkillRecord;
  key?: string;
  provisional?: boolean;
  failure?: "error" | "cancelled";
  /** A system message that summarizes earlier history. Its text is the summary alone. */
  summary?: HistorySummaryKind;
  /** A pull request event the server wrote into the transcript: a watcher wake or a merge from the panel. */
  pullNotice?: PullNotice;
  /** A managed process finished, failed, stopped, or printed a watched line. */
  processEvent?: ProcessEvent;
  /** The Actions run watcher woke the agent: failed jobs, a new attempt, or the run's conclusion. */
  actionRunNotice?: ActionRunNotice;
  /** A child agent asked, was answered, was steered, or reported back. */
  childEntry?: ChildEntry;
  /** A workflow started, waits at a stop, or passed on the reader's decision. */
  workflowEntry?: WorkflowEntry;
  /** A call Forgerie holds until the reader approves it. */
  gatedAction?: GatedActionEntry;
  /**
   * The message's index in the `/messages` list it was read from. A search
   * match names a message by it. A message first seen live has none until
   * the next history read.
   */
  position?: number;
  /** The thread marks this message, such as the search match the reader opened. */
  marked?: boolean;
  /** An issue proposal from before agents filed issues themselves, with what the branch records became of it. */
  oldIssueProposal?: OldIssueProposal;
}
/** Compaction replaces earlier messages with a summary; a branch summary describes the branch the session left. */
export type HistorySummaryKind = "compaction" | "branch";
export interface Transcript {
  messages: readonly TranscriptMessage[];
  liveId?: string;
  nextId: number;
  isRunning: boolean;
  error?: string;
}
type ToolPart = Extract<TranscriptPart, { type: "tool" }>;

function keyOf(message: PiMessage): string | undefined {
  return message.timestamp === undefined ? undefined : `${message.role}:${message.timestamp}`;
}
/** Renderable images in tool output, as data URLs. Unsupported or empty parts are skipped. */
export function imagesOf(content: unknown): readonly string[] {
  if (!Array.isArray(content)) return [];
  return partsOf({ role: "toolResult", content }).flatMap((part) => {
    const src = part.type === "image" ? imageSource(part) : undefined;
    return src ? [src] : [];
  });
}
function toParts(message: PiMessage): TranscriptPart[] {
  const parts = partsOf(message).flatMap((part): TranscriptPart[] => {
    switch (part.type) {
      case "text": return part.text === "" ? [] : [{ type: "text", text: part.text }];
      case "thinking": return part.thinking.trim() === "" ? [] : [{ type: "thinking", text: part.thinking }];
      case "toolCall": {
        const invocationId = message.toolInvocations?.[part.id];
        const riskLabel = invocationId === undefined ? undefined : messageRiskLabels(message).find(entry => entry.invocationId === invocationId)?.label;
        return [{ type: "tool", id: part.id, ...(invocationId === undefined ? {} : {invocationId}), name: part.name, args: part.arguments,
          state: {type: "pending"}, ...(riskLabel === undefined ? {} : {riskLabel}) }];
      }
      case "image": {
        const src = message.role === "assistant" ? imageSource(part) : undefined;
        return src ? [{ type: "image", src }] : [];
      }
    }
  });
  const hasText = parts.some((part) => part.type === "text");
  return !hasText && message.errorMessage ? [...parts, { type: "text", text: message.errorMessage }] : parts;
}
/** A user message that is exactly Pi's expanded skill block becomes the invocation plus its argument. */
function skillOf(message: PiMessage): { skill: SkillRecord; parts: TranscriptPart[] } | undefined {
  const texts = partsOf(message).filter((part) => part.type === "text");
  const invocation = texts.length === 1 ? parseSkillInvocation(texts[0]!.text) : undefined;
  if (!invocation) return undefined;
  const { argument, ...skill } = invocation;
  return { skill, parts: argument === undefined ? [] : [{ type: "text", text: argument }] };
}
// The server prefixes each summary with a heading line. The marker names the kind, so only the summary stays.
const summarySources: Record<string, { kind: HistorySummaryKind; heading: RegExp }> = {
  compaction: { kind: "compaction", heading: /^Compacted history:\s*/u },
  branch_summary: { kind: "branch", heading: /^Branch summary:\s*/u },
};
function asSummary(message: PiMessage, id: string): TranscriptMessage | undefined {
  const source = message.role === "system" && message.source !== undefined ? summarySources[message.source] : undefined;
  if (!source) return undefined;
  const text = textOf(message).replace(source.heading, "").trim();
  return { id, role: "system", parts: text ? [{ type: "text", text }] : [], summary: source.kind };
}
function asMessage(message: PiMessage, id: string): TranscriptMessage | undefined {
  const summary = asSummary(message, id);
  if (summary) return summary;
  const role = message.role;
  const oldIssueProposal = oldIssueProposalOf(message);
  if (oldIssueProposal) return { id, role: "system", parts: [{ type: "text", text: textOf(message) }], oldIssueProposal, key: keyOf(message) };
  if (isOldIssueOutcome(message)) return undefined;
  if (role === "custom" && message.customType === PULL_NOTICE_TYPE) {
    const text = textOf(message);
    return { id, role: "system", parts: [{ type: "text", text }], pullNotice: pullNoticeOf(text, message.details), key: keyOf(message) };
  }
  if (role === "custom" && message.customType === ACTION_RUN_NOTICE_TYPE) {
    const text = textOf(message);
    return { id, role: "system", parts: [{ type: "text", text }], actionRunNotice: actionRunNoticeOf(text), key: keyOf(message) };
  }
  if (role === "custom" && message.customType === PROCESS_EVENT_TYPE) {
    const text = textOf(message);
    const processEvent = parseProcessEvent(text, message.timestamp);
    // An event this app cannot read still shows, as plain system text.
    return { id, role: "system", parts: [{ type: "text", text }], ...(processEvent ? { processEvent } : {}), key: keyOf(message) };
  }
  const gatedAction = role === "custom" ? gatedEntryOf(message) : undefined;
  if (gatedAction) return { id, role: "system", parts: [{ type: "text", text: textOf(message) }], gatedAction, key: keyOf(message) };
  // A workflow's launch and each decision are user messages to the parent model, but the reader did not type them.
  const workflowEntry = role === "custom" || role === "user" ? workflowEntryOf(message) : undefined;
  if (workflowEntry) return { id, role: "system", parts: [{ type: "text", text: textOf(message) }], workflowEntry, key: keyOf(message) };
  // A child's report is a user message to the parent model, but the reader did not write it.
  const childEntry = role === "custom" || role === "user" ? childEntryOf(message) : undefined;
  if (childEntry) return { id, role: "system", parts: [{ type: "text", text: textOf(message) }], childEntry, key: keyOf(message) };
  if (role === "bashExecution") return { id, role: "shell", parts: [{ type: "shell", run: runFromRecord(message) }], key: keyOf(message) };
  if (role !== "user" && role !== "assistant" && role !== "system") return undefined;
  const invoked = role === "user" ? skillOf(message) : undefined;
  const parts = invoked?.parts ?? toParts(message);
  const attachments: CompleteAttachment[] = role === "user" ? partsOf(message).flatMap((part, index) => {
    const image = part.type === "image" ? imageSource(part) : undefined;
    if (part.type !== "image" || !image) return [];
    return [{ id: `${id}-image-${index}`, type: "image", name: `Image ${index + 1}`, contentType: part.mimeType,
      status: { type: "complete" }, content: [{ type: "image", image }] }];
  }) : [];
  if (parts.length === 0 && attachments.length === 0 && !invoked) return undefined;
  const failure = role !== "assistant" ? undefined
    : message.stopReason === "error" ? "error" : message.stopReason === "aborted" ? "cancelled" : undefined;
  return { id, role, parts, ...(attachments.length ? { attachments } : {}), ...(invoked ? { skill: invoked.skill } : {}),
    key: keyOf(message), ...(failure ? { failure } : {}) };
}

function toolIds(messages: readonly TranscriptMessage[], except?: string): Set<string> {
  return new Set(messages.flatMap((message) => message.id === except ? []
    : message.parts.flatMap((part) => part.type === "tool" ? [part.invocationId ?? part.id] : [])));
}
function mapTool(messages: readonly TranscriptMessage[], id: string,
  update: (part: ToolPart) => ToolPart, byInvocation = false): readonly TranscriptMessage[] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const partIndex = message.parts.findIndex((part) => part.type === "tool" && (byInvocation ? part.invocationId === id : part.id === id));
    if (partIndex < 0) continue;
    const parts = message.parts.map((part, i) => i === partIndex && part.type === "tool" ? update(part) : part);
    return messages.map((current, i) => i === index ? { ...message, parts } : current);
  }
  return undefined;
}
function toolMessage(state: Transcript, part: ToolPart): Transcript {
  return { ...state, nextId: state.nextId + 1,
    messages: [...state.messages, { id: `tool-${state.nextId}`, role: "assistant", parts: [part] }] };
}
/** A finished call: its text, its images, the session it created, and what it did with an issue, if any. */
function settled(toolName: string, output: string, isError: boolean, content: unknown, details: unknown): ToolState {
  const images = imagesOf(content);
  const door = handoffDoorOf({ toolName, isError, details });
  const issue = issueOutcomeOf({ toolName, isError, details });
  return { type: "done", output, isError, ...(images.length ? { images } : {}), ...(door ? { door } : {}), ...(issue ? { issue } : {}) };
}
function finishTool(state: Transcript, id: string | undefined, name: string, done: ToolState): Transcript {
  if (!id) return state;
  const messages = mapTool(state.messages, id, (part) => ({ ...part, state: done }));
  return messages ? { ...state, messages } : toolMessage(state, { type: "tool", id, name, args: undefined, state: done });
}
/** Tool calls that did not finish can no longer finish once their run is over. */
function interruptOpenTools(messages: readonly TranscriptMessage[], from = 0): readonly TranscriptMessage[] {
  return messages.map((message, index) => index < from || !message.parts.some(isOpenTool) ? message
    : { ...message, parts: message.parts.map((part): TranscriptPart => isOpenTool(part) ? { ...part, state: { type: "interrupted" } } : part) });
}
function isOpenTool(part: TranscriptPart): part is ToolPart {
  return part.type === "tool" && (part.state.type === "pending" || part.state.type === "running");
}
/**
 * Keep one execution per call id. A tool already known elsewhere is dropped;
 * one already in the message being replaced keeps its current state.
 */
function reconcileTools(message: TranscriptMessage, messages: readonly TranscriptMessage[], replaced?: TranscriptMessage): TranscriptMessage {
  const elsewhere = toolIds(messages, replaced?.id);
  const current = new Map(replaced?.parts.flatMap((part) => part.type === "tool" ? [[part.invocationId ?? part.id, part] as const] : []));
  const parts = message.parts.flatMap((part): TranscriptPart[] => {
    if (part.type !== "tool") return [part];
    if (elsewhere.has(part.invocationId ?? part.id)) return [];
    const existing = current.get(part.invocationId ?? part.id) ?? [...current.values()].find(previous => previous.invocationId === undefined && previous.id === part.id);
    return [existing ? { ...part, state: existing.state, ...(existing.riskLabel ? {riskLabel: existing.riskLabel} : {}) } : part];
  });
  return { ...message, parts };
}
function appendLive(state: Transcript, type: "text" | "thinking", text: string): Transcript {
  const live = state.messages.find((message) => message.id === state.liveId);
  if (!live) {
    const id = `live-${state.nextId}`;
    return { ...state, liveId: id, nextId: state.nextId + 1, isRunning: true,
      messages: [...state.messages, { id, role: "assistant", parts: [{ type, text }] }] };
  }
  const last = live.parts.at(-1);
  const parts = last?.type === type
    ? [...live.parts.slice(0, -1), { ...last, text: last.text + text }]
    : [...live.parts, { type, text }];
  return { ...state, messages: state.messages.map((message) => message === live ? { ...live, parts } : message) };
}
function shellRunOf(message: TranscriptMessage): ShellRun | undefined {
  const part = message.role === "shell" ? message.parts[0] : undefined;
  return part?.type === "shell" ? part.run : undefined;
}
export function hasRunningShell(transcript: Transcript): boolean {
  return transcript.messages.some((message) => shellRunOf(message)?.result.type === "running");
}
function appendShell(state: Transcript, run: ShellRun): Transcript {
  return { ...state, nextId: state.nextId + 1,
    messages: [...state.messages, { id: `shell-${state.nextId}`, role: "shell", parts: [{ type: "shell", run }] }] };
}
/**
 * The server runs one command at a time, so output belongs to the newest shell
 * row while it runs. A join can close that row before its last events arrive,
 * because the status read and the socket are separate connections, so late
 * output reopens it instead of starting a second row.
 */
function updateRunningShell(state: Transcript, update: (run: ShellRun) => ShellRun): Transcript | undefined {
  const index = state.messages.findLastIndex((message) => shellRunOf(message) !== undefined);
  const message = state.messages[index];
  const current = message && shellRunOf(message);
  if (!message || !current || current.result.type !== "running" && current.result.type !== "interrupted") return undefined;
  const run = update(reopenRun(current));
  return { ...state, messages: state.messages.map((item, i) => i === index ? { ...message, parts: [{ type: "shell", run }] } : item) };
}
function interruptOpenShells(messages: readonly TranscriptMessage[]): readonly TranscriptMessage[] {
  return messages.map((message) => {
    const run = shellRunOf(message);
    return run?.result.type === "running" ? { ...message, parts: [{ type: "shell", run: interruptRun(run) }] } : message;
  });
}
function reduceShell(state: Transcript, event: Extract<SessionEvent, { type: `shell.${string}` }>): Transcript {
  switch (event.type) {
    case "shell.start": return appendShell({ ...state, messages: interruptOpenShells(state.messages) },
      startedRun(event.command, event.excludeFromContext));
    case "shell.chunk": return updateRunningShell(state, (run) => appendOutput(run, event.chunk))
      ?? appendShell(state, appendOutput(unknownRun, event.chunk));
    case "shell.end": return updateRunningShell(state, (run) => finishRun(run, event))
      ?? appendShell(state, finishRun(unknownRun, event));
  }
}

/**
 * An old outcome entry is never a row: it folds into its proposal, and an
 * unreadable one changes nothing. The first outcome on the branch wins.
 */
function foldOldIssueOutcome(state: Transcript, raw: PiMessage): Transcript | undefined {
  if (!isOldIssueOutcome(raw)) return undefined;
  const decision = oldIssueOutcomeOf(raw);
  if (!decision) return state;
  return { ...state, messages: state.messages.map((message) => message.oldIssueProposal?.proposalId === decision.proposalId
    && message.oldIssueProposal.outcome === undefined ? { ...message, oldIssueProposal: { ...message.oldIssueProposal, outcome: decision.outcome } } : message) };
}

/** Opinions fold into the existing row, never into execution state or an extra model message. */
function foldRiskLabel(state: Transcript, raw: PiMessage): Transcript | undefined {
  if (raw.role !== "custom" || raw.customType !== RISK_LABEL_ENTRY_KIND) return undefined;
  const entry = riskLabelEntryOf(raw);
  if (entry === undefined) return state;
  const messages = entry.target === "tool" ? mapTool(state.messages, entry.invocationId, part => ({...part, riskLabel: entry.label}), true)
    : state.messages.map(message => message.gatedAction?.id === entry.id
      ? {...message, gatedAction: {...message.gatedAction, riskLabel: entry.label}} : message);
  return messages === undefined ? state : {...state, messages};
}

function applyMessage(state: Transcript, raw: PiMessage, provisional: boolean): Transcript {
  const folded = foldRiskLabel(state, raw) ?? foldOldIssueOutcome(state, raw);
  if (folded) return folded;
  const proposalId = oldIssueProposalOf(raw)?.proposalId;
  // History and buffered custom-message events can overlap without a shared timestamp.
  if (proposalId !== undefined && state.messages.some((message) => message.oldIssueProposal?.proposalId === proposalId)) return state;
  if (raw.role === "toolResult") return finishResult(state, raw);
  const key = keyOf(raw);
  if (key !== undefined && state.messages.some((message) => message.key === key)) return state;
  const parsed = asMessage(raw, `message-${state.nextId}`);
  const liveId = raw.role === "assistant" ? undefined : state.liveId;
  if (!parsed) return { ...state, liveId };
  const last = state.messages.at(-1);
  // Pi echoes a user without a timestamp before emitting its persisted message_end.
  const replaceId = raw.role === "assistant" ? state.liveId
    : last?.role === "user" && last.provisional && messageText(last) === messageText(parsed)
      && last.skill?.name === parsed.skill?.name ? last.id : undefined;
  const replaced = state.messages.find((message) => message.id === replaceId);
  const next = { ...reconcileTools(parsed, state.messages, replaced), id: replaced?.id ?? parsed.id, provisional };
  const empty = next.parts.length === 0 && !next.attachments?.length && !next.skill;
  const messages = replaced === undefined ? (empty ? state.messages : [...state.messages, next])
    : state.messages.flatMap((current) => current !== replaced ? [current] : empty ? [] : [next]);
  return { ...state, nextId: state.nextId + 1, liveId, messages, error: raw.errorMessage ?? state.error };
}
function finishResult(state: Transcript, raw: PiMessage): Transcript {
  const name = raw.toolName ?? "tool";
  return finishTool(state, raw.toolCallId, name, settled(name, outputOf(raw), raw.isError === true, raw.content, raw.details));
}
export function messageText(message: TranscriptMessage): string {
  return message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
}

export function fromHistory(history: readonly PiMessage[], isRunning = false, start = 0): Transcript {
  let state: Transcript = { messages: [], nextId: 0, isRunning };
  history.forEach((raw, index) => {
    const folded = foldRiskLabel(state, raw) ?? foldOldIssueOutcome(state, raw);
    if (folded) { state = folded; return; }
    const parsed = raw.role === "toolResult" ? undefined : asMessage(raw, raw.id ?? `history-${start + index}`);
    state = raw.role === "toolResult" ? finishResult(state, raw)
      : parsed ? { ...state, messages: [...state.messages, { ...reconcileTools(parsed, state.messages), position: start + index }] } : state;
  });
  // Only the current turn of a running session can still have open tools.
  const lastUser = state.messages.findLastIndex((message) => message.role === "user");
  const messages = isRunning ? interruptOpenTools(state.messages.slice(0, lastUser + 1)).concat(state.messages.slice(lastUser + 1))
    : interruptOpenTools(state.messages);
  return { ...state, messages, nextId: Math.max(state.nextId, history.length) };
}

/**
 * A finished shell row lives only in memory until Pi saves its record, and Pi
 * defers that to the end of an agent run. No event announces the save, so a
 * join keeps such rows, after the message they followed, until the history
 * returns the record or the join replayed the same row. Failed commands are
 * never saved, so their rows stay for the life of the page.
 */
export function carryUnsavedShellRows(previous: Transcript, refreshed: Transcript): Transcript {
  const messages = [...refreshed.messages];
  const ids = new Set(messages.map((message) => message.id));
  const carried = new Set<string>();
  const matched = new Set<string>();
  let nextId = refreshed.nextId;
  let anchor: string | undefined;
  for (const message of previous.messages) {
    if (message.key) { anchor = message.key; continue; }
    const run = shellRunOf(message);
    if (!run || run.result.type !== "done" && run.result.type !== "failed") continue;
    const at = anchor === undefined ? -1 : messages.findIndex((item) => item.key === anchor);
    const replayed = messages.slice(at + 1).find((item) => !item.key && !carried.has(item.id) && !matched.has(item.id) && shellRunOf(item) && isSameRun(shellRunOf(item)!, run));
    // Each replayed/saved row consumes one previous run, not every identical command.
    const saved = messages.slice(at + 1).find((item) => item.key && !matched.has(item.id) && shellRunOf(item) && isSavedCopy(shellRunOf(item)!, run));
    const copy = replayed ?? saved;
    if (copy) { matched.add(copy.id); continue; }
    let index = anchor === undefined ? 0 : at < 0 ? messages.length : at + 1;
    while (index < messages.length && carried.has(messages[index]!.id)) index++;
    const id = ids.has(message.id) ? `carried-${nextId++}` : message.id;
    ids.add(id); carried.add(id);
    messages.splice(index, 0, { ...message, id });
  }
  return carried.size === 0 ? refreshed : { ...refreshed, messages, nextId };
}

/** Retain persisted identities across an authoritative reload without ID collisions. */
export function reconcileTranscriptIdentity(previous: Transcript, refreshed: Transcript): Transcript {
  const previousById = new Map(previous.messages.map(message => [message.id, message]));
  const ids = new Map(previous.messages.flatMap((message) => message.key ? [[message.key, message.id]] : []));
  const reserved = new Set(refreshed.messages.flatMap((message) => {
    const id = message.key ? ids.get(message.key) : undefined;
    return id === undefined ? [] : [id];
  }));
  let nextId = Math.max(previous.nextId, refreshed.nextId);
  let liveId = refreshed.liveId;
  const messages = refreshed.messages.map((message) => {
    const retained = previousById.has(message.id) && message.id.startsWith("history-") === false ? message.id : message.key ? ids.get(message.key) : undefined;
    const id = retained ?? (reserved.has(message.id) ? `resync-${nextId++}` : message.id);
    if (message.id === refreshed.liveId) liveId = id;
    const candidate = { ...message, id };
    const old = previousById.get(id);
    return old !== undefined && JSON.stringify(old) === JSON.stringify(candidate) ? old : candidate;
  });
  return { ...refreshed, messages, nextId, liveId };
}

export function reduceEvent(state: Transcript, event: SessionEvent): Transcript {
  switch (event.type) {
    case "agent.start": return { ...state, isRunning: true, error: undefined };
    case "agent.end": return {
      ...state, isRunning: false, liveId: undefined,
      messages: interruptOpenTools(state.messages.map((message) => message.id === state.liveId
        ? { ...message, failure: "cancelled" } : message)),
    };
    case "session.error": return { ...state, error: event.message };
    case "assistant.delta": return appendLive(state, "text", event.text);
    case "assistant.thinking.delta": return appendLive(state, "thinking", event.text);
    case "tool.start": {
      const messages = mapTool(state.messages, event.toolCallId, (part) => ({
        ...part, args: part.args ?? event.args,
        state: part.state.type === "pending" ? { type: "running", output: "" } : part.state,
      }));
      if (messages) return { ...state, messages };
      return toolMessage(state, { type: "tool", id: event.toolCallId, name: event.toolName, args: event.args,
        state: { type: "running", output: "" } });
    }
    case "tool.update": {
      const messages = mapTool(state.messages, event.toolCallId, (part) => part.state.type === "done" || part.state.type === "interrupted"
        ? part : { ...part, state: { type: "running", output: event.text } });
      return messages ? { ...state, messages } : state;
    }
    case "tool.end": return finishTool(state, event.toolCallId, event.toolName,
      settled(event.toolName, event.text, event.isError, event.content, event.details));
    case "shell.start":
    case "shell.chunk":
    case "shell.end": return reduceShell(state, event);
    case "message.append":
    case "message.end": return event.message ? applyMessage(state, event.message, event.type === "message.append") : state;
  }
}

/**
 * Buffered shell events whose command the history read already returned. The
 * history read precedes the watermark, so a finished command may be in both.
 * Saved records keep execution order, so the observed commands that were saved
 * form a prefix of the buffer and match the last saved records, in order.
 */
function savedShellEvents(state: Transcript, buffered: readonly SessionEvent[], seq: number): Set<SessionEvent> {
  const executions: { events: SessionEvent[]; command?: string; end?: ShellEnd }[] = [];
  let open: (typeof executions)[number] | undefined;
  for (const event of buffered) {
    if (event.type !== "shell.start" && event.type !== "shell.chunk" && event.type !== "shell.end") continue;
    if (event.type === "shell.start" || !open) { open = { events: [], ...(event.type === "shell.start" ? { command: event.command } : {}) }; executions.push(open); }
    open.events.push(event);
    if (event.type === "shell.end") { open.end = event; open = undefined; }
  }
  // Pi never saves a command that failed to run, so it cannot match a record.
  const finished = executions.filter((execution) => execution.end && execution.end.isError !== true && (execution.end.seq ?? Infinity) <= seq);
  const saved = state.messages.flatMap((message) => { const run = shellRunOf(message); return run ? [run] : []; });
  for (let count = Math.min(finished.length, saved.length); count > 0; count--) {
    const tail = saved.slice(saved.length - count);
    if (finished.slice(0, count).every((execution, index) => isRecordOf(tail[index]!, { command: execution.command, end: execution.end! }))) {
      return new Set(finished.slice(0, count).flatMap((execution) => execution.events));
    }
  }
  return new Set();
}

export function seedTranscript(history: readonly PiMessage[], partial: PiMessage | null, seq: number,
  isRunning: boolean, buffered: readonly SessionEvent[], bashRunning = false): Transcript {
  let state = fromHistory(history, isRunning);
  const saved = savedShellEvents(state, buffered, seq);
  const events = buffered.filter((event, index) => {
    if (saved.has(event)) return false;
    if (event.type !== "message.append" || event.message.role !== "user") return true;
    const end = buffered.slice(index + 1).find((next) => next.type === "message.end" && next.message?.role === "user");
    const key = end?.type === "message.end" && end.message ? keyOf(end.message) : undefined;
    return key === undefined || !state.messages.some((message) => message.key === key);
  });
  const completedTools = new Set(state.messages.flatMap((message) => message.parts.flatMap((part) =>
    part.type === "tool" && part.state.type === "done" ? [part.id] : [])));
  // The watermark covers assistant deltas, but the snapshot contains no tool
  // progress/results. Recover those events too, without overwriting results
  // already persisted in history. Finish messages BEFORE seeding the new
  // partial, so an earlier answer cannot replace the next live answer.
  for (const event of events) {
    if ((event.seq ?? Infinity) > seq) continue;
    const toolEvent = event.type === "tool.start" || event.type === "tool.update" || event.type === "tool.end";
    const shellEvent = event.type === "shell.start" || event.type === "shell.chunk" || event.type === "shell.end";
    if (event.type === "message.end" || event.type === "message.append" || shellEvent
      || toolEvent && !completedTools.has(event.toolCallId)) {
      state = reduceEvent(state, event);
    }
  }
  const live = partial ? asMessage({ ...partial, timestamp: undefined }, `live-${state.nextId}`) : undefined;
  if (live?.role === "assistant") {
    const seeded = reconcileTools(live, state.messages);
    if (seeded.parts.length > 0) {
      state = { ...state, liveId: seeded.id, nextId: state.nextId + 1, messages: [...state.messages, seeded] };
    }
  }
  for (const event of events) {
    if ((event.seq ?? Infinity) > seq) state = reduceEvent(state, event);
  }
  // A command that status reports with no events yet started before this join.
  // A buffered end means it already finished: the socket can beat the status read.
  if (bashRunning && !hasRunningShell(state) && !buffered.some((event) => event.type === "shell.end")) state = appendShell(state, unknownRun);
  if (!bashRunning) state = { ...state, messages: interruptOpenShells(state.messages) };
  return state.isRunning ? state : { ...state, messages: interruptOpenTools(state.messages) };
}

/** UI-only state of a tool call, carried as the part's artifact. `risk` is a risk label in words, so the shared trace can draw it. */
export type ToolArtifact = { state: ToolState["type"]; riskLabel?: RiskLabel; risk?: RiskWords; images?: readonly string[]; door?: HandoffDoor; issue?: IssueOutcome };
/** The session a converted tool call created, read back from its artifact. */
export function artifactDoor(artifact: unknown): HandoffDoor | undefined {
  if (typeof artifact !== "object" || artifact === null || !("door" in artifact)) return undefined;
  const door: unknown = artifact.door;
  return typeof door === "object" && door !== null && "sessionId" in door && "cwd" in door
    && typeof door.sessionId === "string" && typeof door.cwd === "string" ? { sessionId: door.sessionId, cwd: door.cwd } : undefined;
}
/** What a converted `file_issue` call did with an issue, read back from its artifact. */
export function artifactIssue(artifact: unknown): IssueOutcome | undefined {
  return typeof artifact === "object" && artifact !== null && "issue" in artifact ? issueOutcomeFrom(artifact.issue) : undefined;
}
/** UI data of a shell row, carried as the system message's custom metadata. */
export type ShellArtifact = { shell: ShellRun };
/** UI data of a history summary row, carried as the system message's custom metadata. */
export type SummaryArtifact = { summary: HistorySummaryKind };
/** UI data of a pull request event row, carried as the system message's custom metadata. */
export type PullNoticeArtifact = { pullNotice: PullNotice };
/** UI data of an Actions run watcher row, carried as the system message's custom metadata. */
export type ActionRunNoticeArtifact = { actionRunNotice: ActionRunNotice };
/** UI data of a managed-process event row, carried as the system message's custom metadata. */
export type ProcessEventArtifact = { processEvent: ProcessEvent };
/** UI data of a child agent's row, carried as the system message's custom metadata. */
export type ChildEntryArtifact = { childEntry: ChildEntry };
/** UI data of a workflow's row, carried as the system message's custom metadata. */
export type WorkflowEntryArtifact = { workflowEntry: WorkflowEntry };
/** UI data of an old issue proposal's row, carried as the system message's custom metadata. */
export type OldIssueProposalArtifact = { oldIssueProposal: OldIssueProposal };
/** UI data of a gated action's row, carried as the system message's custom metadata. */
export type GatedActionArtifact = { gatedAction: GatedActionEntry };
/** UI data of a marked message, carried in its custom metadata. A joined reply is marked when any of its messages is. */
export type MarkArtifact = { marked: true };
export function convertMessage(message: TranscriptMessage): ThreadMessageLike {
  const converted = convertUnmarked(message);
  if (message.marked !== true) return converted;
  const marked: MarkArtifact = { marked: true };
  return { ...converted, metadata: { ...converted.metadata, custom: { ...converted.metadata?.custom, ...marked } } };
}
/**
 * The messages with the one at `position` marked. The same array when no
 * message is there, so nothing in the thread renders again for nothing.
 */
export function markPosition(messages: readonly TranscriptMessage[], position: number | undefined): readonly TranscriptMessage[] {
  if (position === undefined || !messages.some((message) => message.position === position)) return messages;
  return messages.map((message) => message.position === position ? { ...message, marked: true } : message);
}
/** Whether a message converts to an assistant reply, which joins the assistant messages next to it. */
function joinsReply(message: TranscriptMessage): boolean {
  return message.role === "assistant" && !message.pullNotice && !message.actionRunNotice && !message.processEvent && !message.childEntry && !message.workflowEntry && !message.gatedAction && !message.summary;
}
/**
 * The thread's id for the message at `position`. Adjacent replies join into
 * one thread message that keeps the first one's id (`useThreadMessages`).
 */
export function threadMessageIdAt(messages: readonly TranscriptMessage[], position: number | undefined): string | undefined {
  if (position === undefined) return undefined;
  let index = messages.findIndex((message) => message.position === position);
  if (index < 0) return undefined;
  if (joinsReply(messages[index]!)) while (index > 0 && joinsReply(messages[index - 1]!)) index -= 1;
  return messages[index]!.id;
}
function convertUnmarked(message: TranscriptMessage): ThreadMessageLike {
  if (message.role === "shell") {
    const run = shellRunOf(message)!;
    return { id: message.id, role: "system", content: [{ type: "text", text: shellText(run) }],
      metadata: { custom: { shell: run } satisfies ShellArtifact } };
  }
  if (message.pullNotice) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { pullNotice: message.pullNotice } satisfies PullNoticeArtifact } };
  if (message.actionRunNotice) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { actionRunNotice: message.actionRunNotice } satisfies ActionRunNoticeArtifact } };
  if (message.processEvent) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { processEvent: message.processEvent } satisfies ProcessEventArtifact } };
  if (message.childEntry) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { childEntry: message.childEntry } satisfies ChildEntryArtifact } };
  if (message.oldIssueProposal) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { oldIssueProposal: message.oldIssueProposal } satisfies OldIssueProposalArtifact } };
  if (message.workflowEntry) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { workflowEntry: message.workflowEntry } satisfies WorkflowEntryArtifact } };
  if (message.gatedAction) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { gatedAction: message.gatedAction } satisfies GatedActionArtifact } };
  if (message.summary) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { summary: message.summary } satisfies SummaryArtifact } };
  if (message.role !== "assistant") {
    return { id: message.id, role: message.role,
      content: [...(message.skill ? [{ type: "data-skill" as const, data: message.skill }] : []), { type: "text", text: messageText(message) }],
      // Recall sends the expanded invocation, not just its displayed argument.
      ...(message.skill ? { metadata: { custom: { promptText: `<skill name="${message.skill.name}" location="${message.skill.location}">\n${message.skill.content}\n</skill>${messageText(message) ? `\n\n${messageText(message)}` : ""}` } } } : {}),
      ...(message.role === "user" && message.attachments ? { attachments: message.attachments } : {}) };
  }
  const step = stepOf(message);
  return {
    id: message.id, role: "assistant",
    content: step.order.flatMap((index): Exclude<ThreadMessageLike["content"], string>[number][] => {
      const part = message.parts[index]!;
      const parent = step.members.has(index) ? { parentId: `${STEP_PREFIX}${message.id}` } : {};
      switch (part.type) {
        case "text": return [{ type: "text", text: part.text, ...parent }];
        case "thinking": return [{ type: "reasoning", text: part.text, ...parent }];
        case "image": return [{ type: "image", image: part.src }];
        case "tool": return [{
          type: "tool-call", toolCallId: part.invocationId ?? part.id, toolName: part.name,
          args: isArgs(part.args) ? part.args : {},
          artifact: { ...toolArtifact(part.state), ...(part.riskLabel ? {riskLabel: part.riskLabel, risk: riskWords(part.riskLabel)} : {}) },
          ...toolResult(part.state),
          ...parent,
        }];
        // Shell runs are their own messages, never parts of a reply.
        case "shell": return [];
      }
    }),
    // Only failures are explicit. assistant-ui derives running and complete
    // from the run state, and its join keeps the first explicit status.
    ...(message.failure ? { status: { type: "incomplete", reason: message.failure } } : {}),
  };
}
/**
 * Turn-ending controls do not make their response into work narration, even before their results arrive.
 * A call that made a session, filed an issue, or refused a duplicate stands apart once it has, so its outcome is never folded away.
 */
function standsApart(part: ToolPart): boolean {
  return part.name === "ask_user" || part.name === "end_turn" || skillLoadOf(part.name, part.args) !== undefined
    || (part.state.type === "done" && (part.state.door !== undefined || part.state.issue !== undefined));
}
/**
 * A step is one Pi assistant message that calls a tool: its thinking, the
 * text that introduces the calls, and the calls. Pi writes them in that
 * order, so the message boundary says which text introduced which calls.
 * The step runs from the start to the first text after a call; anything
 * later stays outside it. Calls that stand apart move to just after the
 * step, so they never split it.
 */
function stepOf(message: TranscriptMessage): { members: ReadonlySet<number>; order: readonly number[] } {
  const parts = message.parts;
  const all = parts.map((_, index) => index);
  const first = parts.findIndex((part) => part.type === "tool" && !standsApart(part));
  if (first < 0) return { members: new Set(), order: all };
  const textAfter = parts.findIndex((part, index) => index > first && part.type === "text");
  const end = textAfter < 0 ? parts.length : textAfter;
  const members = all.filter((index) => {
    const part = parts[index]!;
    return index < end && (part.type === "text" || part.type === "thinking" || part.type === "tool" && !standsApart(part));
  });
  const apart = all.filter((index) => index < end && !members.includes(index));
  return { members: new Set(members), order: [...members, ...apart, ...all.slice(end)] };
}
function toolArtifact(state: ToolState): ToolArtifact {
  if (state.type !== "done") return { state: state.type };
  return { state: state.type, ...(state.images ? { images: state.images } : {}), ...(state.door ? { door: state.door } : {}),
    ...(state.issue ? { issue: state.issue } : {}) };
}
function toolResult(state: ToolState) {
  switch (state.type) {
    case "pending": return {};
    case "running": return { result: state.output, isPreliminary: true };
    case "done": return { result: state.output, isError: state.isError };
    // A settled empty result, so a stopped call does not read as awaiting action.
    case "interrupted": return { result: "" };
  }
}
type ToolArgs = NonNullable<Extract<Exclude<ThreadMessageLike["content"], string>[number], { type: "tool-call" }>["args"]>;
// Pi tool arguments arrive as parsed JSON, so an object is a JSON object.
function isArgs(value: unknown): value is ToolArgs {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
