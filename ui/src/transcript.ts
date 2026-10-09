import type { CompleteAttachment, ThreadMessageLike } from "@assistant-ui/react";
import { outputOf, partsOf, textOf, type PiMessage, type SessionEvent } from "./contracts";
import { imageSource } from "./images";
import { handoffDoorOf, type HandoffDoor } from "./handoffDoor";
import { parseSkillInvocation, type SkillInvocation } from "./skills";
import { PULL_NOTICE_TYPE, pullNoticeOf, type PullNotice } from "./pullRequests/pullNotice";
import { PROCESS_EVENT_TYPE, parseProcessEvent, type ProcessEvent } from "./processes/processEvent";
import { appendOutput, finishRun, interruptRun, isRecordOf, isSameRun, isSavedCopy, reopenRun, runFromRecord, shellText, startedRun, unknownRun,
  type ShellEnd, type ShellRun } from "./shellRun";

/**
 * One tool execution. A call id owns exactly one state, whether the call
 * arrived in an assistant message, through `tool.*` events, or both.
 */
export type ToolState =
  | { type: "pending" }
  | { type: "running"; output: string }
  | { type: "done"; output: string; isError: boolean; images?: readonly string[]; door?: HandoffDoor }
  | { type: "interrupted" };
export type TranscriptPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  /** An image the assistant itself produced. User images are attachments. */
  | { type: "image"; src: string }
  | { type: "tool"; id: string; name: string; args: unknown; state: ToolState }
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
      case "toolCall": return [{ type: "tool", id: part.id, name: part.name, args: part.arguments, state: { type: "pending" } }];
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
  if (role === "custom" && message.customType === PULL_NOTICE_TYPE) {
    const text = textOf(message);
    return { id, role: "system", parts: [{ type: "text", text }], pullNotice: pullNoticeOf(text, message.details), key: keyOf(message) };
  }
  if (role === "custom" && message.customType === PROCESS_EVENT_TYPE) {
    const text = textOf(message);
    const processEvent = parseProcessEvent(text, message.timestamp);
    // An event this app cannot read still shows, as plain system text.
    return { id, role: "system", parts: [{ type: "text", text }], ...(processEvent ? { processEvent } : {}), key: keyOf(message) };
  }
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
    : message.parts.flatMap((part) => part.type === "tool" ? [part.id] : [])));
}
function mapTool(messages: readonly TranscriptMessage[], id: string,
  update: (part: ToolPart) => ToolPart): readonly TranscriptMessage[] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const partIndex = message.parts.findIndex((part) => part.type === "tool" && part.id === id);
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
/** A finished call: its text, its images, and the session it created, if any. */
function settled(toolName: string, output: string, isError: boolean, content: unknown, details: unknown): ToolState {
  const images = imagesOf(content);
  const door = handoffDoorOf({ toolName, isError, details });
  return { type: "done", output, isError, ...(images.length ? { images } : {}), ...(door ? { door } : {}) };
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
  const current = new Map(replaced?.parts.flatMap((part) => part.type === "tool" ? [[part.id, part] as const] : []));
  const parts = message.parts.flatMap((part): TranscriptPart[] => {
    if (part.type !== "tool") return [part];
    if (elsewhere.has(part.id)) return [];
    const existing = current.get(part.id);
    return [existing ? { ...part, state: existing.state } : part];
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

function applyMessage(state: Transcript, raw: PiMessage, provisional: boolean): Transcript {
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

export function fromHistory(history: readonly PiMessage[], isRunning = false): Transcript {
  let state: Transcript = { messages: [], nextId: 0, isRunning };
  history.forEach((raw, index) => {
    const parsed = raw.role === "toolResult" ? undefined : asMessage(raw, `history-${index}`);
    state = raw.role === "toolResult" ? finishResult(state, raw)
      : parsed ? { ...state, messages: [...state.messages, reconcileTools(parsed, state.messages)] } : state;
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
  let nextId = refreshed.nextId;
  let anchor: string | undefined;
  for (const message of previous.messages) {
    if (message.key) { anchor = message.key; continue; }
    const run = shellRunOf(message);
    if (!run || run.result.type !== "done" && run.result.type !== "failed") continue;
    const at = anchor === undefined ? -1 : messages.findIndex((item) => item.key === anchor);
    const replayed = messages.some((item) => !item.key && !carried.has(item.id) && shellRunOf(item) && isSameRun(shellRunOf(item)!, run));
    // Only a record after the anchor can be this row's: an earlier one is an older identical command.
    const saved = messages.slice(at + 1).some((item) => item.key && shellRunOf(item) && isSavedCopy(shellRunOf(item)!, run));
    if (replayed || saved) continue;
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
  const ids = new Map(previous.messages.flatMap((message) => message.key ? [[message.key, message.id]] : []));
  const reserved = new Set(refreshed.messages.flatMap((message) => {
    const id = message.key ? ids.get(message.key) : undefined;
    return id === undefined ? [] : [id];
  }));
  let nextId = Math.max(previous.nextId, refreshed.nextId);
  let liveId = refreshed.liveId;
  const messages = refreshed.messages.map((message) => {
    const retained = message.key ? ids.get(message.key) : undefined;
    const id = retained ?? (reserved.has(message.id) ? `resync-${nextId++}` : message.id);
    if (message.id === refreshed.liveId) liveId = id;
    return { ...message, id };
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

/** UI-only state of a tool call, carried as the part's artifact. */
export type ToolArtifact = { state: ToolState["type"]; images?: readonly string[]; door?: HandoffDoor };
/** The session a converted tool call created, read back from its artifact. */
export function artifactDoor(artifact: unknown): HandoffDoor | undefined {
  if (typeof artifact !== "object" || artifact === null || !("door" in artifact)) return undefined;
  const door: unknown = artifact.door;
  return typeof door === "object" && door !== null && "sessionId" in door && "cwd" in door
    && typeof door.sessionId === "string" && typeof door.cwd === "string" ? { sessionId: door.sessionId, cwd: door.cwd } : undefined;
}
/** UI data of a shell row, carried as the system message's custom metadata. */
export type ShellArtifact = { shell: ShellRun };
/** UI data of a history summary row, carried as the system message's custom metadata. */
export type SummaryArtifact = { summary: HistorySummaryKind };
/** UI data of a pull request event row, carried as the system message's custom metadata. */
export type PullNoticeArtifact = { pullNotice: PullNotice };
/** UI data of a managed-process event row, carried as the system message's custom metadata. */
export type ProcessEventArtifact = { processEvent: ProcessEvent };
export function convertMessage(message: TranscriptMessage): ThreadMessageLike {
  if (message.role === "shell") {
    const run = shellRunOf(message)!;
    return { id: message.id, role: "system", content: [{ type: "text", text: shellText(run) }],
      metadata: { custom: { shell: run } satisfies ShellArtifact } };
  }
  if (message.pullNotice) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { pullNotice: message.pullNotice } satisfies PullNoticeArtifact } };
  if (message.processEvent) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { processEvent: message.processEvent } satisfies ProcessEventArtifact } };
  if (message.summary) return { id: message.id, role: "system", content: [{ type: "text", text: messageText(message) }],
    metadata: { custom: { summary: message.summary } satisfies SummaryArtifact } };
  if (message.role !== "assistant") {
    return { id: message.id, role: message.role,
      content: [...(message.skill ? [{ type: "data-skill" as const, data: message.skill }] : []), { type: "text", text: messageText(message) }],
      // Recall sends the expanded invocation, not just its displayed argument.
      ...(message.skill ? { metadata: { custom: { promptText: `<skill name="${message.skill.name}" location="${message.skill.location}">\n${message.skill.content}\n</skill>${messageText(message) ? `\n\n${messageText(message)}` : ""}` } } } : {}),
      ...(message.role === "user" && message.attachments ? { attachments: message.attachments } : {}) };
  }
  return {
    id: message.id, role: "assistant",
    content: message.parts.flatMap((part): Exclude<ThreadMessageLike["content"], string>[number][] => {
      switch (part.type) {
        case "text": return [{ type: "text", text: part.text }];
        case "thinking": return [{ type: "reasoning", text: part.text }];
        case "image": return [{ type: "image", image: part.src }];
        case "tool": return [{
          type: "tool-call", toolCallId: part.id, toolName: part.name,
          args: isArgs(part.args) ? part.args : {},
          artifact: toolArtifact(part.state),
          ...toolResult(part.state),
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
function toolArtifact(state: ToolState): ToolArtifact {
  if (state.type !== "done") return { state: state.type };
  return { state: state.type, ...(state.images ? { images: state.images } : {}), ...(state.door ? { door: state.door } : {}) };
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
