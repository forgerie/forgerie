// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerDictationCapability } from "../composerCapabilities";
import type { PromptDictationCaptureOptions } from "../controllers/promptDictationController";
import type { SpeechCaptureSession } from "../speechCapture";
import { SPEECH_POLICY } from "../../../shared/speechPolicy";
import { VOICE_SEND_COUNTDOWN_MS } from "../appShell/voiceComposerState";
import { VOICE_HEARING_WINDOW_MS } from "../appShell/voiceCaptureProgress";
import { ComposerDraft } from "./ComposerDraft";
import type { PromptEditor } from "./PromptEditor";
import { VoiceComposerDialog, voiceComposerDialogStyles } from "./VoiceComposerDialog";

function dialogStyles(): string {
  return voiceComposerDialogStyles.cssText.replaceAll(/\s+/gu, " ");
}

// A turn the transcription route accepts: it rejects anything under 100 ms of
// audio, so a three-sample fixture would only ever exercise the failure path.
const SAMPLES = new Float32Array(SPEECH_POLICY.audio.minRequestSamples).fill(0.2);

/** Mirrors LISTEN_TICK_MS in the voice turn: the rate a silence is noticed at. */
const LISTEN_TICK_MS = 150;

/**
 * A real speech capability whose audio and transcript are configured.
 *
 * `speak` drives the same path the browser does: a pause candidate arrives,
 * turn detection says the turn is over, the capture finalizes, and the service
 * returns text. Nothing about the controller is replaced, so a test that passes
 * here is a statement about the shipped wiring.
 */
function speechCapability(options: { transcript?: string; captureError?: Error; turnDetection?: "ready" | "unavailable"; actualSampleRateHz?: number } = {}) {
  let captureCount = 0;
  let abortCount = 0;
  let pauseCandidate: PromptDictationCaptureOptions["onPauseCandidate"] | undefined;
  let speechActivity: PromptDictationCaptureOptions["onSpeechActivity"] | undefined;

  const capture: SpeechCaptureSession = {
    actualSampleRateHz: options.actualSampleRateHz ?? SPEECH_POLICY.audio.sampleRateHz,
    failure: undefined,
    endpointWindow: () => SAMPLES,
    finalize: () => SAMPLES,
    synchronize: () => Promise.resolve(),
    stopAndFinalize: () => Promise.resolve(SAMPLES),
    abort: () => { abortCount += 1; return Promise.resolve(); },
  };

  const capability: ComposerDictationCapability = {
    getStatus: () => Promise.resolve({
      smartTurn: options.turnDetection ?? "ready",
      whisper: "ready",
      capability: options.turnDetection === "unavailable" ? "manual-only" : "ready",
      limits: {
        sampleRateHz: 16_000,
        maxTurnSeconds: SPEECH_POLICY.audio.maxTurnSeconds,
        maxTurnBytes: SPEECH_POLICY.audio.maxTurnBytes,
        endpointWindowSeconds: SPEECH_POLICY.audio.endpointWindowSeconds,
        endpointWindowBytes: SPEECH_POLICY.audio.endpointWindowBytes,
      },
    }),
    createCaptureSession: (captureOptions: PromptDictationCaptureOptions) => {
      captureCount += 1;
      if (options.captureError !== undefined) return Promise.reject(options.captureError);
      pauseCandidate = captureOptions.onPauseCandidate;
      speechActivity = captureOptions.onSpeechActivity;
      return Promise.resolve(capture);
    },
    speechApi: {
      checkTurn: () => options.turnDetection === "unavailable"
        ? Promise.reject(new Error("Smart Turn is unavailable."))
        : Promise.resolve({ complete: true, probability: 0.9, samples: SAMPLES.length }),
      transcribe: () => Promise.resolve({ text: options.transcript ?? "" }),
    },
  };

  return {
    capability,
    captureCount: () => captureCount,
    abortCount: () => abortCount,
    /** Report voiced audio, the way the capture worklet does while you talk. */
    async voice(dialog: VoiceComposerDialog, seconds: number): Promise<void> {
      const sampleCount = SPEECH_POLICY.audio.sampleRateHz * seconds;
      speechActivity?.({ startSample: 0, endSample: sampleCount, sampleCount });
      await settle(dialog);
    },
    /** Say a sentence and let the turn finish, exactly as a pause would. */
    async speak(dialog: VoiceComposerDialog): Promise<void> {
      pauseCandidate?.({ samples: SAMPLES, endSample: SAMPLES.length });
      await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.endpointCompletionGraceMs + 1);
      await vi.advanceTimersByTimeAsync(0);
      await settle(dialog);
    },
  };
}

async function openDialog(capability: ComposerDictationCapability, options: { canSteer?: boolean; isCompacting?: boolean; queuedCompactionAvailable?: boolean } = {}) {
  let dismissed = false;
  const onSendPrompt = vi.fn<(text: string) => void>();
  const dialog = new VoiceComposerDialog();
  dialog.capabilities = { dictation: capability };
  dialog.sessionId = "session-1";
  dialog.machineId = "local";
  dialog.cwd = "/repo";
  dialog.canSteer = options.canSteer ?? false;
  dialog.isCompacting = options.isCompacting ?? false;
  dialog.queuedCompactionAvailable = options.queuedCompactionAvailable ?? true;
  dialog.onSendPrompt = onSendPrompt;
  dialog.onDismiss = () => { dismissed = true; };
  document.body.append(dialog);
  await settle(dialog);
  // The status read and the microphone acquisition are both asynchronous; let
  // them settle so the composer is listening rather than still opening.
  await vi.advanceTimersByTimeAsync(0);
  await settle(dialog);
  return { dialog, onSendPrompt, dismissed: () => dismissed };
}

/** The dialog, its composer, and its draft all redraw before an assertion. */
async function settle(dialog: VoiceComposerDialog): Promise<void> {
  await dialog.updateComplete;
  const editorElement = editor(dialog);
  if (editorElement !== null) {
    await editorElement.updateComplete;
    await draft(dialog)?.updateComplete;
  }
  await dialog.updateComplete;
}

function editor(dialog: VoiceComposerDialog): PromptEditor | null {
  return dialog.shadowRoot?.querySelector<PromptEditor>("prompt-editor") ?? null;
}

function draft(dialog: VoiceComposerDialog): ComposerDraft | null {
  const element = editor(dialog)?.shadowRoot?.querySelector("composer-draft");
  return element instanceof ComposerDraft ? element : null;
}

/** What the reader would send: the composer's own draft text. */
function draftText(dialog: VoiceComposerDialog): string {
  return draft(dialog)?.getText() ?? "";
}

function composerButton(dialog: VoiceComposerDialog, selector: string): HTMLButtonElement | null {
  return editor(dialog)?.shadowRoot?.querySelector<HTMLButtonElement>(selector) ?? null;
}

function dialogText(dialog: VoiceComposerDialog): string {
  return `${dialog.shadowRoot?.textContent ?? ""} ${editor(dialog)?.shadowRoot?.textContent ?? ""}`;
}

describe("VoiceComposerDialog", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("hosts the shared composer rather than a second one", async () => {
    // The whole point of this dialog. A spoken message needs attachments,
    // commands, and a model picker exactly as often as a typed one does,
    // because it is the same message going to the same place.
    const speech = speechCapability();
    const { dialog } = await openDialog(speech.capability);

    const composer = editor(dialog);
    expect(composer).not.toBeNull();
    expect(composer?.voiceMode).toBe("voice-first");
    expect(draft(dialog)).not.toBeNull();
    expect(composerButton(dialog, ".composer-attach")).not.toBeNull();
    expect(composerButton(dialog, ".composer-commands")).not.toBeNull();
    expect(composerButton(dialog, ".dictation-button")).not.toBeNull();
    expect(composerButton(dialog, "[data-action='cancel']")).not.toBeNull();
    // No dialog chrome of its own: the composer is the surface, exactly as it
    // is in the new-session pop-up.
    expect(dialog.shadowRoot?.querySelector("header")).toBeNull();
  });

  it("lets the island be the only surface, with no dialog box around it", () => {
    // A dialog box here would draw a second border, background, and shadow
    // around a composer that already carries all three, and would take width
    // from a control row that needs every pixel at the folded size.
    const styles = dialogStyles();

    expect(styles).toContain("--modal-surface-background: transparent;");
    expect(styles).toContain("--modal-surface-border: none;");
    expect(styles).toContain("--modal-surface-shadow: none;");
    // The model and command menus open above the island and must not be clipped.
    expect(styles).toContain("--modal-surface-overflow: visible;");
    // Sized against its own container, never the viewport.
    expect(styles).toContain("--modal-surface-width: min(42rem, calc(100% - clamp(1rem, 4cqi, 2rem)));");
    expect(styles).toContain("container-type: size;");
  });

  it("opens the microphone without being asked", async () => {
    // Voice-first means the reader already asked to talk. Waiting for a tap
    // would turn the request into a request to make a request.
    const speech = speechCapability();
    await openDialog(speech.capability);
    expect(speech.captureCount()).toBe(1);
  });

  it("does not claim to listen while speech status is still pending", async () => {
    const baseCapability = speechCapability().capability;
    const capability: ComposerDictationCapability = { ...baseCapability, getStatus: () => new Promise(() => undefined) };
    const { dialog } = await openDialog(capability);

    expect(dialogText(dialog)).toContain("Starting microphone");
    expect(dialogText(dialog)).not.toContain("Stop talking and it sends itself");
  });

  it("restarts listening after the page returns from the background", async () => {
    const speech = speechCapability();
    const { dialog } = await openDialog(speech.capability);
    expect(speech.captureCount()).toBe(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    await settle(dialog);
    expect(speech.abortCount()).toBe(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    await settle(dialog);
    expect(speech.captureCount()).toBe(2);
  });

  it("focuses nothing that would raise the keyboard", async () => {
    // The reason this dialog exists. `modal-surface` focuses its initialFocus
    // target when it has one, so this dialog must never name a text field.
    const speech = speechCapability();
    await openDialog(speech.capability);
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    expect(document.activeElement?.tagName).not.toBe("INPUT");
  });

  it("sends a heard sentence by itself once the countdown runs out", async () => {
    const speech = speechCapability({ transcript: "put the indicator on the turn rail" });
    const { dialog, onSendPrompt, dismissed } = await openDialog(speech.capability);

    await speech.speak(dialog);
    expect(draftText(dialog)).toBe("put the indicator on the turn rail");
    expect(onSendPrompt).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS);
    await settle(dialog);

    expect(onSendPrompt).toHaveBeenCalledWith("put the indicator on the turn rail", undefined, undefined, undefined);
    expect(dismissed()).toBe(true);
  });

  it("stops the countdown when a hand touches the composer, and never sends itself after that", async () => {
    // Whisper mishears, and a spoken message is often the one you most want to
    // add a file to. Both need the timer to yield to a hand.
    const speech = speechCapability({ transcript: "put it on the turn real" });
    const { dialog, onSendPrompt } = await openDialog(speech.capability);
    await speech.speak(dialog);

    draft(dialog)?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await settle(dialog);

    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS * 10);
    await settle(dialog);

    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(draftText(dialog)).toBe("put it on the turn real");
  });

  it("sends the edited sentence rather than the heard one", async () => {
    const speech = speechCapability({ transcript: "put it on the turn real" });
    const { dialog, onSendPrompt } = await openDialog(speech.capability);
    await speech.speak(dialog);

    draft(dialog)?.replaceText("put it on the turn rail");
    await settle(dialog);

    composerButton(dialog, ".send-button")?.click();
    await settle(dialog);

    expect(onSendPrompt).toHaveBeenCalledWith("put it on the turn rail", undefined, undefined, undefined);
  });

  it("queues an automatic voice send behind active work", async () => {
    const speech = speechCapability({ transcript: "send after the active turn" });
    const { dialog, onSendPrompt } = await openDialog(speech.capability, { canSteer: true });
    await speech.speak(dialog);

    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS);
    await settle(dialog);

    expect(onSendPrompt).toHaveBeenCalledWith("send after the active turn", "followUp", undefined, undefined);
  });

  it("holds the transcript when the countdown reaches a closed send gate", async () => {
    const speech = speechCapability({ transcript: "keep this sentence" });
    const { dialog, onSendPrompt } = await openDialog(speech.capability);
    await speech.speak(dialog);
    dialog.sending = true;
    await settle(dialog);

    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS);
    await settle(dialog);

    expect(onSendPrompt).not.toHaveBeenCalled();
    expect(dialogText(dialog)).toContain("Held. Edit, attach, or send when you are ready.");
  });

  it("keeps listening rather than offering an empty sentence to send", async () => {
    const speech = speechCapability({ transcript: "   " });
    const { dialog, onSendPrompt } = await openDialog(speech.capability);
    await speech.speak(dialog);

    expect(draftText(dialog)).toBe("");
    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS * 2);
    expect(onSendPrompt).not.toHaveBeenCalled();
  });

  it("leaves on request without sending anything", async () => {
    const speech = speechCapability({ transcript: "never mind" });
    const { dialog, onSendPrompt, dismissed } = await openDialog(speech.capability);
    await speech.speak(dialog);

    // The way out is the composer's own dismiss control, where the
    // new-session pop-up puts it, not a dialog title bar of this one's own.
    composerButton(dialog, "[data-action='cancel']")?.click();
    await settle(dialog);

    expect(dismissed()).toBe(true);
    expect(onSendPrompt).not.toHaveBeenCalled();
  });

  it("shows a voice arriving, so a reader is not talking into a still screen", async () => {
    // "Listening" is a claim. This is the evidence, and it is driven by the
    // voiced-audio reports the capture session already emits.
    const speech = speechCapability();
    const { dialog } = await openDialog(speech.capability);
    expect(editor(dialog)?.shadowRoot?.querySelector(".voice-dot.hearing")).toBeNull();

    await speech.voice(dialog, 2);

    expect(editor(dialog)?.shadowRoot?.querySelector(".voice-dot.hearing")).not.toBeNull();
    expect(dialogText(dialog)).toContain("Hearing you");
    expect(dialogText(dialog)).toContain("0:02");
  });

  it("uses the downsampled speech rate for the voiced clock", async () => {
    const speech = speechCapability({ actualSampleRateHz: 48_000 });
    const { dialog } = await openDialog(speech.capability);

    await speech.voice(dialog, 3);

    expect(dialogText(dialog)).toContain("0:03");
  });

  it("notices a silence that no event reports, and keeps what was said", async () => {
    const speech = speechCapability();
    const { dialog } = await openDialog(speech.capability);
    await speech.voice(dialog, 3);

    await vi.advanceTimersByTimeAsync(VOICE_HEARING_WINDOW_MS + LISTEN_TICK_MS);
    await settle(dialog);

    expect(editor(dialog)?.shadowRoot?.querySelector(".voice-dot.hearing")).toBeNull();
    expect(dialogText(dialog)).toContain("Gone quiet");
    expect(dialogText(dialog)).toContain("0:03");
  });

  it("says up front that nothing will end the turn, rather than promising it will", async () => {
    // `liveSpeechService.ts` disables automatic turn detection on purpose:
    // "explicit completion is the product policy". The controller assumes
    // ready until told otherwise, so a surface that skipped the status read
    // would promise a pause ends the turn and take it back a second later.
    const speech = speechCapability({ transcript: "end this turn by hand", turnDetection: "unavailable" });
    const { dialog } = await openDialog(speech.capability);

    expect(dialogText(dialog)).toContain("Nothing will end this turn but you");
    expect(dialogText(dialog)).not.toContain("sends itself");
  });

  it("can still end a turn when nothing on the server will end it", async () => {
    const speech = speechCapability({ transcript: "end this turn by hand", turnDetection: "unavailable" });
    const { dialog, onSendPrompt } = await openDialog(speech.capability);

    expect(draftText(dialog)).toBe("");
    composerButton(dialog, "[data-action='voice-finish']")?.click();
    await vi.advanceTimersByTimeAsync(0);
    await settle(dialog);

    expect(draftText(dialog)).toBe("end this turn by hand");
    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS);
    await settle(dialog);
    expect(onSendPrompt).toHaveBeenCalledWith("end this turn by hand", undefined, undefined, undefined);
  });

  it("says what went wrong in the service's own words rather than closing on the reader", async () => {
    // "That did not work" tells a reader nothing they can act on. A denied
    // microphone and a missing one need different responses from them.
    const speech = speechCapability({ captureError: new Error("no microphone") });
    const { dialog, dismissed } = await openDialog(speech.capability);

    expect(dismissed()).toBe(false);
    expect(dialogText(dialog)).toContain("no microphone");
  });
});
