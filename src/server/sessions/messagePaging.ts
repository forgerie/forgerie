const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface MessagePageRequest {
  before?: number;
  limit?: number;
  around?: number | undefined;
  /**
   * New cursor callers reject unsafe ends; legacy reads retain their contract.
   * A safe end is a turn boundary, or a tool-round boundary inside a turn longer than one page.
   */
  completeTurns?: true;
}

export interface MessagePageResult<T> {
  messages: T[];
  start: number;
  total: number;
}

type Boundary = (message: unknown) => boolean;

/**
 * Cursors and positions name the projected sequence, never the compacted context.
 *
 * A page starts and ends on a turn boundary (a user message) when that fits in MAX_LIMIT messages.
 * One autonomous turn can hold hundreds of tool rounds, so a turn that does not fit is cut between
 * tool rounds instead: at an assistant message, which keeps each tool call with its results.
 */
export function pageMessagesAtSafeBoundary<T>(messages: T[], page?: MessagePageRequest): MessagePageResult<T> {
  const total = messages.length;
  if (page?.before === undefined && page?.limit === undefined && page?.around === undefined) return { messages, start: 0, total };
  const limit = page.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError("limit must be an integer from 1 to 500");
  const before = page.before ?? total;
  if (!Number.isSafeInteger(before) || before < 0 || before > total) throw new RangeError("before must name a position in this history");
  if (page.completeTurns === true && before !== total && before !== 0 && !isSafeCursor(messages, before)) throw new RangeError("before must name a complete-turn or tool-round boundary");
  if (page.around !== undefined && (!Number.isSafeInteger(page.around) || page.around < 0 || page.around >= total)) throw new RangeError("around must name a message in this history");
  const turns = safeWindow(messages, before, limit, page.around, isTurnBoundary);
  const window = turns.before - turns.start <= MAX_LIMIT ? turns : safeWindow(messages, before, limit, page.around, isRoundBoundary);
  return { messages: messages.slice(window.start, window.before), start: window.start, total };
}

function safeWindow(messages: unknown[], before: number, limit: number, around: number | undefined, boundary: Boundary): { start: number; before: number } {
  let end = before;
  if (around !== undefined) {
    end = around + 1;
    while (end < messages.length && !boundary(messages[end])) end++;
  }
  const requestedStart = Math.max(0, end - limit);
  return { start: expandStart(messages, around === undefined ? requestedStart : Math.min(requestedStart, around), boundary), before: end };
}

export function expandStartToSafeBoundary(messages: unknown[], requestedStart: number): number {
  return expandStart(messages, requestedStart, isTurnBoundary);
}

function expandStart(messages: unknown[], requestedStart: number, boundary: Boundary): number {
  if (!Number.isSafeInteger(requestedStart) || requestedStart < 0 || requestedStart > messages.length) throw new RangeError("Invalid start position");
  if (requestedStart === 0 || requestedStart === messages.length || boundary(messages[requestedStart])) return requestedStart;
  for (let index = requestedStart - 1; index >= 0; index--) if (boundary(messages[index])) return index;
  return 0;
}

/** A tool-round cursor is safe only inside a turn that pages cannot hold whole. */
function isSafeCursor(messages: unknown[], position: number): boolean {
  if (isTurnBoundary(messages[position])) return true;
  if (!isRoundBoundary(messages[position])) return false;
  let first = position, next = position + 1;
  while (first > 0 && !isTurnBoundary(messages[first])) first--;
  while (next < messages.length && !isTurnBoundary(messages[next])) next++;
  return next - first > MAX_LIMIT;
}

function roleOf(message: unknown): unknown {
  return typeof message === "object" && message !== null && "role" in message ? message.role : undefined;
}

function isTurnBoundary(message: unknown): boolean {
  return roleOf(message) === "user";
}

/** A tool round opens with the assistant message that makes its calls; its results follow it. */
function isRoundBoundary(message: unknown): boolean {
  const role = roleOf(message);
  return role === "user" || role === "assistant";
}
