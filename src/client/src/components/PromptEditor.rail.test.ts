// @vitest-environment happy-dom

import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { isTemplateResult, templateText } from "../templateInspection.testSupport";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities } from "./promptEditorTestSupport";

afterEach(() => {
  document.body.replaceChildren();
});

describe("PromptEditor control rail", () => {
  it("offers one send control while the session is idle", () => {
    const rendered = templateText(render(editor()));

    expect(rendered).toContain("Send message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("turns send into a queue and offers steering beside it while the agent streams", () => {
    const rendered = templateText(render(editor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }) })));

    expect(rendered).toContain("Queue message");
    expect(rendered).toContain("Steer current response");
    expect(rendered).not.toContain("Send message");
  });

  it("queues without steering while history is compacting", () => {
    const rendered = templateText(render(editor({ isCompacting: true, capabilities: sessionCapabilities({ stoppable: true }) })));

    expect(rendered).toContain("Queue message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("steers the running reply rather than queueing behind it", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("use the second approach");

    button(composer, ".steer-button").click();

    expect(onSend).toHaveBeenCalledWith("use the second approach", "steer", undefined, undefined);
  });

  it("queues the message when the primary control is used mid-stream", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("and then run the tests");

    button(composer, ".send-button").click();

    expect(onSend).toHaveBeenCalledWith("and then run the tests", "followUp", undefined, undefined);
  });

  it("sends straight through when nothing is running", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ onSend });
    composer.replaceText("start here");

    button(composer, ".send-button").click();

    expect(onSend).toHaveBeenCalledWith("start here", undefined, undefined, undefined);
  });

  it("accepts nothing from a session that cannot be used", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ disabled: true, canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("too late");

    button(composer, ".send-button").click();

    expect(onSend).not.toHaveBeenCalled();
  });
});

function editor(overrides: Partial<PromptEditor> = {}): PromptEditor {
  const composer = new PromptEditor();
  composer.status = status();
  Object.assign(composer, overrides);
  return composer;
}

async function mountEditor(overrides: Partial<PromptEditor> = {}): Promise<PromptEditor> {
  const composer = editor(overrides);
  document.body.append(composer);
  await composer.updateComplete;
  if (composer.view === undefined) throw new Error("Expected CodeMirror to mount");
  return composer;
}

function button(composer: PromptEditor, selector: string): HTMLButtonElement {
  const found = composer.shadowRoot?.querySelector<HTMLButtonElement>(selector);
  if (found === null || found === undefined) throw new Error(`Expected ${selector}`);
  return found;
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
