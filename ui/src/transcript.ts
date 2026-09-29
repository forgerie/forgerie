import type { ThreadMessageLike } from "@assistant-ui/react";
import { textOf, type PiMessage, type SessionEvent } from "./contracts";

export interface TextMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  key?: string;
  provisional?: boolean;
  status?: ThreadMessageLike["status"];
}
export interface Transcript {
  messages: readonly TextMessage[];
  liveId?: string;
  nextId: number;
  isRunning: boolean;
  error?: string;
}
function keyOf(message: PiMessage): string | undefined {
  return message.timestamp === undefined ? undefined : `${message.role}:${message.timestamp}`;
}
function asText(message: PiMessage, id: string): TextMessage | undefined {
  const role = message.role;
  if (role !== "user" && role !== "assistant" && role !== "system") return undefined;
  const text = textOf(message);
  if (text === "" && !message.errorMessage) return undefined;
  return {
    id, role, text: text || message.errorMessage || "", key: keyOf(message),
    ...(role === "assistant" ? { status: message.stopReason === "error" || message.stopReason === "aborted"
      ? { type: "incomplete", reason: message.stopReason === "error" ? "error" : "cancelled" }
      : { type: "complete", reason: "stop" } } : {}),
  };
}
export function fromHistory(messages: readonly PiMessage[], isRunning = false): Transcript {
  return {
    messages: messages.flatMap((message, index) => asText(message, `history-${index}`) ?? []),
    nextId: messages.length, isRunning,
  };
}
export function convertMessage(message: TextMessage): ThreadMessageLike {
  return {
    id: message.id, role: message.role,
    content: [{ type: "text", text: message.text }],
    ...(message.status ? { status: message.status } : {}),
  };
}
export function reduceEvent(state: Transcript, event: SessionEvent): Transcript {
  switch (event.type) {
    case "agent.start": return { ...state, isRunning: true, error: undefined };
    case "agent.end": return {
      ...state, isRunning: false, liveId: undefined,
      messages: state.messages.map((message) => message.id === state.liveId
        ? { ...message, status: { type: "incomplete", reason: "cancelled" } } : message),
    };
    case "session.error": return { ...state, error: event.message };
    case "assistant.delta": {
      if (state.liveId !== undefined) {
        return { ...state, messages: state.messages.map((message) => message.id === state.liveId
          ? { ...message, text: message.text + event.text } : message) };
      }
      const id = `live-${state.nextId}`;
      return { ...state, liveId: id, nextId: state.nextId + 1, messages: [...state.messages,
        { id, role: "assistant", text: event.text, status: { type: "running" } }], isRunning: true };
    }
    case "message.append":
    case "message.end": {
      const raw = event.message;
      if (!raw) return state;
      const key = keyOf(raw);
      if (key !== undefined && state.messages.some((message) => message.key === key)) return state;
      const message = asText(raw, `message-${state.nextId}`);
      if (!message) return state;
      const last = state.messages.at(-1);
      // Pi echoes a user without a timestamp before emitting its persisted message_end.
      const replaceId = raw.role === "assistant" ? state.liveId
        : last?.role === "user" && last.provisional && last.text === message.text ? last.id : undefined;
      const next = { ...message, id: replaceId ?? message.id, provisional: event.type === "message.append" };
      return {
        ...state, nextId: state.nextId + 1,
        liveId: raw.role === "assistant" ? undefined : state.liveId,
        messages: replaceId === undefined ? [...state.messages, next]
          : state.messages.map((current) => current.id === replaceId ? next : current),
        error: raw.errorMessage ?? state.error,
      };
    }
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
  if (partial && textOf(partial) !== "") {
    state = reduceEvent(state, { type: "assistant.delta", text: textOf(partial) });
  }
  for (const event of events) {
    if ((event.seq ?? Infinity) > seq) state = reduceEvent(state, event);
  }
  return state;
}
