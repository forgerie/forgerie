// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type SessionStatus } from "../api";
import type { AutocompleteMenu } from "./AutocompleteMenu";
import { PromptEditor } from "./PromptEditor";
import { sessionCapabilities } from "./promptEditorTestSupport";

afterEach(() => {
  document.body.replaceChildren();
});

describe("PromptEditor session guidance", () => {
  it("keeps the one-line summary visible for empty and active guidance", async () => {
    const editor = await mountEditor(status([]));
    expect(guidanceTrigger(editor).textContent.trim()).toBe("Guidance");

    // The host states which guidance is active; the composer does not read it
    // back out of a session status.
    editor.status = status(["technical-english"]);
    editor.capabilities = sessionCapabilities({ status: status(["technical-english"]) });
    await editor.updateComplete;

    expect(guidanceTrigger(editor).textContent.trim()).toBe("Technical English");
  });

  it("opens above the composer, clears completions, and keeps CodeMirror mounted", async () => {
    vi.spyOn(api, "commands").mockResolvedValue([{ name: "help", source: "builtin" }]);
    const editor = await mountEditor(status([]));
    editor.cwd = "/repo";
    await editor.updateComplete;
    const view = editor.view;
    setEditorText(editor, "/");
    const menu = autocompleteMenu(editor);
    if (menu === null || menu === undefined) throw new Error("Expected autocomplete menu");
    await vi.waitFor(() => { expect(menu.items).toHaveLength(1); });

    guidanceTrigger(editor).click();
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector("guidance-picker")).not.toBeNull();
    expect(menu.items).toEqual([]);
    expect(editor.view).toBe(view);
  });

  it("blocks send and duplicate selection while pending but leaves stop available", async () => {
    const request = deferred<boolean>();
    const calls: { entryId: string; enabled: boolean }[] = [];
    const onSend = vi.fn();
    const editor = await mountEditor(status([]));
    editor.capabilities = { ...editor.capabilities, stop: { stoppable: true, onStop: () => undefined } };
    editor.onSend = onSend;
    setGuidanceHandler(editor, (entryId: string, enabled: boolean) => {
      calls.push({ entryId, enabled });
      return request.promise;
    });
    await editor.updateComplete;

    guidanceTrigger(editor).click();
    await editor.updateComplete;
    guidanceOption(editor).click();
    await editor.updateComplete;
    guidanceOption(editor).click();

    expect(calls).toEqual([{ entryId: "technical-english", enabled: true }]);
    expect(required(editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button")).disabled).toBe(true);
    expect(required(editor.shadowRoot?.querySelector<HTMLButtonElement>(".stop-button")).disabled).toBe(false);

    editor.replaceText("do not send yet");
    editor.view?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSend).not.toHaveBeenCalled();

    request.resolve(true);
    await request.promise;
    await Promise.resolve();
    await editor.updateComplete;

    expect(editor.shadowRoot?.querySelector("guidance-picker")).toBeNull();
    expect(editor.shadowRoot?.activeElement).toBe(guidanceTrigger(editor));
  });

  it("keeps the picker open with a retry message after failure", async () => {
    const editor = await mountEditor(status([]));
    setGuidanceHandler(editor, () => Promise.resolve(false));

    guidanceTrigger(editor).click();
    await editor.updateComplete;
    guidanceOption(editor).click();
    await Promise.resolve();
    await editor.updateComplete;

    const picker = required(editor.shadowRoot?.querySelector<HTMLElement>("guidance-picker"));
    expect(picker.shadowRoot?.textContent).toContain("Could not update guidance. Try again.");
  });

  it("closes on Escape, runtime loss, and session changes", async () => {
    const editor = await mountEditor(status([]));
    guidanceTrigger(editor).click();
    await editor.updateComplete;

    guidanceOption(editor).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector("guidance-picker")).toBeNull();
    expect(editor.shadowRoot?.activeElement).toBe(guidanceTrigger(editor));

    guidanceTrigger(editor).click();
    await editor.updateComplete;
    editor.runtimeControlsAvailable = false;
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector("guidance-picker")).toBeNull();

    editor.runtimeControlsAvailable = true;
    editor.sessionId = "session-2";
    await editor.updateComplete;
    guidanceTrigger(editor).click();
    await editor.updateComplete;
    editor.sessionId = "session-3";
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector("guidance-picker")).toBeNull();
  });

  it("explains next-turn timing while working and makes archived guidance read-only", async () => {
    const editor = await mountEditor(status(["technical-english"]));
    editor.canSteer = true;
    guidanceTrigger(editor).click();
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector<HTMLElement>("guidance-picker")?.shadowRoot?.textContent).toContain("Changes apply to the next turn.");

    editor.disabled = true;
    editor.canSteer = false;
    await editor.updateComplete;
    expect(guidanceOption(editor).disabled).toBe(true);
    expect(editor.shadowRoot?.querySelector<HTMLElement>("guidance-picker")?.shadowRoot?.textContent).toContain("Restore this session to change guidance.");
  });

  it("ignores token-only status churn but renders changed guidance contents", async () => {
    const initial = status([]);
    const editor = await mountEditor(initial);
    const render = vi.spyOn(editor, "render");

    editor.status = { ...initial, cost: 2, tokens: { ...initial.tokens, output: 10, total: 10 } };
    await editor.updateComplete;
    expect(render).not.toHaveBeenCalled();

    editor.status = { ...initial, activeGuidanceIds: ["technical-english"] };
    await editor.updateComplete;
    expect(render).toHaveBeenCalledOnce();
  });

  it("keeps open selection state synchronized with live status updates", async () => {
    const editor = await mountEditor(status([]));
    guidanceTrigger(editor).click();
    await editor.updateComplete;

    // The host states which guidance is active; the composer does not read it
    // back out of a session status.
    editor.status = status(["technical-english"]);
    editor.capabilities = sessionCapabilities({ status: status(["technical-english"]) });
    await editor.updateComplete;

    expect(guidanceOption(editor).getAttribute("aria-pressed")).toBe("true");
    expect(editor.shadowRoot?.querySelector("guidance-picker")).not.toBeNull();
  });
});

function setGuidanceHandler(editor: PromptEditor, onSet: (entryId: string, enabled: boolean) => Promise<boolean>): void {
  editor.capabilities = { ...editor.capabilities, guidance: { activeIds: editor.status?.activeGuidanceIds ?? [], onSet } };
}

async function mountEditor(currentStatus: SessionStatus): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.sessionId = currentStatus.sessionId;
  editor.status = currentStatus;
  editor.capabilities = sessionCapabilities({ status: currentStatus });
  document.body.append(editor);
  await editor.updateComplete;
  return editor;
}

function guidanceTrigger(editor: PromptEditor): HTMLButtonElement {
  return required(editor.shadowRoot?.querySelector<HTMLButtonElement>(".guidance-trigger"));
}

function guidanceOption(editor: PromptEditor): HTMLButtonElement {
  const picker = required(editor.shadowRoot?.querySelector<HTMLElement>("guidance-picker"));
  return required(picker.shadowRoot?.querySelector<HTMLButtonElement>("[data-guidance-id='technical-english']"));
}

function autocompleteMenu(editor: PromptEditor): AutocompleteMenu | null | undefined {
  return editor.shadowRoot?.querySelector("composer-draft")?.querySelector<AutocompleteMenu>("autocomplete-menu");
}

function setEditorText(editor: PromptEditor, text: string): void {
  const view = editor.view;
  if (view === undefined) throw new Error("Expected CodeMirror to mount");
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
}

function status(activeGuidanceIds: string[]): SessionStatus {
  return {
    sessionId: "session-1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    activeGuidanceIds,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    model: { id: "claude-opus-5", provider: "anthropic" },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected guidance control");
  return value;
}
