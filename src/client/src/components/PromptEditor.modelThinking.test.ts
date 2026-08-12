import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { isTemplateResult, templateClickHandlerForText, templateEventHandlerAfterValue, templateText } from "../templateInspection.testSupport";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities } from "./promptEditorTestSupport";

describe("PromptEditor model capsule", () => {
  it("reports the model and the thinking level as one control", () => {
    const rendered = templateText(renderCompactStatus(editor()));

    expect(rendered).toContain("openai-codex/gpt-5.6-sol");
    expect(rendered).toContain("Thinking level: high");
    expect(rendered).toContain("model-capsule");
  });

  it("routes the model half to the model picker", () => {
    const onSelectModel = vi.fn();
    const composer = editor({ onSelectModel });

    templateClickHandlerForText(renderCompactStatus(composer), "gpt-5.6-sol")(new Event("click"));

    expect(onSelectModel).toHaveBeenCalledOnce();
  });

  it("routes the thinking half to the thinking picker", () => {
    const onSelectThinking = vi.fn();
    const composer = editor({ onSelectThinking });

    templateEventHandlerAfterValue(renderCompactStatus(composer), "Thinking level: high", "@click")(new Event("click"));

    expect(onSelectThinking).toHaveBeenCalledOnce();
  });

  it("still names a session that has no model yet", () => {
    const withoutModel = status();
    delete withoutModel.model;
    const composer = editor();
    composer.capabilities = sessionCapabilities({ status: withoutModel, availableThinkingLevels: ["off", "low", "medium", "high"] });

    expect(templateText(renderCompactStatus(composer))).toContain("no model");
  });
});

function editor(options: { onSelectModel?: () => void; onSelectThinking?: () => void } = {}): PromptEditor {
  const composer = new PromptEditor();
  composer.status = status();
  composer.capabilities = sessionCapabilities({
    ...options,
    status: status(),
    availableThinkingLevels: ["off", "low", "medium", "high"],
  });
  return composer;
}

function renderCompactStatus(composer: PromptEditor): TemplateResult {
  const method: unknown = Reflect.get(composer, "renderCompactStatus");
  if (typeof method !== "function") throw new Error("PromptEditor.renderCompactStatus is not callable");
  const rendered: unknown = Reflect.apply(method, composer, []);
  if (!isTemplateResult(rendered)) throw new Error("expected a compact status row");
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
    thinkingLevel: "high",
    model: { id: "gpt-5.6-sol", provider: "openai-codex" },
  };
}
