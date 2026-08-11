import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { isTemplateResult, templateClickHandlerForText, templateText } from "../templateInspection.testSupport";
import { PromptEditor } from "./PromptEditor";

describe("PromptEditor control rail", () => {
  it("offers one send control while the session is idle", () => {
    const rendered = templateText(render(editor()));

    expect(rendered).toContain("Send message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("turns send into a queue and offers steering beside it while the agent streams", () => {
    const rendered = templateText(render(editor({ canSteer: true, canStop: true })));

    expect(rendered).toContain("Queue message");
    expect(rendered).toContain("Steer current response");
    expect(rendered).not.toContain("Send message");
  });

  it("queues without steering while history is compacting", () => {
    const rendered = templateText(render(editor({ isCompacting: true, canStop: true })));

    expect(rendered).toContain("Queue message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("steers the running reply rather than queueing behind it", () => {
    const onSend = vi.fn();
    const composer = editor({ canSteer: true, canStop: true, onSend });
    setDraft(composer, "use the second approach");

    templateClickHandlerForText(render(composer), "Steer current response")(new Event("click"));

    expect(onSend).toHaveBeenCalledWith("use the second approach", "steer", undefined, undefined);
  });

  it("queues the message when the primary control is used mid-stream", () => {
    const onSend = vi.fn();
    const composer = editor({ canSteer: true, canStop: true, onSend });
    setDraft(composer, "and then run the tests");

    templateClickHandlerForText(render(composer), "Queue message")(new Event("click"));

    expect(onSend).toHaveBeenCalledWith("and then run the tests", "followUp", undefined, undefined);
  });

  it("sends straight through when nothing is running", () => {
    const onSend = vi.fn();
    const composer = editor({ onSend });
    setDraft(composer, "start here");

    templateClickHandlerForText(render(composer), "Send message")(new Event("click"));

    expect(onSend).toHaveBeenCalledWith("start here", undefined, undefined, undefined);
  });

  it("accepts nothing from a session that cannot be used", () => {
    const onSend = vi.fn();
    const composer = editor({ disabled: true, canSteer: true, canStop: true, onSend });
    setDraft(composer, "too late");

    templateClickHandlerForText(render(composer), "Queue message")(new Event("click"));

    expect(onSend).not.toHaveBeenCalled();
  });
});

function editor(overrides: Partial<PromptEditor> = {}): PromptEditor {
  const composer = new PromptEditor();
  composer.status = status();
  Object.assign(composer, overrides);
  return composer;
}

function setDraft(composer: PromptEditor, text: string): void {
  if (!Reflect.set(composer, "draft", text)) throw new Error("Could not seed the composer draft");
}

function render(composer: PromptEditor): TemplateResult {
  const rendered: unknown = composer.render();
  if (!isTemplateResult(rendered)) throw new Error("expected the composer template");
  return rendered;
}

function status(): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    model: { id: "gpt-5.6-sol", provider: "openai-codex" },
  };
}
