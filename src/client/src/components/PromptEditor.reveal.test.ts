import type { TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { isTemplateResult, templateText } from "../templateInspection.testSupport";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities } from "./promptEditorTestSupport";
import { promptEditorStyles } from "./shared";

describe("PromptEditor rail reveals", () => {
  it("carries identity whatever the shell is doing with its bands", () => {
    const composer = editor();
    composer.chromeSummoned = false;

    expect(templateText(renderCompactStatus(composer))).toContain("forgerie · main");
  });

  it("keeps every action an icon, and spends the width on the model name", () => {
    const css = promptEditorStyles.cssText;

    expect(css).toMatch(/\.session-identity\s*{\s*display:\s*none/);
    expect(css).not.toMatch(/\.composer-archive\s*{\s*display:\s*none/);
    // An action never states itself in words, so no label or level survives.
    expect(css).not.toContain(".composer-archive-label");
    expect(css).not.toContain(".thinking-level");
    expect(css).toMatch(/\.compact-status\s*>\s*\.guidance-trigger\s*{[^}]*flex:\s*0 0 auto/);
    expect(css).toMatch(/@container \(min-width: 560px\)\s*{\s*\.session-identity/);
    expect(css).toMatch(/\.select-model\s*{[^}]*box-sizing:\s*border-box;[^}]*height:\s*36px;/);
    expect(css).toMatch(/\.select-model\s*{[^}]*max-width:\s*min\(64cqi, 460px\)/);
  });
});

function editor(): PromptEditor {
  const composer = new PromptEditor();
  composer.chromeSummoned = true;
  composer.capabilities = sessionCapabilities({ sessionLabel: "forgerie · main", onArchiveAndNext: () => undefined });
  composer.status = {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    activeGuidanceIds: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    model: { id: "gpt-5.6-sol", provider: "openai-codex" },
  };
  return composer;
}

function renderCompactStatus(composer: PromptEditor): TemplateResult {
  const method: unknown = Reflect.get(composer, "renderCompactStatus");
  if (typeof method !== "function") throw new Error("PromptEditor.renderCompactStatus is not callable");
  const rendered: unknown = Reflect.apply(method, composer, []);
  if (!isTemplateResult(rendered)) throw new Error("expected a compact status row");
  return rendered;
}
