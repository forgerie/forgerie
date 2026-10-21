/**
 * A compact, readable view of a source branch for handoff preparation.
 *
 * The raw branch holds every tool result, image and thinking block, and can
 * reach tens of megabytes. A preparation agent given only the raw file spends
 * its first minutes writing scripts to extract the conversation. The digest
 * does that extraction once, on the server: it keeps what the source model
 * said and was told, shows recent tool traffic as one line per call and
 * result, and folds older tool traffic into one line per run of calls. Each
 * entry keeps its index into the raw branch so the agent can look up a clipped
 * entry when it needs the full content.
 */

export interface HandoffDigestTextLimits {
  /** Characters kept from one user message. */
  readonly userText: number;
  /** Characters kept from an assistant message that ends a run, usually the reply to the user. */
  readonly assistantText: number;
  /** Characters kept from assistant text that comes with tool calls, usually narration. */
  readonly assistantNarration: number;
}

export interface HandoffDigestLimits {
  /** Entries at the end of the branch that keep one line per tool call and result. */
  readonly recentEntries: number;
  readonly recent: HandoffDigestTextLimits;
  /** Limits for entries before the recent window, whose tool traffic is folded. */
  readonly older: HandoffDigestTextLimits;
  /** Characters kept from one tool call's arguments. */
  readonly toolArguments: number;
  /** Characters kept from a successful tool result. */
  readonly toolResult: number;
  /** Characters kept from a failed tool result. */
  readonly toolError: number;
  /** Characters kept from a custom (extension) message. */
  readonly customText: number;
}

export const DEFAULT_HANDOFF_DIGEST_LIMITS: HandoffDigestLimits = {
  recentEntries: 200,
  recent: { userText: 6000, assistantText: 4000, assistantNarration: 4000 },
  older: { userText: 2000, assistantText: 1200, assistantNarration: 240 },
  toolArguments: 300,
  toolResult: 200,
  toolError: 600,
  customText: 600,
};

/** Status and lifecycle records that the handoff itself writes; they carry no source context. */
const HANDOFF_CUSTOM_TYPES = new Set(["forgerie.handoff.status", "forgerie.handoff.lifecycle"]);

/** Tools whose `reply` argument is the model's visible answer, so the digest shows it as text. */
const REPLY_TOOLS = new Set(["end_turn"]);

type Detail = "recent" | "older";

/** One digest block, or tool calls to fold into the current run of older tool traffic. */
type Rendered =
  | { readonly kind: "block"; readonly lines: readonly string[] }
  | { readonly kind: "tools"; readonly index: number; readonly names: readonly string[]; readonly before?: readonly string[] }
  | { readonly kind: "none" };

const NONE: Rendered = { kind: "none" };

export function handoffBranchDigest(branch: readonly unknown[], limits: HandoffDigestLimits = DEFAULT_HANDOFF_DIGEST_LIMITS): string {
  const blocks: string[][] = [[
    "# Source branch digest",
    "",
    "Entries appear in branch order. `[n]` is the entry's index in the raw snapshot's `branch` array.",
    "User messages and assistant replies are kept; long ones are clipped.",
    `The last ${String(limits.recentEntries)} entries show one line per tool call and result. Older tool calls are folded into one line per run.`,
    "Thinking, images and most tool output are left out. Look up `[n]` in the raw snapshot when a clipped entry matters.",
  ]];
  const start = compactionStart(branch);
  if (start !== undefined) {
    blocks.push([`Entries before [${String(start.firstKept)}] are covered by the compaction summary at [${String(start.compaction)}], shown first.`]);
    blocks.push([`[${String(start.compaction)}] compaction summary`, stringAt(branch[start.compaction], "summary") ?? ""]);
  }
  const recentStart = Math.max(0, branch.length - limits.recentEntries);
  let folded: { first: number; last: number; counts: Map<string, number> } | undefined;
  const flush = () => {
    if (folded === undefined) return;
    const counts = [...folded.counts].map(([name, count]) => count === 1 ? name : `${name}×${String(count)}`).join(", ");
    const range = folded.first === folded.last ? String(folded.first) : `${String(folded.first)}–${String(folded.last)}`;
    blocks.push([`[${range}] tools: ${counts}`]);
    folded = undefined;
  };
  for (let index = start?.firstKept ?? 0; index < branch.length; index++) {
    if (index === start?.compaction) continue;
    const rendered = renderEntry(branch[index], index, index < recentStart ? "older" : "recent", limits);
    if (rendered.kind === "none") continue;
    if (rendered.kind === "block") {
      flush();
      blocks.push([...rendered.lines]);
      continue;
    }
    if (rendered.before !== undefined) {
      flush();
      blocks.push([...rendered.before]);
    }
    folded ??= { first: rendered.index, last: rendered.index, counts: new Map() };
    folded.last = rendered.index;
    for (const name of rendered.names) folded.counts.set(name, (folded.counts.get(name) ?? 0) + 1);
  }
  flush();
  return `${blocks.map((lines) => lines.join("\n")).join("\n\n")}\n`;
}

/** The latest compaction and the first entry it keeps, when both are on the branch. */
function compactionStart(branch: readonly unknown[]): { compaction: number; firstKept: number } | undefined {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (stringAt(entry, "type") !== "compaction") continue;
    const firstKeptId = stringAt(entry, "firstKeptEntryId");
    const firstKept = branch.findIndex((candidate) => stringAt(candidate, "id") === firstKeptId);
    return firstKept < 0 || firstKept > index ? { compaction: index, firstKept: index + 1 } : { compaction: index, firstKept };
  }
  return undefined;
}

function renderEntry(entry: unknown, index: number, detail: Detail, limits: HandoffDigestLimits): Rendered {
  const tag = `[${String(index)}]`;
  switch (stringAt(entry, "type") ?? "") {
    case "message":
      return renderMessage(propertyAt(entry, "message"), tag, index, stringAt(entry, "timestamp"), detail, limits);
    case "compaction":
      return block([`${tag} compaction summary`, stringAt(entry, "summary") ?? ""]);
    case "branch_summary":
      return block([`${tag} branch summary`, stringAt(entry, "summary") ?? ""]);
    case "custom_message":
      return renderCustom(entry, tag, index, limits);
    case "model_change":
      return block([`${tag} model: ${stringAt(entry, "provider") ?? "?"}/${stringAt(entry, "modelId") ?? "?"}`]);
    default:
      return NONE;
  }
}

function renderMessage(message: unknown, tag: string, index: number, timestamp: string | undefined, detail: Detail, limits: HandoffDigestLimits): Rendered {
  switch (stringAt(message, "role") ?? "") {
    case "user": {
      const when = timestamp === undefined ? "" : ` (${timestamp.slice(0, 16)}Z)`;
      return block([`${tag} USER${when}`, clip(contentText(propertyAt(message, "content")), limits[detail].userText, index)]);
    }
    case "assistant":
      return renderAssistant(message, tag, index, detail, limits);
    case "toolResult": {
      const name = stringAt(message, "toolName") ?? "tool";
      if (REPLY_TOOLS.has(name)) return NONE;
      const failed = propertyAt(message, "isError") === true;
      if (detail === "older") return failed ? block([`${tag} ← ${name} ERROR`]) : NONE;
      const text = contentText(propertyAt(message, "content"));
      const preview = oneLine(text, failed ? limits.toolError : limits.toolResult, index);
      return block([`${tag} ← ${name} ${failed ? "ERROR" : "ok"}, ${String(text.length)} chars${preview === "" ? "" : `: ${preview}`}`]);
    }
    case "bashExecution": {
      const exitCode = propertyAt(message, "exitCode");
      const exit = typeof exitCode === "number" ? ` exit ${String(exitCode)}` : "";
      return block([`${tag} USER SHELL: ${oneLine(stringAt(message, "command") ?? "", limits.toolArguments, index)}${exit}`, clip(stringAt(message, "output") ?? "", limits.toolError, index)]);
    }
    case "custom":
      return renderCustom(message, tag, index, limits);
    case "branchSummary":
    case "compactionSummary":
      return block([`${tag} summary`, stringAt(message, "summary") ?? ""]);
    default:
      return NONE;
  }
}

function renderAssistant(message: unknown, tag: string, index: number, detail: Detail, limits: HandoffDigestLimits): Rendered {
  const content = propertyAt(message, "content");
  const parts: unknown[] = Array.isArray(content) ? content : [];
  const calls = parts.filter((part) => stringAt(part, "type") === "toolCall");
  const replies = calls.flatMap((call) => {
    if (!REPLY_TOOLS.has(stringAt(call, "name") ?? "")) return [];
    const reply = stringAt(propertyAt(call, "arguments"), "reply");
    return reply === undefined ? [] : [reply];
  });
  const text = [...parts.filter((part) => stringAt(part, "type") === "text").map((part) => stringAt(part, "text") ?? ""), ...replies]
    .map((chunk) => chunk.trim()).filter((chunk) => chunk !== "").join("\n\n");
  const toolCalls = calls.filter((call) => !REPLY_TOOLS.has(stringAt(call, "name") ?? ""));
  const stopReason = stringAt(message, "stopReason");
  const errorMessage = stringAt(message, "errorMessage");
  const failure = stopReason === "error" || stopReason === "aborted"
    ? [`(run ended: ${stopReason}${errorMessage === undefined ? "" : `: ${oneLine(errorMessage, limits.toolError, index)}`})`]
    : [];
  const textLimit = toolCalls.length > 0 ? limits[detail].assistantNarration : limits[detail].assistantText;
  const body = [...(text === "" ? [] : [clip(text, textLimit, index)]), ...failure];
  if (detail === "older" && toolCalls.length > 0) {
    // The message's text precedes its calls, so it closes the previous fold and the calls start a new one.
    const names = toolCalls.map((call) => stringAt(call, "name") ?? "tool");
    return body.length === 0 ? { kind: "tools", index, names } : { kind: "tools", index, names, before: [`${tag} ASSISTANT`, ...body] };
  }
  const callLines = toolCalls.map((call) =>
    `→ ${stringAt(call, "name") ?? "tool"} ${oneLine(argumentsText(propertyAt(call, "arguments")), limits.toolArguments, index)}`);
  if (body.length === 0 && callLines.length === 0) return NONE;
  return block([`${tag} ASSISTANT`, ...body, ...callLines]);
}

function renderCustom(entry: unknown, tag: string, index: number, limits: HandoffDigestLimits): Rendered {
  const customType = stringAt(entry, "customType") ?? "custom";
  if (HANDOFF_CUSTOM_TYPES.has(customType)) return NONE;
  const text = contentText(propertyAt(entry, "content"));
  if (text.trim() === "") return NONE;
  return block([`${tag} ${customType}`, clip(text, limits.customText, index)]);
}

function block(lines: readonly string[]): Rendered {
  return { kind: "block", lines };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: unknown[] = content;
  return parts.map((part) => {
    const type = stringAt(part, "type");
    if (type === "text") return stringAt(part, "text") ?? "";
    if (type === "image") return "[image]";
    return "";
  }).filter((text) => text !== "").join("\n");
}

function argumentsText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function clip(text: string, limit: number, index: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit)}… [clipped ${String(trimmed.length - limit)} chars; full text in raw [${String(index)}]]`;
}

function oneLine(text: string, limit: number, index: number): string {
  return clip(text.replace(/\s+/g, " "), limit, index);
}

function propertyAt(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function stringAt(value: unknown, key: string): string | undefined {
  const property = propertyAt(value, key);
  return typeof property === "string" ? property : undefined;
}
