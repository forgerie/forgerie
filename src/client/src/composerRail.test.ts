import { describe, expect, it } from "vitest";
import { composerRail, type ComposerRailInput } from "./composerRail";

describe("composerRail", () => {
  it("offers send while the session is idle", () => {
    const rail = composerRail(input());

    expect(rail.kind).toBe("idle");
    expect(rail.primaryAction).toBe("send");
    expect(rail.canSteer).toBe(false);
    expect(rail.canStop).toBe(false);
  });

  it("turns the primary action into a queue while the agent streams", () => {
    const rail = composerRail(input({ isStreaming: true, stoppable: true }));

    expect(rail.kind).toBe("working");
    expect(rail.primaryAction).toBe("queue");
    expect(rail.canSteer).toBe(true);
    expect(rail.canStop).toBe(true);
  });

  it("queues without steering while history is compacting, because there is no reply to steer", () => {
    const rail = composerRail(input({ isCompacting: true }));

    expect(rail.kind).toBe("working");
    expect(rail.primaryAction).toBe("queue");
    expect(rail.canSteer).toBe(false);
  });

  it("drops steering when a compaction interrupts a stream", () => {
    expect(composerRail(input({ isStreaming: true, isCompacting: true })).canSteer).toBe(false);
  });

  it("keeps the primary action visible but uninvocable while a send is in flight", () => {
    const rail = composerRail(input({ sending: true }));

    expect(rail.primaryAction).toBe("send");
    expect(rail.canInvokePrimary).toBe(false);
  });

  it("offers nothing invocable on a session that cannot be used", () => {
    const rail = composerRail(input({ disabled: true, isStreaming: true, stoppable: true }));

    expect(rail.canInvokePrimary).toBe(false);
    expect(rail.canSteer).toBe(false);
    expect(rail.canStop).toBe(false);
  });

  it("keeps stop live for work that is running without a stream", () => {
    const rail = composerRail(input({ stoppable: true }));

    expect(rail.kind).toBe("idle");
    expect(rail.canStop).toBe(true);
  });
});

function input(overrides: Partial<ComposerRailInput> = {}): ComposerRailInput {
  return { disabled: false, sending: false, isStreaming: false, isCompacting: false, stoppable: false, ...overrides };
}
