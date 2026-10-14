const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface MessagePageRequest {
  before?: number;
  limit?: number;
  around?: number | undefined;
  /** New cursor callers reject unsafe ends; legacy reads retain their contract. */
  completeTurns?: true;
}

export interface MessagePageResult<T> {
  messages: T[];
  start: number;
  total: number;
}

/** Cursors and positions name the projected sequence, never the compacted context. */
export function pageMessagesAtSafeBoundary<T>(messages: T[], page?: MessagePageRequest): MessagePageResult<T> {
  const total = messages.length;
  if (page?.before === undefined && page?.limit === undefined && page?.around === undefined) return { messages, start: 0, total };
  const limit = page.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError("limit must be an integer from 1 to 500");
  let before = page.before ?? total;
  if (!Number.isSafeInteger(before) || before < 0 || before > total) throw new RangeError("before must name a position in this history");
  if (page.completeTurns === true && before !== total && before !== 0 && !isTurnBoundary(messages[before])) throw new RangeError("before must name a complete-turn boundary");
  if (page.around !== undefined) {
    if (!Number.isSafeInteger(page.around) || page.around < 0 || page.around >= total) throw new RangeError("around must name a message in this history");
    before = page.around + 1;
    while (before < total && !isTurnBoundary(messages[before])) before++;
  }
  const requestedStart = Math.max(0, before - limit);
  const start = expandStartToSafeBoundary(messages, page.around === undefined ? requestedStart : Math.min(requestedStart, page.around));
  return { messages: messages.slice(start, before), start, total };
}

export function expandStartToSafeBoundary(messages: unknown[], requestedStart: number): number {
  if (!Number.isSafeInteger(requestedStart) || requestedStart < 0 || requestedStart > messages.length) throw new RangeError("Invalid start position");
  if (requestedStart === 0 || requestedStart === messages.length || isTurnBoundary(messages[requestedStart])) return requestedStart;
  for (let index = requestedStart - 1; index >= 0; index--) if (isTurnBoundary(messages[index])) return index;
  return 0;
}

function isTurnBoundary(message: unknown): boolean {
  return typeof message === "object" && message !== null && "role" in message && message.role === "user";
}
