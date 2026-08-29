import { describe, expect, it } from "vitest";
import type { PromptDictationState } from "../controllers/promptDictationController";
import {
  VOICE_COMPOSER_LISTENING,
  VOICE_COMPOSER_WAITING,
  VOICE_SEND_COUNTDOWN_MS,
  voiceComposerBusy,
  voiceComposerDue,
  voiceComposerEdited,
  voiceComposerFromDictation,
  voiceComposerHeard,
  voiceComposerHold,
  voiceComposerRemainingMs,
  voiceComposerStatusLine,
  voiceComposerTranscript,
  type VoiceComposerState,
} from "./voiceComposerState";

const NOW = 1_700_000_000_000;

function counting(transcript = "ship the turn rail", at = NOW): VoiceComposerState {
  return voiceComposerHeard(transcript, at);
}

describe("voiceComposerFromDictation", () => {
  it("waits through microphone acquisition, then reads an open microphone as listening", () => {
    expect(voiceComposerFromDictation({ tag: "acquiring", gesture: "pressing" }, VOICE_COMPOSER_WAITING)).toEqual(VOICE_COMPOSER_WAITING);
    expect(voiceComposerFromDictation({ tag: "auto" }, VOICE_COMPOSER_WAITING)).toEqual(VOICE_COMPOSER_LISTENING);
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

  it("preserves held text only through the controller's trailing idle state", () => {
    const held = voiceComposerHold(counting());
    expect(voiceComposerFromDictation({ tag: "idle" }, held)).toBe(held);
    expect(voiceComposerFromDictation({ tag: "acquiring", gesture: "pressing" }, held)).toEqual(VOICE_COMPOSER_WAITING);
    expect(voiceComposerFromDictation({ tag: "empty" }, held)).toEqual({ kind: "failed", message: "Nothing was heard.", retryable: true });
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
    expect(voiceComposerBusy(VOICE_COMPOSER_WAITING)).toBe(true);
    expect(voiceComposerBusy(VOICE_COMPOSER_LISTENING)).toBe(true);
    expect(voiceComposerBusy({ kind: "working" })).toBe(true);
    expect(voiceComposerBusy(counting())).toBe(true);
  });

  it("lets Escape close the modal once nothing is running", () => {
    expect(voiceComposerBusy(voiceComposerHold(counting()))).toBe(false);
    expect(voiceComposerBusy({ kind: "failed", message: "no", retryable: true })).toBe(false);
  });
});

describe("voiceComposerStatusLine", () => {
  const silent = { hearing: false, seconds: 0 };

  it("does not claim the microphone is listening before capture starts", () => {
    expect(voiceComposerStatusLine(VOICE_COMPOSER_WAITING, silent)).toBe("Starting microphone.");
  });

  it("never promises a pause will end a turn that nothing will end", () => {
    // The service disables automatic turn detection by policy. Saying "it
    // sends itself" there would be a promise the surface cannot keep.
    expect(voiceComposerStatusLine({ kind: "listening", endsItself: true }, silent)).toContain("sends itself");
    expect(voiceComposerStatusLine({ kind: "listening", endsItself: false }, silent)).toBe("Listening. Nothing will end this turn but you.");
  });

  it("reports a voice arriving over the standing contract", () => {
    expect(voiceComposerStatusLine({ kind: "listening", endsItself: true }, { hearing: true, seconds: 2 })).toBe("Hearing you.");
  });

  it("distinguishes a silence after speech from a silence before it", () => {
    const quiet = { hearing: false, seconds: 3 };
    expect(voiceComposerStatusLine({ kind: "listening", endsItself: true }, quiet)).toBe("Gone quiet.");
    expect(voiceComposerStatusLine({ kind: "listening", endsItself: false }, quiet)).toBe("Gone quiet. Finish when you are done.");
  });

  it("tells the reader the countdown is theirs to stop", () => {
    expect(voiceComposerStatusLine(counting(), silent)).toBe("Sending. Touch anything to stop it.");
  });

  it("names the composer's other tools once the turn is held", () => {
    // The reason this dialog hosts the real composer: a held transcript is the
    // moment a reader reaches for an attachment or a command.
    expect(voiceComposerStatusLine(voiceComposerHold(counting()), silent)).toBe("Held. Edit, attach, or send when you are ready.");
  });

  it("gives a failure the service's own words and keeps retry guidance inside the status", () => {
    expect(voiceComposerStatusLine({ kind: "failed", message: "no microphone", retryable: false }, silent)).toBe("no microphone");
    expect(voiceComposerStatusLine({ kind: "failed", message: "network error", retryable: true }, silent)).toBe("network error Press the microphone to try again.");
  });
});
