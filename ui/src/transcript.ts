import type { ThreadMessageLike } from "@assistant-ui/react";
import { outputOf, partsOf, type PiMessage, type SessionEvent } from "./contracts";

/**
 * One tool execution. A call id owns exactly one state, whether the call
 * arrived in an assistant message, through `tool.*` events, or both.
 */
export type ToolState =
  | { type: "pending" }
  | { type: "running"; output: string }
  | { type: "done"; output: string; isError: boolean }
  | { type: "interrupted" };
export type TranscriptPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; id: string; name: string; args: unknown; state: ToolState };
export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: readonly TranscriptPart[];
  key?: string;
  provisional?: boolean;
  failure?: "error" | "cancelled";
}
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
function toParts(message: PiMessage): TranscriptPart[] {
  const parts = partsOf(message).flatMap((part): TranscriptPart[] => {
    switch (part.type) {
      case "text": return part.text === "" ? [] : [{ type: "text", text: part.text }];
      case "thinking": return part.thinking.trim() === "" ? [] : [{ type: "thinking", text: part.thinking }];
      case "toolCall": return [{ type: "tool", id: part.id, name: part.name, args: part.arguments, state: { type: "pending" } }];
      case "image": return [];
    }
  });
  const hasText = parts.some((part) => part.type === "text");
  return !hasText && message.errorMessage ? [...parts, { type: "text", text: message.errorMessage }] : parts;
}
function asMessage(message: PiMessage, id: string): TranscriptMessage | undefined {
  const role = message.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return undefined;
  const parts = toParts(message);
  if (parts.length === 0) return undefined;
  const failure = role !== "assistant" ? undefined
    : message.stopReason === "error" ? "error" : message.stopReason === "aborted" ? "cancelled" : undefined;
  return { id, role, parts, key: keyOf(message), ...(failure ? { failure } : {}) };
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
function finishTool(state: Transcript, id: string | undefined, name: string, output: string, isError: boolean): Transcript {
  if (!id) return state;
  const done: ToolState = { type: "done", output, isError };
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
function applyMessage(state: Transcript, raw: PiMessage, provisional: boolean): Transcript {
  if (raw.role === "toolResult") return finishTool(state, raw.toolCallId, raw.toolName ?? "tool", outputOf(raw), raw.isError === true);
  const key = keyOf(raw);
  if (key !== undefined && state.messages.some((message) => message.key === key)) return state;
  const parsed = asMessage(raw, `message-${state.nextId}`);
  const liveId = raw.role === "assistant" ? undefined : state.liveId;
  if (!parsed) return { ...state, liveId };
  const last = state.messages.at(-1);
  // Pi echoes a user without a timestamp before emitting its persisted message_end.
  const replaceId = raw.role === "assistant" ? state.liveId
    : last?.role === "user" && last.provisional && messageText(last) === messageText(parsed) ? last.id : undefined;
  const replaced = state.messages.find((message) => message.id === replaceId);
  const next = { ...reconcileTools(parsed, state.messages, replaced), id: replaced?.id ?? parsed.id, provisional };
  const empty = next.parts.length === 0;
  const messages = replaced === undefined ? (empty ? state.messages : [...state.messages, next])
    : state.messages.flatMap((current) => current !== replaced ? [current] : empty ? [] : [next]);
  return { ...state, nextId: state.nextId + 1, liveId, messages, error: raw.errorMessage ?? state.error };
}
export function messageText(message: TranscriptMessage): string {
  return message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
}

export function fromHistory(history: readonly PiMessage[], isRunning = false): Transcript {
  let state: Transcript = { messages: [], nextId: 0, isRunning };
  history.forEach((raw, index) => {
    const parsed = raw.role === "toolResult" ? undefined : asMessage(raw, `history-${index}`);
    state = raw.role === "toolResult" ? finishTool(state, raw.toolCallId, raw.toolName ?? "tool", outputOf(raw), raw.isError === true)
      : parsed ? { ...state, messages: [...state.messages, reconcileTools(parsed, state.messages)] } : state;
  });
  // Only the current turn of a running session can still have open tools.
  const lastUser = state.messages.findLastIndex((message) => message.role === "user");
  const messages = isRunning ? interruptOpenTools(state.messages.slice(0, lastUser + 1)).concat(state.messages.slice(lastUser + 1))
    : interruptOpenTools(state.messages);
  return { ...state, messages, nextId: Math.max(state.nextId, history.length) };
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
    case "tool.end": return finishTool(state, event.toolCallId, event.toolName, event.text, event.isError);
    case "message.append":
    case "message.end": return event.message ? applyMessage(state, event.message, event.type === "message.append") : state;
  }
}

export function seedTranscript(history: readonly PiMessage[], partial: PiMessage | null, seq: number,
  isRunning: boolean, buffered: readonly SessionEvent[]): Transcript {
  let state = fromHistory(history, isRunning);
  const events = buffered.filter((event, index) => {
    if (event.type !== "message.append" || event.message.role !== "user") return true;
    const end = buffered.slice(index + 1).find((next) => next.type === "message.end" && next.message?.role === "user");
    const key = end?.type === "message.end" && end.message ? keyOf(end.message) : undefined;
    return key === undefined || !state.messages.some((message) => message.key === key);
  });
  // Finish messages between the history read and snapshot BEFORE seeding the
  // new partial. Otherwise an earlier answer can replace the next live answer.
  for (const event of events) {
    if ((event.seq ?? Infinity) <= seq && (event.type === "message.end" || event.type === "message.append")) {
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
  return state;
}

/** UI-only state of a tool call, carried as the part's artifact. */
export type ToolArtifact = { state: ToolState["type"] };
export function convertMessage(message: TranscriptMessage): ThreadMessageLike {
  if (message.role !== "assistant") {
    return { id: message.id, role: message.role, content: [{ type: "text", text: messageText(message) }] };
  }
  return {
    id: message.id, role: "assistant",
    content: message.parts.map((part) => {
      switch (part.type) {
        case "text": return { type: "text", text: part.text };
        case "thinking": return { type: "reasoning", text: part.text };
        case "tool": return {
          type: "tool-call", toolCallId: part.id, toolName: part.name,
          args: isArgs(part.args) ? part.args : {},
          artifact: { state: part.state.type } satisfies ToolArtifact,
          ...toolResult(part.state),
        };
      }
    }),
    // Only failures are explicit. assistant-ui derives running and complete
    // from the run state, and its join keeps the first explicit status.
    ...(message.failure ? { status: { type: "incomplete", reason: message.failure } } : {}),
  };
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
