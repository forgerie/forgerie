// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import { initialAppState } from "../appState";
import type { ComposerDictationCapability } from "../composerCapabilities";
import { selectedChatLiveReady, selectedChatTarget } from "../selectedChatLoad";
import { PiWebApp } from "./PiWebApp";
import type { PromptEditor } from "./PromptEditor";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ capability: "ready", smartTurn: "ready", whisper: "ready", limits: { sampleRateHz: 16_000, maxTurnSeconds: 60, maxTurnBytes: 3_840_000, endpointWindowSeconds: 8, endpointWindowBytes: 512_000 } }), { status: 200, headers: { "content-type": "application/json" } }))));
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PiWebApp voice composer shortcut", () => {
  it("opens the voice composer from the chat composer before CodeMirror sees Ctrl+Alt+Enter", async () => {
    const app = await mountChat();
    const editor = promptEditor(app);
    const content = editor.view?.contentDOM;
    if (content === undefined) throw new Error("Expected composer CodeMirror content");
    const editorKeyDown = vi.fn();
    content.addEventListener("keydown", editorKeyDown);

    const event = dispatchSpeakKey(content);
    await app.updateComplete;

    expect(event.defaultPrevented).toBe(true);
    expect(editorKeyDown).not.toHaveBeenCalled();
    expect(editor.view?.state.doc.toString()).toBe("");
    expect(app.shadowRoot?.querySelector("voice-composer-dialog")).not.toBeNull();
  });

  it("opens the voice composer from a terminal, which owns its own keys", async () => {
    const app = await mountChat();
    const terminal = document.createElement("div");
    terminal.setAttribute("data-keyboard-shortcut-context", "terminal");
    document.body.append(terminal);

    const event = dispatchSpeakKey(terminal);
    await app.updateComplete;

    expect(event.defaultPrevented).toBe(true);
    expect(app.shadowRoot?.querySelector("voice-composer-dialog")).not.toBeNull();
  });

  it("leaves Ctrl+Alt+Enter to the page when there is no session to speak to", async () => {
    const app = new PiWebApp();
    Reflect.set(app, "state", initialAppState());
    Reflect.set(app, "sessionDictationCapabilityValue", inertDictationCapability());
    document.body.append(app);
    await app.updateComplete;
    const target = document.createElement("button");
    document.body.append(target);

    const event = dispatchSpeakKey(target);
    await app.updateComplete;

    expect(event.defaultPrevented).toBe(false);
    expect(app.shadowRoot?.querySelector("voice-composer-dialog")).toBeNull();
  });
});

async function mountChat(): Promise<PiWebApp> {
  const app = new PiWebApp();
  const selectedSession = session("session-speak");
  Reflect.set(app, "state", {
    ...initialAppState(),
    selectedSession,
    sessions: [selectedSession],
    selectedChatLoad: selectedChatLiveReady(selectedChatTarget("local", selectedSession)),
    mainView: "chat",
  });
  Reflect.set(app, "sessionDictationCapabilityValue", inertDictationCapability());
  document.body.append(app);
  await app.updateComplete;
  await app.updateComplete;
  return app;
}

/**
 * A microphone that never answers.
 *
 * The dialog opens already listening, so a capability that resolves would run
 * a real capture during a keyboard test. Pending promises leave the dialog in
 * the one state this file is about: on screen, having been asked for.
 */
function inertDictationCapability(): ComposerDictationCapability {
  return {
    getStatus: () => new Promise(() => undefined),
    createCaptureSession: () => new Promise(() => undefined),
    speechApi: {
      checkTurn: () => new Promise(() => undefined),
      transcribe: () => new Promise(() => undefined),
    },
  };
}

/**
 * Ctrl+Alt+Enter as a browser reports it from a left Alt press.
 *
 * happy-dom answers `getModifierState("AltGraph")` from `altKey`, which a real
 * browser only does when AltGr was the key. Forgerie drops Ctrl+Alt chords
 * that carry AltGraph so international text input is never read as a shortcut,
 * so the harness value has to be corrected or every Ctrl+Alt binding would
 * look broken here and work on the device.
 */
function dispatchSpeakKey(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "getModifierState", {
    configurable: true,
    value: (modifier: string) => modifier === "Control" || modifier === "Alt",
  });
  target.dispatchEvent(event);
  return event;
}

function promptEditor(app: PiWebApp): PromptEditor {
  const editor = app.shadowRoot?.querySelector<PromptEditor>("prompt-editor");
  if (editor === null || editor === undefined) throw new Error("Expected prompt editor");
  return editor;
}

function session(id: string): SessionInfo {
  return {
    id,
    path: `/repo/${id}.jsonl`,
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: id,
  };
}
