// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState } from "../appState";
import type { ComposerDictationCapability } from "../composerCapabilities";
import type { PluginRuntimeContext } from "../plugins/types";
import { PiWebApp } from "./PiWebApp";
import type { PromptEditor } from "./PromptEditor";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }))));
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp plugin prompt editor during dictation", () => {
  it("routes plugin prompt insert and focus through the lock-aware PromptEditor public contract", async () => {
    const app = new PiWebApp();
    Reflect.set(app, "state", { ...initialAppState(), selectedSession: session(), sessions: [session()], mainView: "chat" });
    document.body.append(app);
    await app.updateComplete;
    await app.updateComplete;
    const editor = promptEditor(app);
    editor.capabilities = { dictation: fakeDictationCapability() };
    editor.replaceText("locked");
    await editor.updateComplete;

    editor.shadowRoot?.querySelector<HTMLButtonElement>(".dictation-button")?.dispatchEvent(pointer("pointerdown"));
    await editor.updateComplete;

    const context = pluginRuntimeContext(app);
    context.prompt.insertText(" plugin");
    expect(context.prompt.getText()).toBe("locked");
    context.focusPrompt();
    await app.updateComplete;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => { resolve(); });
    });
    await app.updateComplete;

    expect(context.prompt.getText()).toBe("locked");
    expect(document.activeElement?.localName).not.toBe("prompt-editor");
  });
});

function fakeDictationCapability(): ComposerDictationCapability {
  return {
    getStatus: () => Promise.resolve({
      smartTurn: "ready",
      whisper: "ready",
      capability: "ready",
      limits: { sampleRateHz: 16_000, maxTurnSeconds: 60, maxTurnBytes: 3_840_000, endpointWindowSeconds: 8, endpointWindowBytes: 512_000 },
    }),
    createCaptureSession: () => new Promise(() => undefined),
    speechApi: {
      checkTurn: () => Promise.resolve({ complete: false, probability: 0, samples: 0 }),
      transcribe: () => Promise.resolve({ text: "" }),
    },
  };
}

function promptEditor(app: PiWebApp): PromptEditor {
  const editor = app.shadowRoot?.querySelector<PromptEditor>("prompt-editor");
  if (editor === undefined || editor === null) throw new Error("Expected prompt editor");
  return editor;
}

function pluginRuntimeContext(app: PiWebApp): PluginRuntimeContext {
  const createContext: unknown = Reflect.get(app, "createPluginRuntimeContext");
  if (typeof createContext !== "function") throw new Error("Expected plugin runtime context factory");
  const context: unknown = createContext.call(app);
  if (!isPluginRuntimeContext(context)) throw new Error("Expected plugin runtime context");
  return context;
}

function isPluginRuntimeContext(value: unknown): value is PluginRuntimeContext {
  return typeof value === "object" && value !== null && "prompt" in value && "focusPrompt" in value;
}

function pointer(type: string): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 } });
  return event;
}

function session(): SessionInfo {
  return {
    id: "session-1",
    path: "/tmp/session-1.jsonl",
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: "session",
  };
}
