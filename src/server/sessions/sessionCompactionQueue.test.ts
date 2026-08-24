import { describe, expect, it } from "vitest";
import { SessionCompactionQueue, type QueuedPrompt } from "./sessionCompactionQueue.js";

const earlier: QueuedPrompt = { kind: "followUp", text: "Finish first" };
const later: QueuedPrompt = { kind: "followUp", text: "Continue later" };

describe("SessionCompactionQueue", () => {
  it("projects the compaction boundary between earlier and later prompts", () => {
    const queue = new SessionCompactionQueue();
    queue.enqueuePrompt("s1", earlier);
    queue.queueCompaction("s1", "/compact focus on decisions");
    queue.enqueuePrompt("s1", later);

    expect(queue.queuedMessages("s1", [])).toEqual([
      earlier,
      { kind: "followUp", text: "/compact focus on decisions" },
      later,
    ]);
    expect(queue.pendingCount("s1")).toBe(3);
  });

  it("projects queued prompts without exposing attachment data or internal flags", () => {
    const queue = new SessionCompactionQueue();
    queue.queueCompaction("s1", "/compact");
    queue.enqueuePrompt("s1", {
      kind: "followUp",
      text: "Review the image later",
      images: [{ type: "image", mimeType: "image/png", data: "QUJD" }],
      echoUserMessage: false,
      expandPromptTemplates: false,
    });

    expect(queue.queuedMessages("s1", [])).toEqual([
      { kind: "followUp", text: "/compact" },
      { kind: "followUp", text: "Review the image later" },
    ]);
  });

  it("releases later prompts only after the queued compaction finishes", () => {
    const queue = new SessionCompactionQueue();
    queue.queueCompaction("s1", "/compact");
    queue.enqueuePrompt("s1", later);

    const handle = queue.startCompaction("s1");
    expect(handle?.text).toBe("/compact");
    expect(queue.queuedMessages("s1", [])).toEqual([{ kind: "followUp", text: "/compact" }, later]);
    expect(queue.takeReadyPrompts("s1")).toEqual([]);

    if (handle === undefined) throw new Error("Expected a queued compaction handle");
    expect(queue.commitCompactionStart(handle)).toBe(true);
    expect(queue.queuedMessages("s1", [])).toEqual([later]);
    queue.finishCompaction("s1");

    expect(queue.takeReadyPrompts("s1")).toEqual([later]);
  });

  it("returns a checked compaction to the queue when new work wins the start race", () => {
    const queue = new SessionCompactionQueue();
    queue.queueCompaction("s1", "/compact");
    const handle = queue.startCompaction("s1");
    if (handle === undefined) throw new Error("Expected a queued compaction handle");

    expect(queue.deferCompaction(handle)).toBe(true);
    expect(queue.isCompactionQueued("s1")).toBe(true);
    expect(queue.queuedMessages("s1", [])).toEqual([{ kind: "followUp", text: "/compact" }]);
    expect(queue.failCompaction(handle)).toBe(false);
  });

  it("uses handles to ignore stale queued-compaction failures", () => {
    const queue = new SessionCompactionQueue();
    queue.queueCompaction("s1", "/compact");
    const handle = queue.startCompaction("s1");
    if (handle === undefined) throw new Error("Expected a queued compaction handle");
    expect(queue.commitCompactionStart(handle)).toBe(true);
    queue.clear("s1");
    queue.queueCompaction("s1", "/compact use newer instructions");

    expect(queue.commitCompactionStart(handle)).toBe(false);
    expect(queue.failCompaction(handle)).toBe(false);
    expect(queue.queuedMessages("s1", [])).toEqual([{ kind: "followUp", text: "/compact use newer instructions" }]);
  });
});
