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

  it("does not render resident Stop while runtime controls are available but the session is idle", () => {
    const rendered = templateText(render(editor({ capabilities: sessionCapabilities({ stoppable: false }) })));

    expect(rendered).toContain("Send message");
    expect(rendered).not.toContain("Stop current work");
    expect(rendered).not.toContain("Queue message");
  });

  it("puts Stop in the send slot and Queue beside it while the agent streams", () => {
    const rendered = templateText(render(editor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }) })));

    expect(rendered).toContain("Stop current work");
    expect(rendered).toContain("Queue message");
    expect(rendered).not.toContain("Send message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("puts Stop in the send slot and queues without steering while history is compacting", () => {
    const rendered = templateText(render(editor({ isCompacting: true, capabilities: sessionCapabilities({ stoppable: true }) })));

    expect(rendered).toContain("Stop current work");
    expect(rendered).toContain("Queue message");
    expect(rendered).not.toContain("Send message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("shows Stop without Send, Queue, or Steer when work is stoppable but follow-up delivery is unavailable", () => {
    const rendered = templateText(render(editor({ capabilities: sessionCapabilities({ stoppable: true }) })));

    expect(rendered).toContain("Stop current work");
    expect(rendered).not.toContain("Send message");
    expect(rendered).not.toContain("Queue message");
    expect(rendered).not.toContain("Steer current response");
  });

  it("queues the message when the Queue control is used mid-stream", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ canSteer: true, capabilities: sessionCapabilities({ stoppable: true }), onSend });
    composer.replaceText("and then run the tests");

    button(composer, ".queue-button").click();

    expect(onSend).toHaveBeenCalledWith("and then run the tests", "followUp", undefined, undefined);
  });

  it("sends straight through when nothing is running", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ onSend });
    composer.replaceText("start here");

    button(composer, ".send-button").click();

    expect(onSend).toHaveBeenCalledWith("start here", undefined, undefined, undefined);
  });

  it("rejects submit in stop-only state without calling onSend or clearing the draft", async () => {
    const onSend = vi.fn();
    const composer = await mountEditor({ capabilities: sessionCapabilities({ stoppable: true }), onSend });
    const attachment = { kind: "file" as const, mimeType: "text/plain", data: "aGVsbG8=", name: "note.txt" };
    composer.restoreSnapshot({ text: "keep this", attachments: [attachment], delivery: "folder" });
    await composer.updateComplete;
    await composer.draft?.updateComplete;

    const draft = requiredDraft(composer);
    expect(draft.disabled).toBe(false);
    expect(draft.submissionDisabled).toBe(false);
    expect(composer.shadowRoot?.querySelector(".attachment-chip")?.textContent).toContain("note.txt");

    pressEnter(composer);
    await composer.updateComplete;
    await composer.draft?.updateComplete;

    expect(onSend).not.toHaveBeenCalled();
    expect(composer.view?.state.doc.toString()).toBe("keep this");
    expect(composer.shadowRoot?.querySelector(".attachment-chip")?.textContent).toContain("note.txt");
    expect(composer.shadowRoot?.querySelector<HTMLInputElement>(".attachment-delivery input[value='folder']")?.checked).toBe(true);
  });

  it("keeps Stop invocable when Queue submission is busy", async () => {
    const onStop = vi.fn();
    const composer = await mountEditor({ canSteer: true, sending: true, capabilities: sessionCapabilities({ stoppable: true, onStop }) });

    const stop = button(composer, ".stop-button");
    const queue = button(composer, ".queue-button");

    expect(queue.disabled).toBe(true);
    expect(stop.disabled).toBe(false);
    stop.click();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("accepts nothing from a session that cannot be used", async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const composer = await mountEditor({ disabled: true, canSteer: true, capabilities: sessionCapabilities({ stoppable: true, onStop }), onSend });
    composer.replaceText("too late");

    button(composer, ".queue-button").click();
    button(composer, ".stop-button").click();

    expect(onSend).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
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

function requiredDraft(composer: PromptEditor) {
  const draft = composer.draft;
  if (draft === undefined) throw new Error("Expected draft");
  return draft;
}

function pressEnter(composer: PromptEditor): void {
  composer.view?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
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
