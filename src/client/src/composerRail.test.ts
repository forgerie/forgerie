import { describe, expect, it } from "vitest";
import { composerRail, type ComposerRailInput } from "./composerRail";

describe("composerRail", () => {
  it("offers send while the session is idle", () => {
    const rail = composerRail(input());

    expect(rail.kind).toBe("idle");
    expect(rail.primaryAction).toBe("send");
    expect(rail.canQueue).toBe(false);
    expect(rail.canSteer).toBe(false);
    expect(rail.canStop).toBe(false);
  });

  it("puts stop in the primary slot and offers queue while the agent streams", () => {
    const rail = composerRail(input({ isStreaming: true, stoppable: true }));

    expect(rail.kind).toBe("queueCapable");
    expect(rail.primaryAction).toBe("stop");
    expect(rail.canQueue).toBe(true);
    expect(rail.canInvokeQueue).toBe(true);
    expect(rail.canSteer).toBe(true);
    expect(rail.canStop).toBe(true);
  });

  it("queues without steering while history is compacting", () => {
    const rail = composerRail(input({ isCompacting: true, stoppable: true }));

    expect(rail.kind).toBe("queueCapable");
    expect(rail.primaryAction).toBe("stop");
    expect(rail.canQueue).toBe(true);
    expect(rail.canSteer).toBe(false);
    expect(rail.canStop).toBe(true);
  });

  it("drops steering when a compaction interrupts a stream", () => {
    expect(composerRail(input({ isStreaming: true, isCompacting: true, stoppable: true })).canSteer).toBe(false);
  });

  it("keeps send visible but uninvocable while a send is in flight", () => {
    const rail = composerRail(input({ sending: true }));

    expect(rail.kind).toBe("idle");
    expect(rail.primaryAction).toBe("send");
    expect(rail.canInvokePrimary).toBe(false);
  });

  it("keeps stop visible but not queue while work is stoppable without follow-up delivery", () => {
    const rail = composerRail(input({ stoppable: true }));

    expect(rail.kind).toBe("stopOnly");
    expect(rail.primaryAction).toBe("stop");
    expect(rail.canQueue).toBe(false);
    expect(rail.canSteer).toBe(false);
    expect(rail.canStop).toBe(true);
  });

  it("offers nothing invocable on a session that cannot be used", () => {
    const rail = composerRail(input({ disabled: true, isStreaming: true, stoppable: true }));

    expect(rail.kind).toBe("queueCapable");
    expect(rail.primaryAction).toBe("stop");
    expect(rail.canInvokePrimary).toBe(false);
    expect(rail.canInvokeQueue).toBe(false);
    expect(rail.canSteer).toBe(false);
    expect(rail.canStop).toBe(false);
  });
});

function input(overrides: Partial<ComposerRailInput> = {}): ComposerRailInput {
  return { disabled: false, sending: false, isStreaming: false, isCompacting: false, stoppable: false, ...overrides };
}
