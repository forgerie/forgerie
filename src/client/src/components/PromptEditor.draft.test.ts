// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { machineSessionKey } from "../machineKeys";
import { loadDraft, saveDraft } from "../promptDraftStorage";
import { PromptEditor } from "./PromptEditor";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

afterEach(() => {
  document.body.replaceChildren();
  Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
});

describe("PromptEditor draft replacement", () => {
  it("delegates replacement to the shared draft while preserving durable and CodeMirror text", async () => {
    const editor = await mountEditor("remote-a", "session-1");

    editor.replaceText("!pwd");

    expect(editor.view?.state.doc.toString()).toBe("!pwd");
    expect(editor.view?.state.selection.main.head).toBe(4);
    expect(loadDraft(machineSessionKey("remote-a", "session-1"))).toBe("!pwd");
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector("composer-draft")?.textContent).toContain("Shell command");
  });

  it("accepts replacement before the shared draft is mounted", async () => {
    const editor = new PromptEditor();
    editor.machineId = "local";
    editor.sessionId = "session-early";

    editor.replaceText("seed before mount");
    document.body.append(editor);
    await editor.updateComplete;

    expect(editor.view?.state.doc.toString()).toBe("seed before mount");
    expect(loadDraft(machineSessionKey("local", "session-early"))).toBe("seed before mount");
  });

  it("clears an existing durable draft and CodeMirror document", async () => {
    const key = machineSessionKey("local", "session-2");
    saveDraft(key, "stale text");
    const editor = await mountEditor("local", "session-2");
    expect(editor.view?.state.doc.toString()).toBe("stale text");

    editor.replaceText("");

    expect(loadDraft(key)).toBe("");
    expect(editor.view?.state.doc.toString()).toBe("");
    expect(editor.view?.state.selection.main.head).toBe(0);
  });
});

async function mountEditor(machineId: string, sessionId: string): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.machineId = machineId;
  editor.sessionId = sessionId;
  document.body.append(editor);
  await editor.updateComplete;
  if (editor.view === undefined) throw new Error("Expected CodeMirror to mount");
  return editor;
}
