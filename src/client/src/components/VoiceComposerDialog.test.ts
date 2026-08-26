// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerDictationCapability } from "../composerCapabilities";
import type { PromptDictationCaptureOptions } from "../controllers/promptDictationController";
import type { SpeechCaptureSession } from "../speechCapture";
import { SPEECH_POLICY } from "../../../shared/speechPolicy";
import { VOICE_SEND_COUNTDOWN_MS } from "../appShell/voiceComposerState";
import { VOICE_HEARING_WINDOW_MS } from "../appShell/voiceCaptureProgress";
import { VoiceComposerDialog } from "./VoiceComposerDialog";

const SAMPLES = new Float32Array([0.2, 0.4, 0.2]);

/** Mirrors LISTEN_TICK_MS in the dialog: the rate a silence is noticed at. */
const LISTEN_TICK_MS = 150;

/**
 * A real speech capability whose audio and transcript are configured.
 *
 * `speak` drives the same path the browser does: a pause candidate arrives,
 * turn detection says the turn is over, the capture finalizes, and the service
 * returns text. Nothing about the controller is replaced, so a test that passes
 * here is a statement about the shipped wiring.
 */
function speechCapability(options: { transcript?: string; captureError?: Error; turnDetection?: "ready" | "unavailable" } = {}) {
  let captureCount = 0;
  let pauseCandidate: PromptDictationCaptureOptions["onPauseCandidate"] | undefined;
  let speechActivity: PromptDictationCaptureOptions["onSpeechActivity"] | undefined;

  const capture: SpeechCaptureSession = {
    actualSampleRateHz: SPEECH_POLICY.audio.sampleRateHz,
    failure: undefined,
    endpointWindow: () => SAMPLES,
    finalize: () => SAMPLES,
    synchronize: () => Promise.resolve(),
    stopAndFinalize: () => Promise.resolve(SAMPLES),
    abort: () => Promise.resolve(),
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
    /** Report voiced audio, the way the capture worklet does while you talk. */
    async voice(dialog: VoiceComposerDialog, seconds: number): Promise<void> {
      const sampleCount = SPEECH_POLICY.audio.sampleRateHz * seconds;
      speechActivity?.({ startSample: 0, endSample: sampleCount, sampleCount });
      await dialog.updateComplete;
    },
    /** Say a sentence and let the turn finish, exactly as a pause would. */
    async speak(dialog: VoiceComposerDialog): Promise<void> {
      pauseCandidate?.({ samples: SAMPLES, endSample: SAMPLES.length });
      await vi.advanceTimersByTimeAsync(SPEECH_POLICY.timing.endpointCompletionGraceMs + 1);
      await vi.advanceTimersByTimeAsync(0);
      await dialog.updateComplete;
    },
  };
}

async function openDialog(capability: ComposerDictationCapability) {
  let dismissed = false;
  const onSendText = vi.fn<(text: string) => void>();
  const dialog = new VoiceComposerDialog();
  dialog.capability = capability;
  dialog.ownerKey = "local:session-1";
  dialog.onSendText = onSendText;
  dialog.onDismiss = () => { dismissed = true; };
  document.body.append(dialog);
  await dialog.updateComplete;
  // The microphone is acquired asynchronously; let acquisition settle so the
  // controller is listening rather than still opening.
  await vi.advanceTimersByTimeAsync(0);
  await dialog.updateComplete;
  return { dialog, onSendText, dismissed: () => dismissed };
}

const transcriptBox = (dialog: VoiceComposerDialog): HTMLTextAreaElement | null =>
  dialog.shadowRoot?.querySelector("textarea") ?? null;

const button = (dialog: VoiceComposerDialog, name: string): HTMLButtonElement | null =>
  dialog.shadowRoot?.querySelector<HTMLButtonElement>(`button.${name}`) ?? null;

describe("VoiceComposerDialog", () => {
  beforeEach(() => { vi.useFakeTimers(); });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("opens the microphone without being asked", async () => {
    // The wheel's release is the start of recording. A dialog that waited for
    // a tap would turn the gesture into a request to record instead.
    const speech = speechCapability();
    await openDialog(speech.capability);
    expect(speech.captureCount()).toBe(1);
  });

  it("focuses nothing that would raise the keyboard", async () => {
    // The reason this dialog exists. `modal-surface` focuses its initialFocus
    // target when it has one, so this dialog must never name a text field.
    const speech = speechCapability();
    const { dialog } = await openDialog(speech.capability);
    expect(transcriptBox(dialog)).toBeNull();
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
  });

  it("sends a heard sentence by itself once the countdown runs out", async () => {
    const speech = speechCapability({ transcript: "put the indicator on the turn rail" });
    const { dialog, onSendText, dismissed } = await openDialog(speech.capability);

    await speech.speak(dialog);
    expect(transcriptBox(dialog)?.value).toBe("put the indicator on the turn rail");
    expect(onSendText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS);
    expect(onSendText).toHaveBeenCalledWith("put the indicator on the turn rail");
    expect(dismissed()).toBe(true);
  });

  it("stops the countdown when a thumb touches the text, and never sends itself after that", async () => {
    // Whisper mishears. This is the gate that makes a wrong sentence catchable.
    const speech = speechCapability({ transcript: "put it on the turn real" });
    const { dialog, onSendText } = await openDialog(speech.capability);
    await speech.speak(dialog);

    transcriptBox(dialog)?.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await dialog.updateComplete;

    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS * 10);
    expect(onSendText).not.toHaveBeenCalled();
    expect(transcriptBox(dialog)?.value).toBe("put it on the turn real");
  });

  it("sends the edited sentence rather than the heard one", async () => {
    const speech = speechCapability({ transcript: "put it on the turn real" });
    const { dialog, onSendText } = await openDialog(speech.capability);
    await speech.speak(dialog);

    const box = transcriptBox(dialog);
    if (box === null) throw new Error("the dialog rendered no transcript to edit");
    box.value = "put it on the turn rail";
    box.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await dialog.updateComplete;

    button(dialog, "send")?.click();
    expect(onSendText).toHaveBeenCalledWith("put it on the turn rail");
  });

  it("keeps listening rather than offering an empty sentence to send", async () => {
    const speech = speechCapability({ transcript: "   " });
    const { dialog, onSendText } = await openDialog(speech.capability);
    await speech.speak(dialog);

    expect(transcriptBox(dialog)).toBeNull();
    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS * 2);
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("leaves on request without sending anything", async () => {
    const speech = speechCapability({ transcript: "never mind" });
    const { dialog, onSendText, dismissed } = await openDialog(speech.capability);
    await speech.speak(dialog);

    button(dialog, "discard")?.click();
    await dialog.updateComplete;

    expect(dismissed()).toBe(true);
    expect(onSendText).not.toHaveBeenCalled();
  });

  it("shows a voice arriving, so a reader is not talking into a still screen", async () => {
    // "Listening" is a claim. This is the evidence, and it is driven by the
    // voiced-audio reports the capture session already emits.
    const speech = speechCapability();
    const { dialog } = await openDialog(speech.capability);
    expect(dialog.shadowRoot?.querySelector(".dot.hearing")).toBeNull();

    await speech.voice(dialog, 2);

    expect(dialog.shadowRoot?.querySelector(".dot.hearing")).not.toBeNull();
    expect(dialog.shadowRoot?.textContent).toContain("Hearing you");
    expect(dialog.shadowRoot?.textContent).toContain("0:02");
  });

  it("notices a silence that no event reports, and keeps what was said", async () => {
    const speech = speechCapability();
    const { dialog } = await openDialog(speech.capability);
    await speech.voice(dialog, 3);

    await vi.advanceTimersByTimeAsync(VOICE_HEARING_WINDOW_MS + LISTEN_TICK_MS);
    await dialog.updateComplete;

    expect(dialog.shadowRoot?.querySelector(".dot.hearing")).toBeNull();
    expect(dialog.shadowRoot?.textContent).toContain("Gone quiet");
    expect(dialog.shadowRoot?.textContent).toContain("0:03");
  });

  it("says up front that nothing will end the turn, rather than promising it will", async () => {
    // `liveSpeechService.ts` disables automatic turn detection on purpose:
    // "explicit completion is the product policy". The controller assumes
    // ready until told otherwise, so a dialog that skipped the status read
    // would promise a pause ends the turn and take it back a second later.
    const speech = speechCapability({ transcript: "end this turn by hand", turnDetection: "unavailable" });
    const { dialog } = await openDialog(speech.capability);

    expect(dialog.shadowRoot?.textContent).toContain("Nothing will end this turn but you");
    expect(dialog.shadowRoot?.textContent).not.toContain("sends itself");
  });

  it("can still end a turn when nothing on the server will end it", async () => {
    const speech = speechCapability({ transcript: "end this turn by hand", turnDetection: "unavailable" });
    const { dialog, onSendText } = await openDialog(speech.capability);

    expect(transcriptBox(dialog)).toBeNull();
    button(dialog, "finish")?.click();
    await vi.advanceTimersByTimeAsync(0);
    await dialog.updateComplete;

    expect(transcriptBox(dialog)?.value).toBe("end this turn by hand");
    await vi.advanceTimersByTimeAsync(VOICE_SEND_COUNTDOWN_MS);
    expect(onSendText).toHaveBeenCalledWith("end this turn by hand");
  });

  it("says what went wrong in the service's own words rather than closing on the reader", async () => {
    // "That did not work" tells a reader nothing they can act on. A denied
    // microphone and a missing one need different responses from them.
    const speech = speechCapability({ captureError: new Error("no microphone") });
    const { dialog, dismissed } = await openDialog(speech.capability);

    expect(dismissed()).toBe(false);
    expect(dialog.shadowRoot?.textContent).toContain("no microphone");
  });
});
