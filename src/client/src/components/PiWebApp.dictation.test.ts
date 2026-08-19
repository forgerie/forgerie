// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, SessionStatus, Workspace } from "../api";
import type { ComposerDictationCapability } from "../composerCapabilities";
import { initialAppState } from "../appState";
import type { SpeechCaptureSession } from "../speechCapture";
import { PiWebApp } from "./PiWebApp";
import type { PromptEditor } from "./PromptEditor";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

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

describe("PiWebApp composer dictation capability", () => {
  it("declares real speech dependencies for the selected session composer", async () => {
    const app = new PiWebApp();
    Reflect.set(app, "state", {
      ...initialAppState(),
      selectedSession: session("session-1"),
      sessions: [session("session-1")],
      selectedWorkspace: workspace(),
      status: status(),
      sessionStatuses: { "session-1": status() },
      mainView: "chat",
    });
    document.body.append(app);
    await app.updateComplete;
    await app.updateComplete;

    const editor = promptEditor(app);
    expect(hasDictationDependencies(editor.capabilities.dictation)).toBe(true);
    expect(editor.shadowRoot?.querySelector(".dictation-button")).not.toBeNull();
  });

  it("keeps one dictation capability and active controller across unrelated parent rerenders", async () => {
    const app = new PiWebApp();
    Reflect.set(app, "state", {
      ...initialAppState(),
      selectedSession: session("session-1"),
      sessions: [session("session-1")],
      selectedWorkspace: workspace(),
      status: status(),
      sessionStatuses: { "session-1": status() },
      mainView: "chat",
    });
    const capture = deferred<SpeechCaptureSession>();
    let captureCalls = 0;
    let abortCalls = 0;
    const capability: ComposerDictationCapability = {
      getStatus: () => Promise.resolve({
        smartTurn: "ready",
        whisper: "ready",
        capability: "ready",
        limits: { sampleRateHz: 16_000, maxTurnSeconds: 60, maxTurnBytes: 3_840_000, endpointWindowSeconds: 8, endpointWindowBytes: 512_000 },
      }),
      createCaptureSession: () => {
        captureCalls += 1;
        return capture.promise;
      },
      speechApi: {
        checkTurn: () => new Promise(() => undefined),
        transcribe: () => new Promise(() => undefined),
      },
    };
    Reflect.set(app, "sessionDictationCapabilityValue", capability);
    document.body.append(app);
    await app.updateComplete;
    await app.updateComplete;

    const editor = promptEditor(app);
    pointer(requiredMic(editor), "pointerdown");
    await editor.updateComplete;
    app.requestUpdate();
    await app.updateComplete;
    await editor.updateComplete;

    expect(promptEditor(app).capabilities.dictation).toBe(capability);
    expect(promptEditor(app).capabilities.dictation?.speechApi).toBe(capability.speechApi);
    expect(captureCalls).toBe(1);
    expect(requiredMic(promptEditor(app)).getAttribute("aria-pressed")).toBe("true");

    capture.resolve({
      actualSampleRateHz: 16_000,
      failure: undefined,
      endpointWindow: () => new Float32Array(),
      finalize: () => new Float32Array(),
      stopAndFinalize: () => new Promise(() => undefined),
      abort: () => { abortCalls += 1; return Promise.resolve(); },
    });
    await editor.updateComplete;
    expect(abortCalls).toBe(0);
  });

  it("declares dictation for opening-session and new-session composers", async () => {
    const app = new PiWebApp();
    const target = session("opening");
    Reflect.set(app, "state", {
      ...initialAppState(),
      selectedSession: session("previous"),
      sessions: [session("previous"), target],
      inboxSessions: [target],
      mainView: "chat",
    });
    Reflect.set(app, "chatNavigationIntent", { kind: "opening", seq: 1, machineId: "local", session: target });
    document.body.append(app);
    await app.updateComplete;

    expect(promptEditor(app).capabilities.dictation).not.toBeUndefined();

    Reflect.set(app, "chatNavigationIntent", { kind: "none" });
    Reflect.set(app, "state", { ...initialAppState(), newSessionComposer: { kind: "open" }, mainView: "chat" });
    app.requestUpdate();
    await app.updateComplete;
    await app.updateComplete;

    const newSessionEditor = app.shadowRoot?.querySelector("new-session-composer")?.shadowRoot?.querySelector<PromptEditor>("prompt-editor");
    expect(newSessionEditor?.capabilities.dictation).not.toBeUndefined();
    expect(newSessionEditor?.shadowRoot?.querySelector(".dictation-button")).not.toBeNull();
  });
});

function hasDictationDependencies(value: PromptEditor["capabilities"]["dictation"]): boolean {
  if (value === undefined) return false;
  return typeof value.getStatus === "function"
    && typeof value.createCaptureSession === "function"
    && typeof value.speechApi.checkTurn === "function"
    && typeof value.speechApi.transcribe === "function";
}

function requiredMic(editor: PromptEditor): HTMLButtonElement {
  const button = editor.shadowRoot?.querySelector(".dictation-button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("Expected microphone button");
  return button;
}

function pointer(target: HTMLElement, type: string, pointerId = 1): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: pointerId }, button: { value: 0 } });
  target.dispatchEvent(event);
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function promptEditor(app: PiWebApp): PromptEditor {
  const editor = app.shadowRoot?.querySelector<PromptEditor>("prompt-editor");
  if (editor === undefined || editor === null) throw new Error("Expected prompt editor");
  return editor;
}

function session(id: string): SessionInfo {
  return {
    id,
    path: `/tmp/${id}.jsonl`,
    cwd: "/repo",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 0,
    firstMessage: id,
  };
}

function workspace(): Workspace {
  return { id: "workspace-1", projectId: "project-1", path: "/repo", label: "repo", isMain: true, isGitRepo: true, isGitWorktree: false, effectiveConfig: {} };
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
  };
}
