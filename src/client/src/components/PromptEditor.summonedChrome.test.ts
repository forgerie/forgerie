import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { isTemplateResult, templateClickHandlerForText, templateText } from "../templateInspection.testSupport";
import { PromptEditor } from "./PromptEditor";

describe("PromptEditor summoned chrome", () => {
  it("carries the session's identity when no chrome band is left to show it", () => {
    const editor = summonedEditor();
    editor.sessionLabel = "forgerie · main";

    expect(templateText(renderCompactStatus(editor))).toContain("forgerie · main");
  });

  it("keeps archive one tap away so the triage loop survives the header's removal", () => {
    const editor = summonedEditor();
    const onArchiveAndNext = vi.fn();
    editor.canArchive = true;
    editor.onArchiveAndNext = onArchiveAndNext;

    templateClickHandlerForText(renderCompactStatus(editor), "Archive")(new Event("click"));

    expect(onArchiveAndNext).toHaveBeenCalledOnce();
  });

  it("drops archive when the session cannot be archived", () => {
    const editor = summonedEditor();
    editor.canArchive = false;

    expect(templateText(renderCompactStatus(editor))).not.toContain("Archive");
  });

  it("keeps identity and archive on the rail even where the shell still has bands", () => {
    const editor = summonedEditor();
    editor.chromeSummoned = false;
    editor.sessionLabel = "forgerie · main";
    editor.canArchive = true;

    // Which of them the rail actually shows is the island's own width to
    // decide (see PromptEditor.reveal.test.ts); the composer no longer keys
    // them off whether the shell kept its chrome bands.
    const rendered = templateText(renderCompactStatus(editor));
    expect(rendered).toContain("forgerie · main");
    expect(rendered).toContain("Archive");
  });
});

function summonedEditor(): PromptEditor {
  const editor = new PromptEditor();
  editor.status = modelStatus();
  editor.chromeSummoned = true;
  return editor;
}

type RenderCompactStatus = (this: PromptEditor) => unknown;

function renderCompactStatus(editor: PromptEditor): TemplateResult {
  const method: unknown = Reflect.get(editor, "renderCompactStatus");
  if (!isRenderCompactStatus(method)) throw new Error("PromptEditor.renderCompactStatus is not callable");
  const rendered: unknown = method.call(editor);
  if (!isTemplateResult(rendered)) throw new Error("expected a compact status row");
  return rendered;
}

function isRenderCompactStatus(value: unknown): value is RenderCompactStatus {
  return typeof value === "function";
}

function modelStatus(): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    model: { id: "claude-opus-5", provider: "anthropic" },
  };
}
