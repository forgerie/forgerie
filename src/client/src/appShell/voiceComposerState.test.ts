import { describe, expect, it } from "vitest";
import type { PromptDictationState } from "../controllers/promptDictationController";
import {
  VOICE_COMPOSER_LISTENING,
  VOICE_SEND_COUNTDOWN_MS,
  voiceComposerBusy,
  voiceComposerDue,
  voiceComposerEdited,
  voiceComposerFromDictation,
  voiceComposerHeard,
  voiceComposerHold,
  voiceComposerRemainingMs,
  voiceComposerTranscript,
  type VoiceComposerState,
} from "./voiceComposerState";

const NOW = 1_700_000_000_000;

function counting(transcript = "ship the turn rail", at = NOW): VoiceComposerState {
  return voiceComposerHeard(transcript, at);
}

describe("voiceComposerFromDictation", () => {
  it("reads an open microphone as listening", () => {
    expect(voiceComposerFromDictation({ tag: "auto" }, VOICE_COMPOSER_LISTENING)).toEqual(VOICE_COMPOSER_LISTENING);
  });

  it("says so when nothing will decide the turn is over", () => {
    // Turn detection can be unavailable or over budget. The microphone still
    // works, so this is not a failure, but the reader now has to end the turn
    // and cannot be left waiting for a ring that will never appear.
    expect(voiceComposerFromDictation({ tag: "manual-only", reason: "endpoint-budget" }, VOICE_COMPOSER_LISTENING))
      .toEqual({ kind: "listening", endsItself: false });
  });

  it("treats held audio after a failed transcription as retryable", () => {
    const retained: PromptDictationState = {
      tag: "retained-retry",
      expiresAtMs: NOW + 30_000,
      reason: "Transcription failed.",
    };
    expect(voiceComposerFromDictation(retained, VOICE_COMPOSER_LISTENING)).toEqual({
      kind: "failed",
      message: "Transcription failed.",
      retryable: true,
    });
  });

  it("reads a pause check and a transcription as the same wait", () => {
    // The reader cannot act differently on these two, so the modal does not ask
    // them to tell the difference.
    expect(voiceComposerFromDictation({ tag: "checking" }, VOICE_COMPOSER_LISTENING)).toEqual({ kind: "working" });
    expect(voiceComposerFromDictation({ tag: "transcribing" }, VOICE_COMPOSER_LISTENING)).toEqual({ kind: "working" });
  });

  it("carries the controller's own words into the failure", () => {
    const denied: PromptDictationState = {
      tag: "error",
      reason: "permission-denied",
      message: "Microphone permission was denied.",
      retryable: false,
    };
    expect(voiceComposerFromDictation(denied, VOICE_COMPOSER_LISTENING)).toEqual({
      kind: "failed",
      message: "Microphone permission was denied.",
      retryable: false,
    });
  });

  it("treats hearing nothing as a failure the reader can retry", () => {
    expect(voiceComposerFromDictation({ tag: "empty" }, VOICE_COMPOSER_LISTENING)).toEqual({
      kind: "failed",
      message: "Nothing was heard.",
      retryable: true,
    });
  });

  it("does not let an idle microphone wipe a transcript the reader is deciding about", () => {
    // The controller returns to `idle` as soon as it hands over the text. If
    // that erased the countdown, every utterance would vanish on arrival.
    const state = counting();
    expect(voiceComposerFromDictation({ tag: "idle" }, state)).toBe(state);
  });

  it("leaves held text alone whatever the microphone does next", () => {
    const held = voiceComposerHold(counting());
    expect(voiceComposerFromDictation({ tag: "auto" }, held)).toBe(held);
  });
});

describe("voiceComposerHeard", () => {
  it("starts the countdown from the moment the text landed", () => {
    expect(counting("ship it", NOW)).toEqual({
      kind: "counting",
      transcript: "ship it",
      deadlineMs: NOW + VOICE_SEND_COUNTDOWN_MS,
    });
  });

  it("trims the transcript before anyone can send it", () => {
    expect(voiceComposerTranscript(counting("  ship it \n"))).toBe("ship it");
  });

  it("keeps listening rather than offering blank text to send", () => {
    expect(voiceComposerHeard("   ", NOW)).toEqual(VOICE_COMPOSER_LISTENING);
  });
});

describe("the countdown", () => {
  it("runs out after the named delay and not before", () => {
    const state = counting();
    expect(voiceComposerDue(state, NOW + VOICE_SEND_COUNTDOWN_MS - 1)).toBe(false);
    expect(voiceComposerDue(state, NOW + VOICE_SEND_COUNTDOWN_MS)).toBe(true);
  });

  it("reports the time left, and never a negative one", () => {
    const state = counting();
    expect(voiceComposerRemainingMs(state, NOW)).toBe(VOICE_SEND_COUNTDOWN_MS);
    expect(voiceComposerRemainingMs(state, NOW + 9_000)).toBe(0);
  });

  it("stops when a thumb holds it, and never sends itself after that", () => {
    const held = voiceComposerHold(counting());
    expect(held).toEqual({ kind: "held", transcript: "ship the turn rail" });
    expect(voiceComposerDue(held, NOW + 60_000)).toBe(false);
    expect(voiceComposerRemainingMs(held, NOW)).toBe(0);
  });

  it("ignores a hold on anything that is not counting", () => {
    expect(voiceComposerHold(VOICE_COMPOSER_LISTENING)).toBe(VOICE_COMPOSER_LISTENING);
  });
});

describe("voiceComposerEdited", () => {
  it("holds the countdown, so editing one word never races the send", () => {
    expect(voiceComposerEdited(counting(), "ship the turn rail now")).toEqual({
      kind: "held",
      transcript: "ship the turn rail now",
    });
  });

  it("has nothing to edit while the microphone is still open", () => {
    expect(voiceComposerEdited(VOICE_COMPOSER_LISTENING, "anything")).toBe(VOICE_COMPOSER_LISTENING);
  });
});

describe("voiceComposerTranscript", () => {
  it("offers no text from a state that has none", () => {
    expect(voiceComposerTranscript(VOICE_COMPOSER_LISTENING)).toBeUndefined();
    expect(voiceComposerTranscript({ kind: "working" })).toBeUndefined();
    expect(voiceComposerTranscript({ kind: "failed", message: "no", retryable: true })).toBeUndefined();
  });
});

describe("voiceComposerBusy", () => {
  it("refuses a casual dismissal while something can still be lost", () => {
    expect(voiceComposerBusy(VOICE_COMPOSER_LISTENING)).toBe(true);
    expect(voiceComposerBusy({ kind: "working" })).toBe(true);
    expect(voiceComposerBusy(counting())).toBe(true);
  });

  it("lets Escape close the modal once nothing is running", () => {
    expect(voiceComposerBusy(voiceComposerHold(counting()))).toBe(false);
    expect(voiceComposerBusy({ kind: "failed", message: "no", retryable: true })).toBe(false);
  });
});
