import { setChatLineTranscriptPosition } from "./chatLinePosition";
import type { ChatLine, ChatPart } from "./components/shared";

export type ChatGroup =
  | { kind: "message"; message: ChatLine; index: number }
  | { kind: "tool-image"; message: ChatLine; index: number; toolName?: string }
  | { kind: "group"; messages: ChatLine[]; startIndex: number; endIndex: number };

/**
 * Splits a flat message list into what the transcript renders.
 *
 * Step work flushes into a fold the moment prose appears, so a turn reads as
 * a chronological ladder: a sentence, then the steps it introduced, then the
 * next sentence. An earlier revision pooled all of a turn's steps into one
 * fold at the turn's foot because the bare ladder read as twice as many
 * items as it held. The process rail re-adopts the ladder deliberately: the
 * transcript wraps everything between the opener and the answer in one rail
 * (see `chatTurnFlow`), which contains the alternation instead of letting it
 * shred the page.
 */
export function groupChatMessages(messages: ChatLine[], indexOffset = 0): ChatGroup[] {
  const groups: ChatGroup[] = [];
  let eventMessages: ChatLine[] = [];
  let eventStartIndex = 0;
  // Tracked, not derived from the length: a cluster can skip indices when a
  // message contributes readable and technical parts at once.
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
    const derivedMessage = (parts: ChatPart[], segmentIndex = 0): ChatLine => {
      const derived = { role: message.role, parts, ...metadata };
      const position = message.transcriptPosition;
      return position === undefined ? derived : setChatLineTranscriptPosition(derived, { ...position, segmentIndex });
    };

    // Compactions and branch summaries stay in a group of their own, so the
    // fold can keep naming them for what they are rather than calling them steps.
    if (isHistoryMessage(message)) {
      flushEvents();
      pushHistory(derivedMessage(message.parts), absoluteIndex);
      return;
    }
    flushHistory();

    const readableParts = message.parts.filter((part) => isReadablePart(message, part));
    const firstReadable = message.parts.findIndex((part) => isReadablePart(message, part));
    // The ladder flushes pending steps the moment readable content appears,
    // but a message's own technical parts split on part order: thinking that
    // preceded a sentence folds above it, tool calls the sentence introduced
    // fold below it. Part order is the only chronology the wire preserves,
    // and honouring it keeps live projection and hydrated history grouping
    // identically.
    const leadingParts = message.parts.filter((part, index) => !isReadablePart(message, part) && (firstReadable === -1 || index < firstReadable));
    const trailingParts = message.parts.filter((part, index) => !isReadablePart(message, part) && firstReadable !== -1 && index > firstReadable);

    const readableSegmentIndex = leadingParts.length > 0 ? 1 : 0;
    const trailingSegmentIndex = readableSegmentIndex + (readableParts.length > 0 ? 1 : 0);
    if (leadingParts.length) pushEvent(derivedMessage(leadingParts), absoluteIndex);
    if (readableParts.length) flushEvents();
    if (trailingParts.length) pushEvent(derivedMessage(trailingParts, trailingSegmentIndex), absoluteIndex);
    if (readableParts.length) {
      const readableMessage = derivedMessage(readableParts, readableSegmentIndex);
      if (isToolImageMessage(readableMessage)) {
        const toolName = toolNameFromParts([...leadingParts, ...trailingParts]);
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

export interface ChatTurnGalleryImage {
  readonly messageIndex: number;
  readonly partIndex: number;
  readonly part: Extract<ChatPart, { type: "image" }>;
  readonly toolName?: string;
}

/** Tool-produced images that belong to one turn, in transcript order. */
export function chatTurnGalleryImages(turn: ChatTurn): ChatTurnGalleryImage[] {
  return turn.groups.flatMap((group) => {
    if (group.kind !== "tool-image") return [];
    return group.message.parts.flatMap((part, partIndex) => part.type === "image"
      ? [{ messageIndex: group.index, partIndex, part, ...(group.toolName === undefined ? {} : { toolName: group.toolName }) }]
      : []);
  });
}

/** Removes standalone tool-image groups after their images move into the turn gallery. */
export function withoutToolImageGroups(groups: readonly ChatGroup[]): ChatGroup[] {
  return groups.filter((group) => group.kind !== "tool-image");
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

export interface ChatTurnStart {
  readonly turn: ChatTurn;
  readonly group: ChatGroup;
}

/** The human opener of the newest turn, when that opener is loaded. */
export function latestChatTurnStart(groups: ChatGroup[]): ChatTurnStart | undefined {
  const turn = chatTurns(groups).at(-1);
  if (turn?.openedByIndex === undefined) return undefined;
  const group = turn.groups[0];
  return group === undefined ? undefined : { turn, group };
}

/**
 * How a turn reads on the process rail.
 *
 * The opener is the human message that started the turn. The answer is the
 * latest assistant prose whose message delivery has settled. It stays promoted
 * while later tools, questions, compaction, or a newer streaming reply continue
 * below it. Work before and after the answer remains in chronological order.
 */
export interface ChatTurnFlow {
  /** The human message that opened the turn, when it is loaded. */
  readonly opener?: ChatGroup;
  /** Narration and steps that happened before the promoted answer. */
  readonly work: readonly ChatGroup[];
  /** Latest settled assistant prose; absent until any assistant prose has settled. */
  readonly answer?: ChatGroup;
  /** Work that happened after the promoted answer, including newer streaming prose. */
  readonly continuation: readonly ChatGroup[];
}

/**
 * Splits a turn into opener, work, and answer.
 *
 * The latest assistant prose becomes the answer when delivery settles or later
 * non-prose work proves it is no longer the active stream tail. While newer
 * prose streams, the previous settled prose remains promoted and the new text
 * stays in the continuation rail.
 */
export function chatTurnFlow(turn: ChatTurn, replySettled: boolean): ChatTurnFlow {
  const first = turn.groups[0];
  const opener = first !== undefined && turn.openedByIndex !== undefined && first.kind === "message" && first.index === turn.openedByIndex
    ? first
    : undefined;
  const body = opener === undefined ? turn.groups : turn.groups.slice(1);
  const latestReplyIndex = previousPromotableReplyIndex(body, body.length);
  const latestReplyCanPromote = latestReplyIndex >= 0
    && (replySettled || latestReplyIndex < body.length - 1);
  const answerIndex = latestReplyCanPromote
    ? latestReplyIndex
    : previousPromotableReplyIndex(body, latestReplyIndex);
  const answer = body[answerIndex];
  if (answer === undefined) {
    return { ...(opener === undefined ? {} : { opener }), work: body, continuation: [] };
  }
  return {
    ...(opener === undefined ? {} : { opener }),
    work: body.slice(0, answerIndex),
    answer,
    continuation: body.slice(answerIndex + 1),
  };
}

function previousPromotableReplyIndex(groups: readonly ChatGroup[], before: number): number {
  for (let index = before - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group !== undefined && isPromotableReply(group)) return index;
  }
  return -1;
}

function isPromotableReply(group: ChatGroup): boolean {
  return group.kind === "message"
    && group.message.role === "assistant"
    && group.message.parts.some((part) => part.type === "text");
}

/**
 * The reply whose metadata describes the turn: its time and model close the
 * rail, describing the answer rather than the last tool call. History
 * summaries never qualify -- a compaction is not the product of a reply.
 */
export function turnMetaSource(turn: ChatTurn): ChatLine | undefined {
  for (let index = turn.groups.length - 1; index >= 0; index -= 1) {
    const group = turn.groups[index];
    // History summaries never appear as message groups, so any assistant
    // message found here is a real reply.
    if (group?.kind === "message" && group.message.role === "assistant") return group.message;
  }
  return undefined;
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

/**
 * Whether a part is something the turn said, or machinery it ran through.
 *
 * Readable parts stand in the transcript under their own role. Everything else
 * pools into the fold that closes the turn.
 *
 * Skill reads and background-process notifications are machinery. They used to
 * be readable, which gave each one a role label and a bordered card: five
 * consecutive notices about one process cost a screenful and repeated the
 * process name, the exit code, and the word SYSTEM on every one. They belong
 * with the steps, where one line names the whole run.
 *
 * `askUserRecord` and `image` stay readable because they are content the reader
 * came for, and `skillInvocation` carries the skill's own text.
 */
function isReadablePart(message: ChatLine, part: ChatPart): boolean {
  if (message.source === "compaction" || message.source === "branch_summary") return false;
  if (part.type === "skillInvocation" || part.type === "image" || part.type === "askUserRecord") return true;
  return part.type === "text" && (message.role === "user" || message.role === "assistant" || message.role === "system" || message.role === "bash");
}
