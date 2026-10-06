import { describe, expect, it } from "vitest";
import type { SessionStatus } from "./contracts";
import type { CompactionState } from "./compaction";
import { queueKindOf, isAlreadyQueued, workingSend } from "./queue";

const idle: SessionStatus = { isStreaming: false, isCompacting: false, isBashRunning: false, queuedMessages: [] };
const none: CompactionState = { type: "idle" };

describe("sending while the session works", () => {
  it("sends normally when nothing runs", () => {
    expect(workingSend(idle, none)).toEqual({ queue: false, steer: false });
    expect(workingSend(undefined, none)).toEqual({ queue: false, steer: false });
  });

  it("queues and steers while the agent responds", () => {
    expect(workingSend({ ...idle, isStreaming: true }, none)).toEqual({ queue: true, steer: true });
  });

  it("queues behind compaction but does not offer a steer that would wait for it", () => {
    expect(workingSend({ ...idle, isCompacting: true }, none)).toEqual({ queue: true, steer: false });
    for (const compaction of [{ type: "checking" }, { type: "queued", text: "/compact" }, { type: "running" }] as const) {
      expect(workingSend({ ...idle, isStreaming: true }, compaction)).toEqual({ queue: true, steer: false });
    }
  });

  it("treats a run the transcript has seen start as a response before status catches up", () => {
    expect(workingSend(idle, none, true)).toEqual({ queue: true, steer: true });
    expect(workingSend({ ...idle, isCompacting: true }, none, true)).toEqual({ queue: true, steer: false });
  });

  it("needs neither while only a shell command runs, because Pi starts the prompt at once", () => {
    expect(workingSend({ ...idle, isBashRunning: true }, none)).toEqual({ queue: false, steer: false });
  });
});

describe("queued items", () => {
  it("names each item by when it runs", () => {
    expect(queueKindOf({ kind: "steer", text: "use the helper" })).toBe("steer");
    expect(queueKindOf({ kind: "followUp", text: "add tests" })).toBe("followUp");
    expect(queueKindOf({ kind: "followUp", text: "/compact keep decisions" })).toBe("compaction");
    expect(queueKindOf({ kind: "followUp", text: "/compactor" })).toBe("followUp");
  });

  it("knows a text Pi would ignore as a duplicate", () => {
    const status = { ...idle, isStreaming: true, queuedMessages: [{ kind: "followUp" as const, text: "add tests" }] };
    expect(isAlreadyQueued(status, "add tests")).toBe(true);
    expect(isAlreadyQueued(status, "add tests ")).toBe(false);
    expect(isAlreadyQueued(undefined, "add tests")).toBe(false);
  });
});
