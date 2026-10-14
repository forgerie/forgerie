import { readLegacyIssueEntry } from "../shared/legacyIssueProposals.js";
import type { MessagePage, SessionUiEvent } from "../shared/apiTypes.js";
import { END_TURN_TOOL_NAME } from "./sessions/endTurnTool.js";

/**
 * Tools represented by branch-owned custom records rather than tool cards.
 * Turn declarations use the response protocol. Old proposal calls remain hidden; their custom messages stay.
 * Failed results remain visible. Paging keeps raw positions: `start` still counts hidden calls.
 */
const HIDDEN_TRANSCRIPT_TOOLS: ReadonlySet<string> = new Set([END_TURN_TOOL_NAME, "propose_issue"]);

function isHiddenToolCall(part: unknown): boolean {
  return isRecord(part) && part["type"] === "toolCall" && typeof part["name"] === "string" && HIDDEN_TRANSCRIPT_TOOLS.has(part["name"]);
}

function isHiddenToolResult(message: unknown): boolean {
  return isRecord(message) && message["role"] === "toolResult" && message["isError"] !== true
    && typeof message["toolName"] === "string" && HIDDEN_TRANSCRIPT_TOOLS.has(message["toolName"]);
}

/**
 * Remove provider-only thinking data and turn declarations at the browser
 * transport boundary. The runtime message remains unchanged because only
 * affected messages and content blocks are copied.
 */
export function projectBrowserMessage(message: unknown): unknown {
  if (!isRecord(message)) return message;
  // Historical proposal records are plain custom messages; never reinterpret their details as live actions.
  if (message["role"] === "custom" && readLegacyIssueEntry(message["customType"], message["details"]) !== undefined) return message;
  const originalContent = message["content"];
  if (!isUnknownArray(originalContent)) return message;

  const unsigned = mapChanged(originalContent, (part) => {
    if (!isRecord(part) || part["type"] !== "thinking" || !Object.hasOwn(part, "thinkingSignature")) return part;
    const projected = { ...part };
    delete projected["thinkingSignature"];
    return projected;
  });
  const content = unsigned.some(isHiddenToolCall) ? unsigned.filter((part) => !isHiddenToolCall(part)) : unsigned;

  return content === originalContent ? message : { ...message, content };
}

/** Optionally map raw message positions to the returned array, without changing paging metadata. */
export function projectBrowserMessageResponse(
  response: MessagePage,
  onMessagePosition?: (rawPosition: number, projectedPosition: number) => void,
): MessagePage {
  let projectedPosition = 0;
  const retained = response.messages.filter((message, rawPosition) => {
    if (isHiddenToolResult(message)) return false;
    onMessagePosition?.(rawPosition, projectedPosition);
    projectedPosition += 1;
    return true;
  });
  const visible = retained.length === response.messages.length ? response.messages : retained;
  const messages = mapChanged(visible, projectBrowserMessage);
  return messages === response.messages ? response : { ...response, messages };
}

const READABLE_PREVIEW_TEXT_LIMIT = 4_096;
const TECHNICAL_PREVIEW_TEXT_LIMIT = 512;
const TOOL_ARGUMENT_STRING_LIMIT = 256;
const PREVIEW_TRUNCATION_NOTICE = "\n\n[Preview truncated; full content is loading…]";
const PREVIEW_READABLE_MESSAGE_LIMIT = 4;
const PREVIEW_TECHNICAL_MESSAGE_LIMIT = 1;
const PREVIEW_RAW_MESSAGE_LIMIT = 200;
const PREVIEW_CONTENT_PART_LIMIT = 20;
const PREVIEW_STRUCTURED_NODE_LIMIT = 64;
const PREVIEW_STRUCTURED_CHAR_LIMIT = 4_096;
const PREVIEW_OMISSION_NOTICE = "[Preview omitted; full content is loading…]";

interface StructuredPreviewBudget {
  remainingNodes: number;
  remainingChars: number;
}

/**
 * Make the first transcript paint independent of unbounded tool output,
 * inline images, and unbounded DOM work. Empty placeholders preserve every raw
 * message position while normalization drops them from the temporary view.
 */
export function projectBrowserMessagePreviewResponse(response: MessagePage): MessagePage {
  const omitted = Math.max(0, response.messages.length - PREVIEW_RAW_MESSAGE_LIMIT);
  const messages = omitted === 0 ? response.messages : response.messages.slice(omitted);
  const included = previewMessageIndexes(messages);
  return {
    ...response,
    start: response.start + omitted,
    messages: messages.map((message, index) => included.has(index) && !isHiddenToolResult(message) ? projectBrowserMessagePreview(message) : {}),
  };
}

function previewMessageIndexes(messages: unknown[]): Set<number> {
  const readable: number[] = [];
  const technical: number[] = [];
  messages.forEach((message, index) => {
    (isReadablePreviewMessage(message) ? readable : technical).push(index);
  });
  return new Set([
    ...readable.slice(-PREVIEW_READABLE_MESSAGE_LIMIT),
    ...technical.slice(-PREVIEW_TECHNICAL_MESSAGE_LIMIT),
  ]);
}

function isReadablePreviewMessage(message: unknown): boolean {
  if (!isRecord(message)) return false;
  const role = message["role"];
  if (role !== "user" && role !== "assistant" && role !== "system" && role !== "custom") return false;
  const content = message["content"];
  if (typeof content === "string") return content.trim() !== "";
  return isUnknownArray(content) && content.some((part) => isRecord(part) && part["type"] === "text" && typeof part["text"] === "string" && part["text"].trim() !== "");
}

function projectBrowserMessagePreview(message: unknown): unknown {
  if (!isRecord(message)) return message;
  const originalContent = message["content"];
  const role = typeof message["role"] === "string" ? message["role"] : "";
  const budget = structuredPreviewBudget();
  if (typeof originalContent === "string") {
    return previewMessageEnvelope(message, truncatePreviewText(originalContent, readableTextLimit(role)), budget);
  }
  if (!isUnknownArray(originalContent)) {
    return previewMessageEnvelope(message, projectToolArguments(originalContent, 0, budget), budget);
  }

  const content = originalContent.slice(0, PREVIEW_CONTENT_PART_LIMIT).flatMap((part): unknown[] => {
    if (typeof part === "string") return [truncatePreviewText(part, readableTextLimit(role))];
    if (!isRecord(part)) return [part];
    const type = part["type"];
    if (type === "image" || isHiddenToolCall(part)) return [];
    const boundedPart = projectToolArguments(part, 0, budget);
    const projected = isRecord(boundedPart) ? boundedPart : {};
    if (type === "text" && typeof part["text"] === "string") {
      return [{ ...projected, type: "text", text: truncatePreviewText(part["text"], readableTextLimit(role)) }];
    }
    if (type === "thinking") {
      delete projected["thinkingSignature"];
      if (typeof part["thinking"] === "string") projected["thinking"] = truncatePreviewText(part["thinking"], TECHNICAL_PREVIEW_TEXT_LIMIT);
      if (typeof part["text"] === "string") projected["text"] = truncatePreviewText(part["text"], TECHNICAL_PREVIEW_TEXT_LIMIT);
      return [projected];
    }
    if (type === "toolCall" && Object.hasOwn(part, "arguments")) {
      return [{ ...projected, arguments: projectToolArguments(part["arguments"], 0, budget) }];
    }
    return [projected];
  });
  if (originalContent.length > PREVIEW_CONTENT_PART_LIMIT) content.push({ type: "text", text: PREVIEW_OMISSION_NOTICE });
  return previewMessageEnvelope(message, content, budget);
}

const PREVIEW_MESSAGE_TEXT_FIELDS = [
  "role",
  "id",
  "timestamp",
  "provider",
  "model",
  "responseModel",
  "thinkingLevel",
  "source",
  "stopReason",
  "errorMessage",
  "toolName",
  "toolCallId",
  "customType",
  "command",
  "fullOutputPath",
] as const;
const PREVIEW_MESSAGE_PRIMITIVE_FIELDS = ["isError", "exitCode", "cancelled", "truncated", "excludeFromContext"] as const;

function previewMessageEnvelope(message: Record<string, unknown>, content: unknown, budget: StructuredPreviewBudget): Record<string, unknown> {
  const projected: Record<string, unknown> = { content };
  for (const field of PREVIEW_MESSAGE_TEXT_FIELDS) {
    const value = message[field];
    if (typeof value === "string") projected[field] = truncatePreviewText(value, TECHNICAL_PREVIEW_TEXT_LIMIT);
    else if (field === "timestamp" && typeof value === "number" && Number.isFinite(value)) projected[field] = value;
  }
  for (const field of PREVIEW_MESSAGE_PRIMITIVE_FIELDS) {
    const value = message[field];
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) projected[field] = value;
  }
  if (Object.hasOwn(message, "output")) projected["output"] = projectToolArguments(message["output"], 0, budget);
  if (Object.hasOwn(message, "details")) projected["details"] = projectToolArguments(message["details"], 0, budget);
  return projected;
}

function readableTextLimit(role: string): number {
  return role === "user" || role === "assistant" ? READABLE_PREVIEW_TEXT_LIMIT : TECHNICAL_PREVIEW_TEXT_LIMIT;
}

function truncatePreviewText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}${PREVIEW_TRUNCATION_NOTICE}`;
}

function structuredPreviewBudget(): StructuredPreviewBudget {
  return { remainingNodes: PREVIEW_STRUCTURED_NODE_LIMIT, remainingChars: PREVIEW_STRUCTURED_CHAR_LIMIT };
}

function projectToolArguments(value: unknown, depth: number, budget = structuredPreviewBudget()): unknown {
  if (budget.remainingNodes <= 0 || budget.remainingChars <= 0 || depth >= 4) return PREVIEW_OMISSION_NOTICE;
  budget.remainingNodes -= 1;
  if (typeof value === "string") {
    const limit = Math.min(TOOL_ARGUMENT_STRING_LIMIT, budget.remainingChars);
    budget.remainingChars -= Math.min(value.length, limit);
    return truncatePreviewText(value, limit);
  }
  if (Array.isArray(value)) {
    const projected: unknown[] = [];
    for (const item of value.slice(0, 20)) {
      if (budget.remainingNodes <= 0 || budget.remainingChars <= 0) break;
      projected.push(projectToolArguments(item, depth + 1, budget));
    }
    if (projected.length < value.length) projected.push(PREVIEW_OMISSION_NOTICE);
    return projected;
  }
  if (!isRecord(value)) return value;
  const projected: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [rawKey, item] of entries.slice(0, 20)) {
    if (budget.remainingNodes <= 0 || budget.remainingChars <= 0) break;
    const key = rawKey.slice(0, Math.min(128, budget.remainingChars));
    budget.remainingChars -= key.length;
    projected[key] = projectToolArguments(item, depth + 1, budget);
  }
  if (Object.keys(projected).length < entries.length && budget.remainingChars > 0) projected["previewOmitted"] = true;
  return projected;
}

export function projectBrowserSessionEvent(event: SessionUiEvent): SessionUiEvent {
  if (event.type === "tool.end" && event.isError) return event;
  if ((event.type === "tool.start" || event.type === "tool.update" || event.type === "tool.end") && HIDDEN_TRANSCRIPT_TOOLS.has(event.toolName)) {
    return { type: "pi.event", eventType: `tool_execution_${event.type.slice("tool.".length)}` };
  }
  if (event.type !== "message.end" || event.message === undefined) return event;
  if (isHiddenToolResult(event.message)) return { type: "message.end" };
  const message = projectBrowserMessage(event.message);
  return message === event.message ? event : { ...event, message };
}

function mapChanged<T>(values: T[], project: (value: T) => T): T[] {
  let projectedValues: T[] | undefined;
  let index = 0;
  for (const value of values) {
    const projected = project(value);
    if (projectedValues === undefined) {
      if (projected === value) {
        index += 1;
        continue;
      }
      projectedValues = values.slice(0, index);
    }
    projectedValues.push(projected);
    index += 1;
  }
  return projectedValues ?? values;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
