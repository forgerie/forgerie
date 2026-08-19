// @vitest-environment happy-dom

import { EditorSelection } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechApiError } from "../api/speech";
import type { SpeechServiceStatusResponse } from "../../../shared/speechContracts";
import type { ComposerDictationCapability } from "../composerCapabilities";
import type { PromptDictationCaptureOptions } from "../controllers/promptDictationController";
import type { SpeechCaptureSession } from "../speechCapture";
import { SPEECH_POLICY } from "../../../shared/speechPolicy";
import { PromptEditor } from "./PromptEditor";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

beforeEach(() => {
  vi.useFakeTimers();
  if (!("PointerEvent" in window)) {
    vi.stubGlobal("PointerEvent", Event);
  }
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: vi.fn(() => true) });
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PromptEditor local dictation", () => {
  it("does not start dictation status work after removal before the first update", async () => {
    const dictation = fakeDictation();
    const editor = new PromptEditor();
    editor.capabilities = { dictation: dictation.capability };

    document.body.append(editor);
    editor.remove();
    await editor.updateComplete;
    await Promise.resolve();

    expect(dictation.statusCalls).toBe(0);
  });

  it("renders one persistent microphone with accessible privacy and status text outside the visible rail", async () => {
    const without = await mount();
    expect(mic(without)).toBeNull();
    without.remove();

    const editor = await mount({ dictation: fakeDictation().capability });
    const button = requiredMic(editor);
    const status = editor.shadowRoot?.querySelector(".dictation-status");
    expect(editor.shadowRoot?.querySelectorAll(".dictation-button")).toHaveLength(1);
    expect(button.getAttribute("aria-describedby")).toContain("composer-dictation-privacy");
    expect(button.getAttribute("aria-describedby")).toContain("composer-dictation-status");
    expect(editor.shadowRoot?.textContent).toContain("Audio goes to this Forgerie gateway");
    expect(editor.shadowRoot?.textContent).toContain("not to the selected machine");
    expect(status?.classList.contains("dictation-privacy")).toBe(true);
    expect(statusText(editor)).toContain("This gateway, not the selected machine · raw audio not stored.");
  });

  it("covers tap auto-completion: pointerdown/up captures, transcribes, replaces the selected draft, and never sends", async () => {
    const dictation = fakeDictation();
    const onSend = vi.fn();
    const editor = await mount({ dictation: dictation.capability, onSend });
    editor.replaceText("Ask old text today");
    await editor.updateComplete;
    selectText(editor, 4, 12);

    pointer(requiredMic(editor), "pointerdown");
    await editor.updateComplete;
    expect(requiredMic(editor).getAttribute("aria-pressed")).toBe("true");
    expect(sendButton(editor).disabled).toBe(true);
    expect(attachButton(editor).disabled).toBe(true);

    pointer(requiredMic(editor), "pointerup");
    requiredMic(editor).click();
    dictation.captureReady();
    await settle(editor);
    expect(statusText(editor)).toContain("Listening");

    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.1, 0.2]));
    await settle(editor);
    expect(statusText(editor)).toContain("Checking");
    dictation.resolveCheck({ complete: true, probability: 0.9, samples: 2 });
    await settle(editor);
    await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.3, 0.4, 0.5]));
    await settle(editor);
    dictation.resolveTranscribe({ text: "local speech" });
    await settle(editor);

    expect(editor.getText()).toBe("Ask local speech today");
    expect(dictation.captureCalls).toBe(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(requiredMic(editor).getAttribute("aria-pressed")).toBe("false");
    expect(statusText(editor)).toContain("ready");
  });

  it("keeps listening after an incomplete Smart Turn check and completes on a later pause", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });

    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    pointer(requiredMic(editor), "pointerup");
    await settle(editor);

    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.1]));
    await settle(editor);
    expect(statusText(editor)).toContain("Checking");
    dictation.resolveCheck({ complete: false, probability: 0.2, samples: 1 });
    await settle(editor);
    expect(statusText(editor)).toContain("Listening");

    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.2]));
    await settle(editor);
    expect(dictation.checkCalls).toBe(2);
    dictation.resolveCheck({ complete: true, probability: 0.95, samples: 1 });
    await settle(editor);
    await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.4]));
    await settle(editor);
    dictation.resolveTranscribe({ text: "later complete" });
    await settle(editor);

    expect(editor.getText()).toBe("later complete");
    expect(statusText(editor)).toContain("ready");
  });

  it("shows an empty transcription state and lets the microphone start a fresh turn", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });

    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    pointer(requiredMic(editor), "pointerup");
    await settle(editor);
    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.1]));
    dictation.resolveCheck({ complete: true, probability: 0.9, samples: 1 });
    await settle(editor);
    await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.3]));
    await settle(editor);
    dictation.resolveTranscribe({ text: "   " });
    await settle(editor);

    expect(statusText(editor)).toContain("No speech was transcribed");
    expect(requiredMic(editor).disabled).toBe(false);

    pointer(requiredMic(editor), "pointerdown", 7);
    dictation.captureReady();
    pointer(requiredMic(editor), "pointerup", 7);
    await settle(editor);
    expect(dictation.captureCalls).toBe(2);
    expect(statusText(editor)).toContain("Listening");
  });

  it("distinguishes hold, suppresses endpoint completion, and transcribes only on release", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });

    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    await settle(editor);
    await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.holdThresholdMs);
    await editor.updateComplete;
    expect(statusText(editor)).toContain("Holding");

    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.1]));
    await settle(editor);
    expect(dictation.checkCalls).toBe(0);

    pointer(requiredMic(editor), "pointerup");
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.6]));
    await settle(editor);
    dictation.resolveTranscribe({ text: "held turn" });
    await settle(editor);
    expect(editor.getText()).toBe("held turn");
  });

  it("starts idle dictation from Enter and programmatic button activation as short taps", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });
    const button = requiredMic(editor);

    key(button, "keydown", "Enter");
    button.click();
    dictation.captureReady();
    await settle(editor);
    expect(dictation.captureCalls).toBe(1);
    expect(statusText(editor)).toContain("Listening");

    key(button, "keydown", "Enter");
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.4]));
    await settle(editor);
    dictation.resolveTranscribe({ text: "enter turn" });
    await settle(editor);
    expect(editor.getText()).toBe("enter turn");

    button.click();
    dictation.captureReady();
    await settle(editor);
    expect(dictation.captureCalls).toBe(2);
    expect(statusText(editor)).toContain("Listening");
  });

  it("ignores delayed pointer compatibility clicks and keeps Space activation singular", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });
    const button = requiredMic(editor);

    pointer(button, "pointerdown", 21);
    pointer(button, "pointerup", 21);
    await vi.advanceTimersByTimeAsync(1);
    compatibilityClick(button);
    dictation.captureReady();
    await settle(editor);
    expect(dictation.captureCalls).toBe(1);
    expect(statusText(editor)).toContain("Listening");

    key(button, "keydown", "Enter");
    dictation.resolveStop(new Float32Array([0.7]));
    await settle(editor);
    dictation.resolveTranscribe({ text: "first turn" });
    await settle(editor);

    key(button, "keydown", " ");
    key(button, "keyup", " ");
    dictation.captureReady();
    await settle(editor);
    expect(dictation.captureCalls).toBe(2);
    expect(statusText(editor)).toContain("Listening");
  });

  it("supports keyboard parity, repeat suppression, manual-only readiness, Escape abort, and pointercancel", async () => {
    const dictation = fakeDictation({ capability: "manual-only", smartTurn: "unavailable", whisper: "ready" });
    const editor = await mount({ dictation: dictation.capability });
    const button = requiredMic(editor);
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-label")).toContain("manual");

    key(button, "keydown", " ");
    key(button, "keydown", " ", { repeat: true });
    dictation.captureReady();
    key(button, "keyup", " ");
    await settle(editor);
    expect(dictation.captureCalls).toBe(1);
    expect(statusText(editor)).toContain("Automatic completion unavailable");
    expect(statusText(editor)).toContain("Smart Turn unavailable");

    key(button, "keydown", "Enter");
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.7]));
    await settle(editor);
    dictation.resolveTranscribe({ text: "manual done" });
    await settle(editor);
    expect(editor.getText()).toBe("manual done");

    pointer(button, "pointerdown", 2);
    dictation.captureReady();
    await settle(editor);
    pointer(button, "pointercancel", 2);
    await settle(editor);
    expect(dictation.abortCalls).toBe(1);

    pointer(button, "pointerdown", 3);
    dictation.captureReady();
    await settle(editor);
    key(button, "keydown", "Escape");
    await settle(editor);
    expect(dictation.abortCalls).toBe(2);
  });

  it("cancels and clears latches on lost capture and page-owned background events", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });
    const button = requiredMic(editor);

    pointer(button, "pointerdown", 11);
    dictation.captureReady();
    await settle(editor);
    pointer(button, "lostpointercapture", 11);
    await settle(editor);
    expect(dictation.abortCalls).toBe(1);

    pointer(button, "pointerdown", 12);
    dictation.captureReady();
    await settle(editor);
    window.dispatchEvent(new Event("pagehide"));
    await settle(editor);
    expect(dictation.abortCalls).toBe(2);

    pointer(button, "pointerdown", 13);
    dictation.captureReady();
    await settle(editor);
    expect(dictation.captureCalls).toBe(3);
    pointer(button, "pointercancel", 13);
    await settle(editor);

    key(button, "keydown", " ");
    dictation.captureReady();
    await settle(editor);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle(editor);
    expect(dictation.abortCalls).toBe(4);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    key(button, "keydown", " ");
    dictation.captureReady();
    key(button, "keyup", " ");
    await settle(editor);
    expect(dictation.captureCalls).toBe(5);
  });

  it("exposes retained-audio retry and discard actions for retryable transcription failures", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });
    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    pointer(requiredMic(editor), "pointerup");
    await settle(editor);
    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.1]));
    dictation.resolveCheck({ complete: true, probability: 0.9, samples: 1 });
    await settle(editor);
    await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.8]));
    await settle(editor);
    dictation.rejectTranscribe(new SpeechApiError("overloaded", "busy", { retryable: true }));
    await settle(editor);

    expect(editor.shadowRoot?.querySelector(".dictation-retry")).toBeNull();
    expect(statusText(editor)).toContain("Press the microphone to retry retained audio");
    dictation.nextTranscription();
    pointer(requiredMic(editor), "pointerdown", 6);
    pointer(requiredMic(editor), "pointerup", 6);
    dictation.resolveTranscribe({ text: "retried text" });
    await settle(editor);
    expect(editor.getText()).toBe("retried text");

    pointer(requiredMic(editor), "pointerdown", 4);
    dictation.captureReady();
    pointer(requiredMic(editor), "pointerup", 4);
    await settle(editor);
    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.2]));
    dictation.resolveCheck({ complete: true, probability: 0.9, samples: 1 });
    await settle(editor);
    await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.9]));
    await settle(editor);
    dictation.rejectTranscribe(new SpeechApiError("timeout", "timeout", { retryable: true }));
    await settle(editor);
    discardButton(editor).click();
    await settle(editor);
    expect(editor.shadowRoot?.querySelector(".dictation-retry")).toBeNull();
  });

  it("does not let a delayed non-ready status poll abort the active turn", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });
    const delayedStatus = dictation.deferNextStatus();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dictation.statusCalls).toBe(2);

    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    pointer(requiredMic(editor), "pointerup");
    await settle(editor);
    expect(statusText(editor)).toContain("Listening");

    delayedStatus.resolve(speechStatus({ capability: "warming", smartTurn: "warming" }));
    await settle(editor);
    expect(dictation.abortCalls).toBe(0);
    expect(statusText(editor)).toContain("Listening");

    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.1]));
    dictation.resolveCheck({ complete: true, probability: 0.9, samples: 1 });
    await settle(editor);
    await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.endpointCompletionGraceMs);
    await settle(editor);
    dictation.resolveStop(new Float32Array([0.5]));
    await settle(editor);
    dictation.resolveTranscribe({ text: "kept turn" });
    await settle(editor);

    expect(editor.getText()).toBe("kept turn");
    expect(statusText(editor)).toContain("warming");
  });

  it("aborts owner replacement and ignores late callbacks for the previous session", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });
    editor.replaceText("old draft");
    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    pointer(requiredMic(editor), "pointerup");
    await settle(editor);

    editor.sessionId = "session-2";
    await settle(editor);
    expect(editor.replaceText("new draft")).toBe(true);
    await settle(editor);
    expect(dictation.abortCalls).toBe(1);

    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.1]));
    dictation.resolveCheck({ complete: true, probability: 0.9, samples: 1 });
    dictation.resolveStop(new Float32Array([0.8]));
    dictation.resolveTranscribe({ text: "late text" });
    await settle(editor);

    expect(editor.getText()).toBe("new draft");
    expect(statusText(editor)).toContain("ready");
  });

  it("aborts active capture when runtime controls disconnect and ignores late speech results", async () => {
    const dictation = fakeDictation();
    const editor = await mount({ dictation: dictation.capability });
    editor.replaceText("kept draft");
    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    pointer(requiredMic(editor), "pointerup");
    await settle(editor);
    expect(statusText(editor)).toContain("Listening");

    editor.runtimeControlsAvailable = false;
    await settle(editor);
    expect(dictation.abortCalls).toBe(1);
    expect(editor.replaceText("new editable draft")).toBe(true);
    await settle(editor);

    dictation.emitSpeech();
    dictation.emitPause(new Float32Array([0.1]));
    dictation.resolveCheck({ complete: true, probability: 0.9, samples: 1 });
    dictation.resolveStop(new Float32Array([0.8]));
    dictation.resolveTranscribe({ text: "late disconnected text" });
    await settle(editor);

    expect(editor.getText()).toBe("new editable draft");
  });

  it("keeps one action rail and one microphone across the Fold viewport set", async () => {
    for (const [width, height] of [[704, 783], [932, 553], [475, 638], [711, 374]] as const) {
      Object.defineProperties(window, {
        innerWidth: { configurable: true, value: width },
        innerHeight: { configurable: true, value: height },
      });
      const editor = await mount({ dictation: fakeDictation().capability });
      const root = editor.shadowRoot;
      expect(root?.querySelectorAll(".actions")).toHaveLength(1);
      expect(root?.querySelectorAll(".dictation-button")).toHaveLength(1);
      expect(root?.querySelectorAll(".dictation-button, .dictation-status, .dictation-retry-actions").length).toBeGreaterThanOrEqual(2);
      expect(root?.querySelector(".phone-mode, .mobile-mode, .desktop-mode, .tablet-mode")).toBeNull();
      editor.remove();
    }
  });

  it("closes an open model choice when dictation starts and ignores stale picks without focusing the editor", async () => {
    const dictation = fakeDictation();
    const onChooseModel = vi.fn();
    const onChooseThinkingLevel = vi.fn();
    const editor = await mount({
      dictation: dictation.capability,
      capabilities: {
        model: {
          model: { provider: "anthropic", id: "claude-sonnet-5", name: "Claude Sonnet 5" },
          thinkingLevel: "medium",
          availableThinkingLevels: ["off", "medium"],
          listModels: () => Promise.resolve([{ provider: "anthropic", id: "claude-opus-4-8", name: "Claude Opus 4.8" }]),
          onChooseModel,
          onChooseThinkingLevel,
        },
      },
    });

    button(editor, ".select-model").click();
    await settle(editor);
    const staleChoice = choice(editor, "anthropic/claude-opus-4-8");

    pointer(requiredMic(editor), "pointerdown");
    await settle(editor);
    staleChoice.click();
    await settle(editor);

    expect(editor.shadowRoot?.querySelector("composer-popover")).toBeNull();
    expect(onChooseModel).not.toHaveBeenCalled();
    expect(onChooseThinkingLevel).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(editor);
  });

  it("locks destination changes but aborts dictation before emergency dismiss restores the draft", async () => {
    const dictation = fakeDictation();
    const onChangeDestination = vi.fn();
    const onDismiss = vi.fn();
    const editor = await mount({
      dictation: dictation.capability,
      capabilities: {
        context: [{ id: "destination", label: "Project · main", action: { label: "Change", onActivate: onChangeDestination } }],
        dismiss: { label: "Cancel", onDismiss },
      },
    });
    onDismiss.mockImplementation(() => {
      expect(editor.replaceText("restored new-session draft")).toBe(true);
    });
    editor.replaceText("locked");

    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    await settle(editor);

    const changeDestination = button(editor, ".composer-context-chip-action");
    expect(changeDestination.disabled).toBe(true);
    changeDestination.click();
    expect(onChangeDestination).not.toHaveBeenCalled();

    button(editor, ".composer-dismiss").click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(dictation.abortCalls).toBe(1);
    expect(editor.getText()).toBe("restored new-session draft");
  });

  it("locks the streaming Queue and disclosures, but aborts dictation before emergency Stop restores the draft", async () => {
    const dictation = fakeDictation();
    const onSend = vi.fn();
    const onStop = vi.fn();
    const editor = await mount({
      dictation: dictation.capability,
      onSend,
      capabilities: {
        model: { listModels: () => Promise.resolve([]), onChooseModel: vi.fn(), onChooseThinkingLevel: vi.fn() },
        stop: { stoppable: true, onStop },
      },
    });
    onStop.mockImplementation(() => {
      expect(editor.replaceText("restored queued draft")).toBe(true);
    });
    editor.canSteer = true;
    editor.replaceText("locked");
    await editor.updateComplete;

    const queue = button(editor, ".queue-button");
    queue.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    await settle(editor);
    expect(editor.shadowRoot?.querySelector(".steer-confirm-button")).not.toBeNull();

    pointer(requiredMic(editor), "pointerdown");
    dictation.captureReady();
    await settle(editor);

    expect(editor.shadowRoot?.querySelector(".send-button")).toBeNull();
    expect(editor.shadowRoot?.querySelector(".steer-confirm-button")).toBeNull();
    expect(queue.disabled).toBe(true);
    queue.click();
    expect(onSend).not.toHaveBeenCalled();
    expect(attachButton(editor).disabled).toBe(true);
    expect(button(editor, ".select-model").disabled).toBe(true);
    expect(editor.insertTextAtSelection(" plugin")).toBe(false);
    expect(editor.replaceText("external replacement")).toBe(false);
    expect(editor.getText()).toBe("locked");

    button(editor, ".stop-button").click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(dictation.abortCalls).toBe(1);
    expect(editor.getText()).toBe("restored queued draft");
  });
});

async function mount(options: { dictation?: ComposerDictationCapability; onSend?: (...args: unknown[]) => void; capabilities?: Partial<PromptEditor["capabilities"]> } = {}): Promise<PromptEditor> {
  const editor = new PromptEditor();
  editor.machineId = "local";
  editor.sessionId = "session-1";
  editor.cwd = "/repo";
  editor.capabilities = { ...options.capabilities, ...(options.dictation === undefined ? {} : { dictation: options.dictation }) };
  if (options.onSend !== undefined) editor.onSend = options.onSend;
  document.body.append(editor);
  await settle(editor);
  return editor;
}

function fakeDictation(status: Partial<Awaited<ReturnType<ComposerDictationCapability["getStatus"]>>> = {}) {
  let currentStatus: SpeechServiceStatusResponse = speechStatus(status);
  const statusDeferreds: Deferred<SpeechServiceStatusResponse>[] = [];
  let captureOptions: PromptDictationCaptureOptions | undefined;
  let captureDeferred = deferred<SpeechCaptureSession>();
  let stopDeferred = deferred<Float32Array>();
  let checkDeferred = deferred<{ complete: boolean; probability: number; samples: number }>();
  let transcribeDeferred = deferred<{ text: string }>();
  let statusCalls = 0;
  let captureCalls = 0;
  let pauseEndSample = 2;
  let checkCalls = 0;
  let abortCalls = 0;
  const session: SpeechCaptureSession = {
    actualSampleRateHz: 16_000,
    failure: undefined,
    endpointWindow: () => new Float32Array([0.1]),
    finalize: () => new Float32Array([0.2]),
    stopAndFinalize: () => stopDeferred.promise,
    abort: () => { abortCalls += 1; return Promise.resolve(); },
  };
  return {
    get statusCalls() { return statusCalls; },
    get captureCalls() { return captureCalls; },
    get checkCalls() { return checkCalls; },
    get abortCalls() { return abortCalls; },
    capability: {
      getStatus: () => {
        statusCalls += 1;
        const next = statusDeferreds.shift();
        return next?.promise ?? Promise.resolve(currentStatus);
      },
      createCaptureSession: (options: PromptDictationCaptureOptions) => {
        captureCalls += 1;
        captureOptions = options;
        return captureDeferred.promise;
      },
      speechApi: {
        checkTurn: () => { checkCalls += 1; return checkDeferred.promise; },
        transcribe: () => transcribeDeferred.promise,
      },
      statusPollIntervalMs: 60_000,
    } satisfies ComposerDictationCapability,
    captureReady: () => {
      const ready = captureDeferred;
      captureDeferred = deferred<SpeechCaptureSession>();
      ready.resolve(session);
    },
    emitSpeech: () => { captureOptions?.onSpeechActivity({ startSample: 0, endSample: pauseEndSample, sampleCount: 16_000 }); },
    emitPause: (samples: Float32Array) => {
      pauseEndSample += 16_000;
      captureOptions?.onPauseCandidate({ samples, endSample: pauseEndSample });
    },
    resolveCheck: (value: { complete: boolean; probability: number; samples: number }) => {
      const current = checkDeferred;
      checkDeferred = deferred<{ complete: boolean; probability: number; samples: number }>();
      current.resolve(value);
    },
    resolveStop: (samples: Float32Array) => {
      const current = stopDeferred;
      stopDeferred = deferred<Float32Array>();
      current.resolve(samples);
    },
    resolveTranscribe: (value: { text: string }) => {
      const current = transcribeDeferred;
      transcribeDeferred = deferred<{ text: string }>();
      current.resolve(value);
    },
    rejectTranscribe: (error: unknown) => {
      const current = transcribeDeferred;
      transcribeDeferred = deferred<{ text: string }>();
      current.reject(error);
    },
    deferNextStatus: () => {
      const current = deferred<SpeechServiceStatusResponse>();
      statusDeferreds.push(current);
      return current;
    },
    setStatus: (next: Partial<SpeechServiceStatusResponse>) => { currentStatus = speechStatus(next); },
    nextTranscription: () => { transcribeDeferred = deferred<{ text: string }>(); },
  };
}

function speechStatus(status: Partial<SpeechServiceStatusResponse> = {}): SpeechServiceStatusResponse {
  return {
    smartTurn: status.smartTurn ?? "ready",
    whisper: status.whisper ?? "ready",
    capability: status.capability ?? "ready",
    limits: status.limits ?? { sampleRateHz: 16_000, maxTurnSeconds: 60, maxTurnBytes: 3_840_000, endpointWindowSeconds: 8, endpointWindowBytes: 512_000 },
  };
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function settle(editor: PromptEditor): Promise<void> {
  await Promise.resolve();
  await editor.updateComplete;
  await editor.draft?.updateComplete;
  await Promise.resolve();
  await editor.updateComplete;
}

function mic(editor: PromptEditor): HTMLButtonElement | null {
  return editor.shadowRoot?.querySelector<HTMLButtonElement>(".dictation-button") ?? null;
}

function requiredMic(editor: PromptEditor): HTMLButtonElement {
  const found = mic(editor);
  if (found === null) throw new Error("Expected dictation button");
  return found;
}

function sendButton(editor: PromptEditor): HTMLButtonElement {
  return button(editor, ".send-button");
}

function attachButton(editor: PromptEditor): HTMLButtonElement {
  return button(editor, ".composer-attach");
}

function discardButton(editor: PromptEditor): HTMLButtonElement {
  return button(editor, ".dictation-discard");
}

function choice(editor: PromptEditor, value: string): HTMLButtonElement {
  const list = editor.shadowRoot?.querySelector("composer-choice-list");
  const option = list?.shadowRoot?.querySelector(`[data-value="${value}"]`);
  if (!(option instanceof HTMLButtonElement)) throw new Error(`Expected choice ${value}`);
  return option;
}

function button(editor: PromptEditor, selector: string): HTMLButtonElement {
  const found = editor.shadowRoot?.querySelector(selector);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`Expected button ${selector}`);
  return found;
}

function statusText(editor: PromptEditor): string {
  return editor.shadowRoot?.querySelector(".dictation-status")?.textContent ?? "";
}

function pointer(target: HTMLElement, type: string, pointerId = 1): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: pointerId }, button: { value: 0 } });
  target.dispatchEvent(event);
}

function key(target: HTMLElement, type: "keydown" | "keyup", keyValue: string, options: { repeat?: boolean } = {}): void {
  target.dispatchEvent(new KeyboardEvent(type, { key: keyValue, repeat: options.repeat ?? false, bubbles: true, cancelable: true }));
}

function compatibilityClick(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
}

function selectText(editor: PromptEditor, from: number, to: number): void {
  const view = editor.draft?.view;
  if (view === undefined) throw new Error("Expected CodeMirror view");
  view.dispatch({ selection: EditorSelection.range(from, to) });
}
