// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatLine, ToolExecutionPart } from "./shared";
import type { TranscriptLivenessView } from "./TranscriptLivenessView";
import type { TurnRailSummary } from "./TurnRailSummary";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function tool(toolName: string, summary: string, status: ToolExecutionPart["status"] = "running"): ChatLine {
  return { role: "tool", parts: [{ type: "toolExecution", toolName, summary, status }] };
}

async function mount(step: ChatLine, activityAt: string): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = [{ role: "user", parts: [{ type: "text", text: "question" }] }, step];
  view.activity = { sessionId: "session-1", phase: "active", label: "running tool", at: activityAt };
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

function liveness(view: ChatView): TranscriptLivenessView {
  const element = view.shadowRoot?.querySelector<TranscriptLivenessView>("transcript-liveness");
  if (element === null || element === undefined) throw new Error("The transcript rendered no liveness row");
  return element;
}

function rail(view: ChatView): TurnRailSummary {
  const element = view.shadowRoot?.querySelector<TurnRailSummary>("turn-rail-summary");
  if (element === null || element === undefined) throw new Error("The transcript rendered no turn rail");
  return element;
}

describe("ChatView liveness clocks", () => {
  it("keeps turn age while resetting step age when the visible step changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-24T11:00:00.000Z");
    const view = await mount(tool("read", "archive.ts"), "2026-08-24T11:00:00.000Z");
    const turnStartedAt = rail(view).startedAt;
    expect(liveness(view).startedAt).toBe("2026-08-24T11:00:00.000Z");

    vi.setSystemTime("2026-08-24T11:06:00.000Z");
    view.messages = [{ role: "user", parts: [{ type: "text", text: "question" }] }, tool("bash", "npm run verify")];
    view.activity = { sessionId: "session-1", phase: "active", label: "running tool", at: "2026-08-24T11:06:00.000Z" };
    await view.updateComplete;
    await view.updateComplete;

    expect(rail(view).startedAt).toBe(turnStartedAt);
    expect(liveness(view).startedAt).toBe("2026-08-24T11:06:00.000Z");
    expect(liveness(view).step).toContain("bash npm run verify");
  });

  it("refreshes silence without resetting step age when activity advances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-24T11:00:00.000Z");
    const view = await mount(tool("bash", "npm run verify"), "2026-08-24T11:00:00.000Z");

    vi.setSystemTime("2026-08-24T11:00:20.000Z");
    view.activity = { sessionId: "session-1", phase: "active", label: "tool execution update", at: "2026-08-24T11:00:20.000Z" };
    await view.updateComplete;
    await view.updateComplete;

    expect(liveness(view).startedAt).toBe("2026-08-24T11:00:00.000Z");
    expect(liveness(view).lastActivityAt).toBe("2026-08-24T11:00:20.000Z");
  });

  it("passes the existing stop capability to a stuck liveness row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-24T11:00:00.000Z");
    const view = await mount(tool("bash", "npm run verify"), "2026-08-24T11:00:00.000Z");
    const onStop = vi.fn();
    view.onStopActiveWork = onStop;
    await view.updateComplete;

    expect(liveness(view).onStop).toBe(onStop);
  });
});
