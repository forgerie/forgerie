import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { MessageChange } from "@earendil-works/pi-durable";

type Block = AssistantMessage["content"][number];
type StreamedBlock = Extract<Block, { type: "text" | "thinking" }>;

/**
 * Durable commits the in-flight message at most every 100 ms, so one change
 * can carry text that the SDK streams as deltas: a block that starts with
 * text, or a whole block or message that replaces an earlier one. Readers that
 * follow only deltas, such as the browser, would never see that text. This
 * restates such a change as SDK-shaped starts and deltas, relative to the
 * message `before` it. A replacement that does not only extend earlier text
 * cannot be a delta; it stays as Durable sent it.
 */
export function sdkMessageChanges(before: AssistantMessage | undefined, change: MessageChange): MessageChange[] {
  switch (change.type) {
    case "text_start":
    case "thinking_start": return isStreamed(change.block) ? started(change.contentIndex, change.block) : [change];
    case "block": {
      const previous = before?.content[change.contentIndex];
      const restated = previous === undefined ? started(change.contentIndex, change.block) : extended(change.contentIndex, previous, change.block);
      return restated ?? [change];
    }
    case "message": {
      if (before === undefined) return [change];
      const restated: MessageChange[] = [];
      for (const [contentIndex, block] of change.message.content.entries()) {
        const previous = before.content[contentIndex];
        const next = previous === undefined ? started(contentIndex, block) : extended(contentIndex, previous, block);
        if (next === undefined) return [change];
        restated.push(...next);
      }
      return change.message.content.length < before.content.length ? [change] : restated;
    }
    // Deltas need no restating. A tool call start stays as Durable sent it.
    case "toolcall_start":
    case "text_delta":
    case "thinking_delta":
    case "toolcall_delta": return [change];
  }
}

/**
 * Changes in one commit happened together. Ordering them by block keeps each
 * block's text contiguous for readers that append to the newest block.
 */
export function byContentIndex(changes: readonly MessageChange[]): MessageChange[] {
  return [...changes].sort((left, right) => contentIndexOf(left) - contentIndexOf(right));
}

function contentIndexOf(change: MessageChange): number {
  return change.type === "message" ? -1 : change.contentIndex;
}

function isStreamed(block: Block): block is StreamedBlock {
  return block.type === "text" || block.type === "thinking";
}
function textOf(block: StreamedBlock): string {
  return block.type === "text" ? block.text : block.thinking;
}
function delta(contentIndex: number, block: StreamedBlock, text: string): MessageChange[] {
  return text === "" ? [] : [{ type: block.type === "text" ? "text_delta" : "thinking_delta", contentIndex, delta: text }];
}

function started(contentIndex: number, block: Block): MessageChange[] {
  if (!isStreamed(block)) return [{ type: "toolcall_start", contentIndex, block }];
  const empty: StreamedBlock = block.type === "text" ? { ...block, text: "" } : { ...block, thinking: "" };
  return [{ type: block.type === "text" ? "text_start" : "thinking_start", contentIndex, block: empty }, ...delta(contentIndex, block, textOf(block))];
}

/** Deltas that turn `previous` into `next`, or undefined when `next` does not only extend its text. */
function extended(contentIndex: number, previous: Block, next: Block): MessageChange[] | undefined {
  if (previous === next) return [];
  if (!isStreamed(previous) || !isStreamed(next) || previous.type !== next.type) return undefined;
  const was = textOf(previous);
  const now = textOf(next);
  return now.startsWith(was) ? delta(contentIndex, next, now.slice(was.length)) : undefined;
}
