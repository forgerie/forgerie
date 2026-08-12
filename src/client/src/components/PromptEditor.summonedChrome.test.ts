// @vitest-environment happy-dom

import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../api";
import { isTemplateResult, templateText } from "../templateInspection.testSupport";
import { NEW_SESSION_LABEL } from "./shared";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities } from "./promptEditorTestSupport";

afterEach(() => {
  document.body.replaceChildren();
});

describe("PromptEditor summoned chrome", () => {
  it("carries the session's identity when no chrome band is left to show it", () => {
    const editor = summonedEditor();
    editor.capabilities = sessionCapabilities({ status: modelStatus(), sessionLabel: "forgerie · main" });

    expect(templateText(renderCompactStatus(editor))).toContain("forgerie · main");
  });

  it("keeps identity on the rail even where the shell still has bands", () => {
    const editor = summonedEditor();
    editor.chromeSummoned = false;
    editor.capabilities = sessionCapabilities({ status: modelStatus(), sessionLabel: "forgerie · main" });

    // Whether identity appears is the island's own width to decide (see
    // PromptEditor.reveal.test.ts); the composer does not key it off whether
    // the shell kept its chrome bands.
    expect(templateText(renderCompactStatus(editor))).toContain("forgerie · main");
  });

  it("keeps the icon-only New session action adjacent before the message action", async () => {
    const editor = summonedEditor();
    const onNewSession = vi.fn();
    editor.capabilities = { ...editor.capabilities, newSession: { onNewSession: onNewSession } };
    document.body.append(editor);
    await editor.updateComplete;

    const action = required(editor.shadowRoot?.querySelector<HTMLButtonElement>("[data-action='new-session']"), "New session action");
    const send = required(editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button"), "Send action");
    const actions = required(editor.shadowRoot?.querySelector<HTMLElement>(".actions"), "prompt actions");

    expect(action.title).toBe(NEW_SESSION_LABEL);
    expect(action.getAttribute("aria-label")).toBe(NEW_SESSION_LABEL);
    expect(action.textContent.trim()).toBe("");
    expect(action.querySelector("svg.new-session-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(action.parentElement).toBe(actions);
    expect(action.nextElementSibling?.classList.contains("primary-action")).toBe(true);
    expect(action.nextElementSibling?.contains(send)).toBe(true);

    action.click();
    expect(onNewSession).toHaveBeenCalledOnce();
  });
});

function summonedEditor(): PromptEditor {
  const editor = new PromptEditor();
  editor.status = modelStatus();
  editor.capabilities = sessionCapabilities({ status: modelStatus() });
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

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
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
