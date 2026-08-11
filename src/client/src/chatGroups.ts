import type { ChatLine, ChatPart } from "./components/shared";

export type ChatGroup =
  | { kind: "message"; message: ChatLine; index: number }
  | { kind: "tool-image"; message: ChatLine; index: number; toolName?: string }
  | { kind: "group"; messages: ChatLine[]; startIndex: number; endIndex: number };

/**
 * Splits a flat message list into what the transcript renders.
 *
 * All the tool work in one turn pools into a single group at the foot of that
 * turn, below the prose. Flushing on every readable part instead shredded a
 * turn into an alternating ladder -- prose, activity, prose, activity -- which
 * spaced a sentence and the work it introduced as far apart as two unrelated
 * turns, and made the page read as twice as many items as it held.
 *
 * Pooling gives up strict chronology inside a turn: a sentence no longer sits
 * beside its own steps. Order is preserved inside the fold, and the turn is
 * the unit a reader actually scans.
 */
export function groupChatMessages(messages: ChatLine[], indexOffset = 0): ChatGroup[] {
  const groups: ChatGroup[] = [];
  let eventMessages: ChatLine[] = [];
  let eventStartIndex = 0;
  // Tracked, not derived from the length: a pooled turn skips over the prose
  // messages interleaved with its steps, so its indices are not contiguous.
  let eventEndIndex = 0;
  let historyMessages: ChatLine[] = [];
  let historyStartIndex = 0;
  let historyEndIndex = 0;

  const pushEvent = (message: ChatLine, index: number) => {
    if (!eventMessages.length) eventStartIndex = index;
    eventEndIndex = index;
    eventMessages.push(message);
  };
  const flushEvents = () => {
    if (!eventMessages.length) return;
    groups.push({ kind: "group", messages: eventMessages, startIndex: eventStartIndex, endIndex: eventEndIndex });
    eventMessages = [];
  };
  const pushHistory = (message: ChatLine, index: number) => {
    if (!historyMessages.length) historyStartIndex = index;
    historyEndIndex = index;
    historyMessages.push(message);
  };
  const flushHistory = () => {
    if (!historyMessages.length) return;
    groups.push({ kind: "group", messages: historyMessages, startIndex: historyStartIndex, endIndex: historyEndIndex });
    historyMessages = [];
  };

  messages.forEach((message, index) => {
    const absoluteIndex = indexOffset + index;
    const metadata = { ...(message.source === undefined ? {} : { source: message.source }), ...(message.meta === undefined ? {} : { meta: message.meta }) };

    // Compactions and branch summaries stay in a group of their own, so the
    // fold can keep naming them for what they are rather than calling them steps.
    if (isHistoryMessage(message)) {
      flushEvents();
      pushHistory({ role: message.role, parts: message.parts, ...metadata }, absoluteIndex);
      return;
    }
    flushHistory();

    const readableParts = message.parts.filter((part) => isReadablePart(message, part));
    const technicalParts = message.parts.filter((part) => !isReadablePart(message, part));

    if (readableParts.length && isTurnBoundary(message)) flushEvents();
    if (technicalParts.length) pushEvent({ role: message.role, parts: technicalParts, ...metadata }, absoluteIndex);
    if (readableParts.length) {
      const role = readableParts.every((part) => part.type === "skillRead") ? "skill" : message.role;
      const readableMessage = { role, parts: readableParts, ...metadata };
      if (isToolImageMessage(readableMessage)) {
        const toolName = toolNameFromParts(technicalParts);
        groups.push({ kind: "tool-image", message: readableMessage, index: absoluteIndex, ...(toolName === undefined ? {} : { toolName }) });
      } else {
        groups.push({ kind: "message", message: readableMessage, index: absoluteIndex });
      }
    }
  });
  flushEvents();
  flushHistory();
  return groups;
}

/**
 * One human message and everything the agent did in reply.
 *
 * `groupChatMessages` already pools a turn's steps at the foot of the turn, so
 * the run of groups from one human message up to the next is exactly the unit a
 * reader scans. Naming that run lets the transcript give it a box, which is
 * what the reading position anchors to and what reserves the space a reply
 * streams into.
 */
export interface ChatTurn {
  /** The turn's groups, in render order, starting with the human message when there is one. */
  readonly groups: ChatGroup[];
  /** Message index of the human message that opened the turn; absent for anything above the first one. */
  readonly openedByIndex?: number;
}

/** Partitions rendered groups into turns, each opened by a human message. */
export function chatTurns(groups: ChatGroup[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: { groups: ChatGroup[]; openedByIndex?: number } | undefined;

  for (const group of groups) {
    const openedByIndex = group.kind === "message" && isTurnBoundary(group.message) ? group.index : undefined;
    if (current === undefined || openedByIndex !== undefined) {
      current = { groups: [], ...(openedByIndex === undefined ? {} : { openedByIndex }) };
      turns.push(current);
    }
    current.groups.push(group);
  }
  return turns;
}

export interface ChatResponseStart {
  readonly turn: ChatTurn;
  readonly group: ChatGroup;
}

/** The first rendered agent content in the newest turn whose human opener is loaded. */
export function latestChatResponseStart(groups: ChatGroup[]): ChatResponseStart | undefined {
  const turn = chatTurns(groups).at(-1);
  if (turn?.openedByIndex === undefined) return undefined;
  const group = turn.groups.slice(1).find((candidate) => (
    candidate.kind === "tool-image"
    || (candidate.kind === "message" && (candidate.message.role === "assistant" || candidate.message.role === "system"))
  ));
  return group === undefined ? undefined : { turn, group };
}

/**
 * Which reply's metadata each activity fold should carry, keyed by the fold's
 * start index.
 *
 * The fold closes a turn, and the turn's time and model are a property of the
 * turn rather than of any one paragraph inside it. Reading them off the reply
 * that ended the turn keeps them describing the answer, not the last tool call.
 *
 * History folds are left out: a compaction summary is not the product of a
 * reply, so stamping one with a reply's model would be a lie.
 */
export function foldMetaSources(groups: ChatGroup[]): Map<number, ChatLine> {
  const sources = new Map<number, ChatLine>();
  let lastReply: ChatLine | undefined;

  for (const group of groups) {
    if (group.kind === "message") {
      if (group.message.role === "user" || group.message.role === "bash") lastReply = undefined;
      else if (group.message.role === "assistant") lastReply = group.message;
      continue;
    }
    if (group.kind !== "group") continue;
    if (group.messages.every(isHistoryMessage)) continue;
    if (lastReply !== undefined) sources.set(group.startIndex, lastReply);
  }
  return sources;
}

/**
 * A turn starts when the human does something. Everything the agent does in
 * reply -- however many sentences and tool calls -- belongs to that turn.
 */
function isTurnBoundary(message: ChatLine): boolean {
  return message.role === "user" || message.role === "bash";
}

function isHistoryMessage(message: ChatLine): boolean {
  return message.source === "compaction" || message.source === "branch_summary";
}

/**
 * The closed-fold summary.
 *
 * Deliberately a single count. The previous form broke the total down by role
 * ("4 events · 3 tool · 1 assistant"), which asks the reader to parse a
 * breakdown before deciding whether to open the fold -- the opposite of what a
 * fold is for. The breakdown is visible inside, where it costs nothing.
 */
export function summarizeChatGroup(messages: ChatLine[]): string {
  if (messages.every((message) => message.source === "compaction")) return `${String(messages.length)} history compaction ${messages.length === 1 ? "summary" : "summaries"}`;
  if (messages.every((message) => message.source === "branch_summary")) return `${String(messages.length)} branch ${messages.length === 1 ? "summary" : "summaries"}`;
  return `${String(messages.length)} ${messages.length === 1 ? "step" : "steps"}`;
}

function isToolImageMessage(message: ChatLine): boolean {
  return message.role === "tool" && message.parts.length > 0 && message.parts.every((part) => part.type === "image");
}

function toolNameFromParts(parts: ChatPart[]): string | undefined {
  for (const part of parts) {
    if ((part.type === "toolCall" || part.type === "toolExecution" || part.type === "toolResult") && part.toolName !== "") return part.toolName;
  }
  return undefined;
}

function isReadablePart(message: ChatLine, part: ChatPart): boolean {
  if (message.source === "compaction" || message.source === "branch_summary") return false;
  if (part.type === "skillInvocation" || part.type === "skillRead" || part.type === "image" || part.type === "askUserRecord" || part.type === "processNotification") return true;
  return part.type === "text" && (message.role === "user" || message.role === "assistant" || message.role === "system" || message.role === "bash");
}
