import type { TemplateResult } from "lit";
import { describe, expect, it, vi } from "vitest";
import { isTemplateResult, templateClickHandlerForText, templateText } from "../templateInspection.testSupport";
import { PromptEditor } from "./PromptEditor";
import { promptEditorStyles } from "./shared";

describe("PromptEditor rail reveals", () => {
  it("carries identity and archive whatever the shell is doing with its bands", () => {
    const composer = editor();
    composer.chromeSummoned = false;

    const rendered = templateText(renderCompactStatus(composer));
    expect(rendered).toContain("forgerie · main");
    expect(rendered).toContain("Archive");
  });

  it("keeps archive off the rail on a session that cannot be archived", () => {
    const composer = editor();
    composer.canArchive = false;

    expect(templateText(renderCompactStatus(composer))).not.toContain("Archive");
  });

  it("still ends the turn from the rail when the island has room for it", () => {
    const composer = editor();
    const onArchiveAndNext = vi.fn();
    composer.onArchiveAndNext = onArchiveAndNext;

    templateClickHandlerForText(renderCompactStatus(composer), "Archive")(new Event("click"));

    expect(onArchiveAndNext).toHaveBeenCalledOnce();
  });

  it("keeps guidance resident and reveals identity and archive only after it", () => {
    const css = promptEditorStyles.cssText;

    expect(css).toMatch(/\.session-identity\s*{\s*display:\s*none/);
    expect(css).toMatch(/\.composer-archive\s*{\s*display:\s*none/);
    expect(css).toMatch(/\.compact-status\s*>\s*\.guidance-trigger\s*{[^}]*flex:\s*0 0 auto/);
    expect(css).toMatch(/@container \(min-width: 760px\)\s*{\s*\.session-identity/);
    expect(css).toMatch(/@container \(min-width: 920px\)\s*{\s*\.composer-archive/);
  });
});

function editor(): PromptEditor {
  const composer = new PromptEditor();
  composer.chromeSummoned = true;
  composer.sessionLabel = "forgerie · main";
  composer.canArchive = true;
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
