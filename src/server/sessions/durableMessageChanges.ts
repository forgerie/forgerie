import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { MessageChange } from "@earendil-works/pi-durable";

type Block = AssistantMessage["content"][number];
type StreamedBlock = Extract<Block, { type: "text" | "thinking" }>;

/**
 * Applies one Durable commit to the in-flight message and reports each change
 * as SDK readers expect it, with the message after that change. The restated
 * deltas carry only text, so the commit's own change is applied with the last
 * of them: it keeps metadata such as signatures and the response ID. Returns
 * the message after the commit.
 */
export function applySdkCommit(partial: AssistantMessage | undefined, changes: readonly MessageChange[],
  report: (change: MessageChange, partial: AssistantMessage | undefined) => void): AssistantMessage | undefined {
  let current = partial;
  for (const coalesced of byContentIndex(changes)) {
    const restated = sdkMessageChanges(current, coalesced);
    restated.forEach((change, index) => {
      current = applyMessageChange(current, change);
      if (change !== coalesced && index === restated.length - 1) current = applyMessageChange(current, coalesced);
      report(change, current);
    });
  }
  return current;
}

/** One change applied to the in-flight message. A delta changes the message in place; a whole message replaces it. */
export function applyMessageChange(partial: AssistantMessage | undefined, change: MessageChange): AssistantMessage | undefined {
  if (change.type === "message") return structuredClone(change.message);
  if (partial === undefined) return undefined;
  if ("block" in change) { partial.content[change.contentIndex] = structuredClone(change.block); return partial; }
  const block = partial.content[change.contentIndex];
  if (change.type === "text_delta" && block?.type === "text") block.text += change.delta;
  if (change.type === "thinking_delta" && block?.type === "thinking") block.thinking += change.delta;
  return partial;
}

/**
 * Durable commits the in-flight message at most every 100 ms, so one change
 * can carry text that the SDK streams as deltas: a block that starts with
 * text, or a whole block or message that replaces an earlier one. Readers that
 * follow only deltas, such as the browser, would never see that text. This
 * restates such a change as SDK-shaped starts and deltas, relative to the
 * message `before` it. A replacement that does not only extend earlier text
 * cannot be a delta, and one that adds no text has nothing to restate; both
 * stay as Durable sent them.
 */
export function sdkMessageChanges(before: AssistantMessage | undefined, change: MessageChange): MessageChange[] {
  switch (change.type) {
    case "text_start":
    case "thinking_start": return isStreamed(change.block) ? started(change.contentIndex, change.block) : [change];
    case "block": {
      const previous = before?.content[change.contentIndex];
      const restated = previous === undefined ? started(change.contentIndex, change.block) : extended(change.contentIndex, previous, change.block);
      return restated === undefined || restated.length === 0 ? [change] : restated;
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
      return change.message.content.length < before.content.length || restated.length === 0 ? [change] : restated;
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
