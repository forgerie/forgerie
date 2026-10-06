import {
  AD_PROCESS_NOTIFICATION_CUSTOM_TYPE,
  ASK_USER_ANSWERS_CUSTOM_TYPE,
  PROCESS_NOTIFICATION_KINDS,
  PROCESS_NOTIFICATION_STATUSES,
  type ProcessNotificationKind,
  type ProcessNotificationStatus,
} from "../../shared/apiTypes";
import { CODEMODE_TOOL_NAME, codemodeScriptSummary } from "../../shared/codemodeScript";
import { parseAskUserOutcome } from "./api/parsers";
import { inheritChatLineTranscriptPosition, setChatLineTranscriptPosition } from "./chatLinePosition";
import type { ChatLine, ChatPart, ToolExecutionPart, ToolPreview } from "./components/shared";

export interface ChatNormalizationScheduler {
  now(): number;
  yield(): Promise<void>;
}

export interface ChatNormalizationOptions {
  budgetMs?: number | undefined;
  scheduler?: ChatNormalizationScheduler | undefined;
  shouldContinue?: (() => boolean) | undefined;
  messageStart?: number | undefined;
}

export type ChatNormalizationResult =
  | { readonly kind: "normalized"; readonly messages: ChatLine[] }
  | { readonly kind: "superseded" };

const DEFAULT_CHAT_NORMALIZATION_BUDGET_MS = 8;

const browserNormalizationScheduler: ChatNormalizationScheduler = {
  now(): number {
    return performance.now();
  },
  async yield(): Promise<void> {
    const browserScheduler: unknown = Reflect.get(globalThis, "scheduler");
    if (browserScheduler !== null && typeof browserScheduler === "object") {
      const yieldMethod: unknown = Reflect.get(browserScheduler, "yield");
      if (typeof yieldMethod === "function") {
        await Reflect.apply(yieldMethod, browserScheduler, []);
        return;
      }
    }
    await new Promise<void>((resolve) => { globalThis.setTimeout(resolve, 0); });
  },
};

export function normalizeMessages(messages: unknown[], messageStart?: number): ChatLine[] {
  return visibleNormalizedMessages(messages.flatMap((message, index) => withTranscriptMessageIndex(
    normalizeMessage(message),
    messageStart === undefined ? undefined : messageStart + index,
  )));
}

export async function normalizeMessagesCooperatively(messages: unknown[], options: ChatNormalizationOptions = {}): Promise<ChatNormalizationResult> {
  const scheduler = options.scheduler ?? browserNormalizationScheduler;
  const budgetMs = Math.max(1, options.budgetMs ?? DEFAULT_CHAT_NORMALIZATION_BUDGET_MS);
  const shouldContinue = options.shouldContinue ?? (() => true);
  const lines: ChatLine[] = [];
  let sliceStartedAt = scheduler.now();

  for (let index = 0; index < messages.length; index += 1) {
    if (!shouldContinue()) return { kind: "superseded" };
    lines.push(...withTranscriptMessageIndex(
      normalizeMessage(messages[index]),
      options.messageStart === undefined ? undefined : options.messageStart + index,
    ));
    if (index === messages.length - 1 || scheduler.now() - sliceStartedAt < budgetMs) continue;
    await scheduler.yield();
    if (!shouldContinue()) return { kind: "superseded" };
    sliceStartedAt = scheduler.now();
  }

  if (!shouldContinue()) return { kind: "superseded" };
  return { kind: "normalized", messages: visibleNormalizedMessages(lines) };
}

function visibleNormalizedMessages(lines: ChatLine[]): ChatLine[] {
  const visible = coalesceToolExecutions(lines).filter((message) => message.parts.length > 0);
  const lineIndexes = new Map<number, number>();
  for (const line of visible) {
    const messageIndex = line.transcriptPosition?.messageIndex;
    if (messageIndex === undefined) continue;
    const lineIndex = lineIndexes.get(messageIndex) ?? 0;
    setChatLineTranscriptPosition(line, { messageIndex, lineIndex, segmentIndex: 0 });
    lineIndexes.set(messageIndex, lineIndex + 1);
  }
  return visible;
}

function withTranscriptMessageIndex(lines: ChatLine[], messageIndex: number | undefined): ChatLine[] {
  if (messageIndex === undefined) return lines;
  return lines.map((line) => setChatLineTranscriptPosition(line, { messageIndex, lineIndex: 0, segmentIndex: 0 }));
}

export function textMessage(role: ChatLine["role"], text: string): ChatLine {
  return { role, parts: [{ type: "text", text }] };
}

export function withMessageMeta(line: ChatLine, rawMessage: unknown): ChatLine {
  const meta = normalizeMeta(rawMessage);
  return meta === undefined ? line : { ...line, meta };
}

export function appendText(messages: ChatLine[], role: ChatLine["role"], text: string): ChatLine[] {
  if (text === "") return messages;
  const last = messages.at(-1);
  const lastPart = last?.parts.at(-1);
  if (last?.role === role && lastPart?.type === "text") {
    const next = inheritChatLineTranscriptPosition(last, {
      ...last,
      parts: [...last.parts.slice(0, -1), { ...lastPart, text: lastPart.text + text }],
    });
    return [...messages.slice(0, -1), next];
  }
  if (last?.role === role) {
    const updated: ChatLine = { ...last, parts: [...last.parts, { type: "text", text }] };
    const next = inheritChatLineTranscriptPosition(last, updated);
    return [...messages.slice(0, -1), next];
  }
  return [...messages, textMessage(role, text)];
}

export function appendThinking(messages: ChatLine[], text: string): ChatLine[] {
  if (text === "") return messages;
  const last = messages.at(-1);
  const lastPart = last?.parts.at(-1);
  if (last?.role === "assistant" && lastPart?.type === "thinking") {
    const next = inheritChatLineTranscriptPosition(last, {
      ...last,
      parts: [...last.parts.slice(0, -1), { ...lastPart, text: lastPart.text + text }],
    });
    return [...messages.slice(0, -1), next];
  }
  if (last?.role === "assistant") {
    const updated: ChatLine = { ...last, parts: [...last.parts, { type: "thinking", text }] };
    const next = inheritChatLineTranscriptPosition(last, updated);
    return [...messages.slice(0, -1), next];
  }
  return [...messages, { role: "assistant", parts: [{ type: "thinking", text }] }];
}

export function normalizeMessage(message: unknown): ChatLine[] {
  if (isChatLine(message)) return [message];
  if (getString(message, "role") === "bashExecution") return [withMessageMeta(normalizeBashExecution(message), message)];
  const rawRole = getString(message, "role");
  const role = normalizeRole(rawRole);
  const contentParts = normalizeContent(getProperty(message, "content"), message);
  const supersededRecord = rawRole === "toolResult"
    ? askUserRecordFromToolDetails(getString(message, "toolName") ?? "", getProperty(message, "details"))
    : undefined;
  const parts = supersededRecord === undefined ? contentParts : [...contentParts, supersededRecord];
  const skillLines = role === "user" ? normalizeSkillInvocation(parts) : undefined;
  if (skillLines !== undefined) return skillLines.map((line) => ({ ...withMessageMeta(line, message), promptText: parts[0]?.type === "text" ? parts[0].text : "" }));
  const source = normalizeSource(message);
  if (role === "tool") return [withMessageMeta({ role, parts, ...(source === undefined ? {} : { source }) }, message)];

  const visible = parts.filter((part) => part.type !== "empty");
  const displayRole = role === "assistant" && visible.length > 0 && visible.every((part) => part.type === "skillRead") ? "skill" : role;
  const lines = visible.length > 0 ? [withMessageMeta({ role: displayRole, parts: visible, ...(source === undefined ? {} : { source }) }, message)] : [];
  const errorLine = assistantErrorLine(message);
  return errorLine === undefined ? lines : [...lines, withMessageMeta(errorLine, message)];
}

function assistantErrorLine(message: unknown): ChatLine | undefined {
  if (getString(message, "role") !== "assistant" || getString(message, "stopReason") !== "error") return undefined;
  const errorMessage = getString(message, "errorMessage")?.trim();
  const detail = errorMessage === undefined || errorMessage === "" ? "The model returned an error." : errorMessage;
  return textMessage("system", `Model response failed: ${detail}`);
}

function isChatLine(message: unknown): message is ChatLine {
  const role = getString(message, "role");
  return (role === "user" || role === "assistant" || role === "tool" || role === "system" || role === "bash" || role === "skill")
    && Array.isArray(getProperty(message, "parts"));
}

/**
 * One typed command, kept as one message.
 *
 * Pi expands `/name args` into a skill block followed by the argument. An
 * earlier revision split that back into two user lines, which cost two
 * bubbles and -- because `chatTurns` opens a turn at every user line -- two
 * turns for one thing the person did. The argument rides on the invocation
 * instead, so the transcript can draw the command that was typed.
 */
function normalizeSkillInvocation(parts: ChatPart[]): ChatLine[] | undefined {
  if (parts.length !== 1 || parts[0]?.type !== "text") return undefined;
  const skill = parseSkillBlock(parts[0].text);
  if (skill === undefined) return undefined;
  return [{
    role: "user",
    parts: [{
      type: "skillInvocation",
      name: skill.name,
      location: skill.location,
      content: skill.content,
      ...(skill.userMessage === undefined ? {} : { argument: skill.userMessage }),
    }],
  }];
}

function parseSkillBlock(text: string): { name: string; location: string; content: string; userMessage?: string } | undefined {
  const match = /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/.exec(text);
  if (match === null) return undefined;
  const userMessage = match[4]?.trim();
  return {
    name: match[1] ?? "skill",
    location: match[2] ?? "",
    content: match[3] ?? "",
    ...(userMessage === undefined || userMessage === "" ? {} : { userMessage }),
  };
}

function normalizeSource(message: unknown): ChatLine["source"] | undefined {
  const source = getString(message, "source");
  if (source === "compaction" || source === "branch_summary") return source;
  return undefined;
}

function normalizeMeta(message: unknown): ChatLine["meta"] | undefined {
  const timestamp = normalizeTimestamp(getProperty(message, "timestamp"));
  const model = normalizeModel(message);
  const thinkingLevel = getString(message, "thinkingLevel");
  if (timestamp === undefined && model === undefined && (thinkingLevel === undefined || thinkingLevel === "")) return undefined;
  return {
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(model === undefined ? {} : { model }),
    ...(thinkingLevel === undefined || thinkingLevel === "" ? {} : { thinkingLevel }),
  };
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value !== "string" || value === "") return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function normalizeModel(message: unknown): NonNullable<ChatLine["meta"]>["model"] | undefined {
  if (getString(message, "role") !== "assistant") return undefined;
  const provider = getString(message, "provider");
  const id = getString(message, "model");
  const responseId = getString(message, "responseModel");
  if ((provider === undefined || provider === "") && (id === undefined || id === "") && (responseId === undefined || responseId === "")) return undefined;
  return {
    ...(provider === undefined || provider === "" ? {} : { provider }),
    ...(id === undefined || id === "" ? {} : { id }),
    ...(responseId === undefined || responseId === "" ? {} : { responseId }),
  };
}

function normalizeBashExecution(message: unknown): ChatLine {
  const command = getString(message, "command") ?? "";
  const lines = getBoolean(message, "excludeFromContext") === true ? ["excluded from context", "", `$ ${command}`] : [`$ ${command}`];
  const output = getProperty(message, "output");
  if (output != null) lines.push("", stringifyPrimitive(output));
  const exitCode = getProperty(message, "exitCode");
  if (exitCode != null) lines.push("", `exit ${stringifyPrimitive(exitCode)}`);
  if (getBoolean(message, "cancelled") === true) lines.push("", "cancelled");
  if (getBoolean(message, "truncated") === true) lines.push("", "output truncated");
  const fullOutputPath = getString(message, "fullOutputPath");
  if (fullOutputPath !== undefined && fullOutputPath !== "") lines.push("", `full output: ${fullOutputPath}`);
  return { role: "bash", parts: [{ type: "text", text: lines.join("\n") }] };
}

function normalizeRole(role: unknown): ChatLine["role"] {
  if (role === "assistant") return "assistant";
  if (role === "user") return "user";
  if (role === "toolResult") return "tool";
  return "system";
}

function normalizeContent(content: unknown, message: unknown): ChatPart[] {
  const askUserRecord = askUserRecordPart(message);
  if (askUserRecord !== undefined) return [askUserRecord];
  const processNotification = processNotificationPart(message);
  if (processNotification !== undefined) return [processNotification];
  if (typeof content === "string") return content !== "" ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return objectFallback(content);

  const parts = content.flatMap((part): ChatPart[] => {
    const type = getString(part, "type");
    const text = getString(part, "text");
    if (type === "text") return text !== undefined && text !== "" ? [{ type: "text", text }] : [];
    if (type === "thinking") {
      const thinking = getString(part, "thinking") ?? text;
      return thinking !== undefined && thinking !== "" ? [{ type: "thinking", text: thinking }] : [];
    }
    if (type === "toolCall") {
      const toolName = getString(part, "name") ?? "tool";
      const args = getProperty(part, "arguments");
      const toolCallId = getString(part, "id");
      const skillRead = toolName === "read" ? parseSkillReadPath(getString(args, "path")) : undefined;
      if (skillRead !== undefined) return [{ type: "skillRead", ...skillRead, ...(toolCallId === undefined ? {} : { toolCallId }) }];
      return [{ type: "toolCall", ...(toolCallId === undefined ? {} : { toolCallId }), toolName, summary: summarizeToolCall(toolName, args), ...(args === undefined ? {} : { args }) }];
    }
    if (type === "image") {
      const data = getString(part, "data");
      const mimeType = getString(part, "mimeType");
      if (data !== undefined && data !== "" && mimeType !== undefined && mimeType !== "") return [{ type: "image", mimeType, data }];
      return [{ type: "text", text: "[image]" }];
    }
    return objectFallback(part);
  });
  return getString(message, "role") === "toolResult" ? toolResultParts(parts, message) : parts;
}

/**
 * One result part for a tool result, whatever number of text items it holds.
 *
 * A tool result is one answer to one call, and only one part can merge into
 * that call's step. A result with several text items, such as every codemode
 * result, would otherwise leave the rest as stray rows after a reload. The
 * text joins the way the live stream joins it.
 */
function toolResultParts(parts: ChatPart[], message: unknown): ChatPart[] {
  const texts = parts.flatMap((part) => part.type === "text" ? [part.text] : []);
  if (texts.length === 0) return parts;
  const others = parts.filter((part) => part.type !== "text");
  return [toolResultPartFromText(texts.join("\n"), message), ...others];
}

function askUserRecordPart(message: unknown): Extract<ChatPart, { type: "askUserRecord" }> | undefined {
  if (getString(message, "role") !== "custom" || getString(message, "customType") !== ASK_USER_ANSWERS_CUSTOM_TYPE) return undefined;
  return parsedAskUserRecord(getProperty(message, "details"));
}

/** Project the superseded ask carried by an `ask_user` tool result, if any. */
export function askUserRecordFromToolDetails(toolName: string, details: unknown): Extract<ChatPart, { type: "askUserRecord" }> | undefined {
  if (toolName !== "ask_user") return undefined;
  return parsedAskUserRecord(getProperty(details, "superseded"));
}

function parsedAskUserRecord(value: unknown): Extract<ChatPart, { type: "askUserRecord" }> | undefined {
  try {
    return { type: "askUserRecord", outcome: parseAskUserOutcome(value) };
  } catch {
    // A malformed legacy/session entry must not make the whole transcript fail.
    // Fall back to its model-facing text through the ordinary normalizer.
    return undefined;
  }
}

function processNotificationPart(message: unknown): Extract<ChatPart, { type: "processNotification" }> | undefined {
  if (getString(message, "role") !== "custom" || getString(message, "customType") !== AD_PROCESS_NOTIFICATION_CUSTOM_TYPE) return undefined;
  const rawContent = getString(message, "content") ?? "";
  return parsedProcessNotification(getProperty(message, "details"), rawContent);
}

const PROCESS_NOTIFICATION_KIND_SET: ReadonlySet<string> = new Set(PROCESS_NOTIFICATION_KINDS);
const PROCESS_NOTIFICATION_STATUS_SET: ReadonlySet<string> = new Set(PROCESS_NOTIFICATION_STATUSES);

function isProcessNotificationKind(value: string | undefined): value is ProcessNotificationKind {
  return value !== undefined && PROCESS_NOTIFICATION_KIND_SET.has(value);
}

function isProcessNotificationStatus(value: string | undefined): value is ProcessNotificationStatus | undefined {
  return value === undefined || PROCESS_NOTIFICATION_STATUS_SET.has(value);
}

function parsedProcessNotification(details: unknown, rawContent: string): Extract<ChatPart, { type: "processNotification" }> | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const kind = getString(details, "kind");
  const processName = getString(details, "processName");
  const summary = getString(details, "summary");
  if (!isProcessNotificationKind(kind)) return undefined;
  if (processName === undefined || processName.trim() === "") return undefined;
  if (summary === undefined || summary.trim() === "") return undefined;

  const status = getString(details, "status");
  if (!isProcessNotificationStatus(status)) return undefined;
  const exitCode = getProperty(details, "exitCode");
  if (exitCode !== undefined && exitCode !== null && typeof exitCode !== "number") return undefined;

  return {
    type: "processNotification",
    kind,
    processName,
    summary,
    ...(status === undefined ? {} : { status }),
    ...(typeof exitCode === "number" ? { exitCode } : {}),
    rawContent,
  };
}

function toolResultPartFromText(text: string, message: unknown): Extract<ChatPart, { type: "toolResult" }> {
  const toolCallId = getString(message, "toolCallId");
  const content = getProperty(message, "content");
  const details = getProperty(message, "details");
  return {
    type: "toolResult",
    ...(toolCallId === undefined ? {} : { toolCallId }),
    toolName: getString(message, "toolName") ?? "tool",
    text,
    ...(content === undefined ? {} : { content }),
    ...(details === undefined ? {} : { details }),
    isError: getBoolean(message, "isError") === true,
  };
}

function parseSkillReadPath(path: string | undefined): { name: string; path: string } | undefined {
  if (path === undefined || path === "") return undefined;
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.endsWith("/SKILL.md") && normalized !== "SKILL.md") return undefined;
  const name = normalized.split("/").at(-2);
  if (name === undefined || name === "") return undefined;
  return { name, path };
}

function coalesceToolExecutions(lines: ChatLine[]): ChatLine[] {
  const result: ChatLine[] = [];
  const pendingTools = new Map<string, { lineIndex: number; partIndex: number }>();

  for (const line of lines) {
    let passthroughParts: ChatPart[] = [];
    const metadata = { ...(line.promptText === undefined ? {} : { promptText: line.promptText }), ...(line.source === undefined ? {} : { source: line.source }), ...(line.meta === undefined ? {} : { meta: line.meta }) };
    const pushResult = (next: ChatLine): void => {
      result.push(inheritChatLineTranscriptPosition(line, next));
    };
    const flushPassthrough = () => {
      if (passthroughParts.length === 0) return;
      pushResult({ role: line.role, parts: passthroughParts, ...metadata });
      passthroughParts = [];
    };

    for (const part of line.parts) {
      if (part.type === "toolCall") {
        flushPassthrough();
        const execution = toolExecutionFromCall(part);
        const lineIndex = result.length;
        pushResult({ role: "tool", parts: [execution], ...metadata });
        if (execution.toolCallId !== undefined) pendingTools.set(execution.toolCallId, { lineIndex, partIndex: 0 });
        continue;
      }

      if (part.type === "toolResult") {
        const target = part.toolCallId === undefined ? undefined : pendingTools.get(part.toolCallId);
        if (target !== undefined && mergeToolResultInto(result, target, part)) {
          pendingTools.delete(part.toolCallId ?? "");
          continue;
        }
      }

      passthroughParts.push(part);
    }

    flushPassthrough();
  }

  return result;
}

function toolExecutionFromCall(part: Extract<ChatPart, { type: "toolCall" }>): ToolExecutionPart {
  return {
    type: "toolExecution",
    ...(part.toolCallId === undefined ? {} : { toolCallId: part.toolCallId }),
    toolName: part.toolName,
    summary: part.summary,
    ...(part.args === undefined ? {} : { args: part.args }),
    status: "pending",
  };
}

function mergeToolResultInto(lines: ChatLine[], target: { lineIndex: number; partIndex: number }, result: Extract<ChatPart, { type: "toolResult" }>): boolean {
  const line = lines[target.lineIndex];
  const current = line?.parts[target.partIndex];
  if (line === undefined || current?.type !== "toolExecution") return false;
  const preview = previewFromDetails(result.details) ?? current.preview;
  const next: ToolExecutionPart = {
    ...current,
    status: result.isError ? "error" : "success",
    resultText: result.text,
    ...(result.content === undefined ? {} : { content: result.content }),
    ...(result.details === undefined ? {} : { details: result.details }),
    ...(preview === undefined ? {} : { preview }),
  };
  const merged = { ...line, parts: [...line.parts.slice(0, target.partIndex), next, ...line.parts.slice(target.partIndex + 1)] };
  lines[target.lineIndex] = inheritChatLineTranscriptPosition(line, merged);
  return true;
}

export function previewFromDetails(details: unknown): ToolPreview | undefined {
  const preview = getProperty(details, "preview");
  if (!isRecord(preview)) return undefined;
  const diff = getString(preview, "diff");
  const error = getString(preview, "error");
  const firstChangedLine = getNumber(preview, "firstChangedLine");
  if (diff === undefined && error === undefined && firstChangedLine === undefined) return undefined;
  return {
    ...(diff === undefined ? {} : { diff }),
    ...(error === undefined ? {} : { error }),
    ...(firstChangedLine === undefined ? {} : { firstChangedLine }),
  };
}

function objectFallback(value: unknown): ChatPart[] {
  if (value == null) return [];
  if (typeof value === "object") return [{ type: "text", text: summarizeArgs(value) }];
  return [{ type: "text", text: stringifyPrimitive(value) }];
}

/** A codemode call is named by its script's purpose, not by its one `code` argument. */
function summarizeToolCall(toolName: string, args: unknown): string {
  return toolName === CODEMODE_TOOL_NAME ? codemodeScriptSummary(getString(args, "code") ?? "") : summarizeArgs(args);
}

export function summarizeArgs(args: unknown): string {
  if (!isRecord(args)) return stringifyPrimitive(args);
  const command = getString(args, "command");
  if (command !== undefined) return command;
  const path = getString(args, "path");
  if (path !== undefined) return path;
  if (typeof args["oldText"] === "string" && typeof args["newText"] === "string") return "edit text replacement";
  const edits = args["edits"];
  if (Array.isArray(edits)) return `${String(edits.length)} edit${edits.length === 1 ? "" : "s"}`;
  const entries = Object.entries(args).filter(([, value]) => value != null).slice(0, 3);
  return entries.map(([key, value]) => `${key}: ${shortValue(value)}`).join(" · ");
}

function shortValue(value: unknown): string {
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${String(value.length)} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object" && value !== null) return "object";
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function getBoolean(value: unknown, key: string): boolean | undefined {
  const property = getProperty(value, key);
  return typeof property === "boolean" ? property : undefined;
}

function getNumber(value: unknown, key: string): number | undefined {
  const property = getProperty(value, key);
  return typeof property === "number" && Number.isFinite(property) ? property : undefined;
}

function stringifyPrimitive(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
}
