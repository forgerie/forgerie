import type { BoardCounts } from "./sessionBoard";

export type SessionInboxAttention = "blocked" | "unread";

/** Select the one inbox state the compact sessions opener can communicate. */
export function sessionInboxAttention(
  counts: Pick<BoardCounts, "blocked" | "unread">,
): SessionInboxAttention | undefined {
  if (counts.blocked > 0) return "blocked";
  if (counts.unread > 0) return "unread";
  return undefined;
}
