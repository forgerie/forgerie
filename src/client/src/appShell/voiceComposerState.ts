/**
 * What the voice composer is doing, as one value.
 *
 * The speech controller already models capture in detail: `auto` while the
 * microphone is open, `checking` while a pause is judged, `transcribing` while
 * audio is with Whisper. Those are facts about audio. This is a different
 * question — what the reader is being asked to do — and it has one case the
 * speech controller deliberately does not have.
 *
 * `counting` is that case. A transcript that has landed is not sent yet: it is
 * sent in {@link VOICE_SEND_COUNTDOWN_MS} unless a thumb interrupts. The
 * countdown belongs here, not in `PromptDictationController`, whose job ends
 * at `commitTranscript`. Putting it there would hand the same countdown to the
 * inline composer microphone, which does not want one.
 */

import type { PromptDictationState } from "../controllers/promptDictationController";
import type { VoiceCaptureDisplay } from "./voiceCaptureProgress";

/**
 * How long a finished transcript waits before it sends.
 *
 * Long enough to read a short sentence and catch a mis-transcription, short
 * enough that a correct sentence does not feel gated. It is the one number in
 * this feature that came from taste rather than from measurement, so it is
 * named once and read everywhere, including by the ring that draws it.
 */
export const VOICE_SEND_COUNTDOWN_MS = 2_000;

export type VoiceComposerState =
  /**
   * The microphone is open and nothing has been heard worth showing yet.
   *
   * `endsItself` is false when turn detection is unavailable or over budget.
   * The microphone still works, but nothing will decide the turn is over, so
   * the reader has to end it by touch and has to be told so.
   */
  | { readonly kind: "listening"; readonly endsItself: boolean }
  /** A pause is being judged, or audio is being transcribed. */
  | { readonly kind: "working" }
  /** Text has landed and will send itself unless interrupted. */
  | { readonly kind: "counting"; readonly transcript: string; readonly deadlineMs: number }
  /** A thumb interrupted. From here, sending is the reader's to do. */
  | { readonly kind: "held"; readonly transcript: string }
  /** Capture or transcription failed, with the reason in words. */
  | { readonly kind: "failed"; readonly message: string; readonly retryable: boolean };

export const VOICE_COMPOSER_LISTENING: VoiceComposerState = { kind: "listening", endsItself: true };
const VOICE_COMPOSER_LISTENING_MANUAL: VoiceComposerState = { kind: "listening", endsItself: false };

/**
 * The text the reader is looking at, if there is any.
 *
 * Returned rather than reached for, so that call sites never read `transcript`
 * off a case that has none.
 */
export function voiceComposerTranscript(state: VoiceComposerState): string | undefined {
  if (state.kind === "counting" || state.kind === "held") return state.transcript;
  return undefined;
}

/**
 * Fold a speech-controller state into this one.
 *
 * `counting` and `held` survive whatever the controller says next. The
 * controller returns to `idle` the moment it hands over a transcript, and an
 * idle microphone must not wipe text the reader is still deciding about.
 */
export function voiceComposerFromDictation(
  dictation: PromptDictationState,
  current: VoiceComposerState,
): VoiceComposerState {
  if (current.kind === "counting" || current.kind === "held") return current;

  switch (dictation.tag) {
    case "idle":
    case "acquiring":
    case "pressed":
    case "auto":
    case "held":
      return VOICE_COMPOSER_LISTENING;
    case "manual-only":
      return VOICE_COMPOSER_LISTENING_MANUAL;
    case "checking":
    case "transcribing":
      return { kind: "working" };
    case "empty":
      return { kind: "failed", message: "Nothing was heard.", retryable: true };
    case "retained-retry":
      return { kind: "failed", message: dictation.reason, retryable: true };
    case "unavailable":
      return { kind: "failed", message: dictation.reason, retryable: false };
    case "error":
      return { kind: "failed", message: dictation.message, retryable: dictation.retryable };
  }
}

/**
 * A transcript has landed. Start the countdown.
 *
 * Blank text is not something to send or to make a reader dismiss, so it goes
 * back to listening and the microphone keeps its turn.
 */
export function voiceComposerHeard(transcript: string, nowMs: number): VoiceComposerState {
  const trimmed = transcript.trim();
  if (trimmed === "") return VOICE_COMPOSER_LISTENING;
  return { kind: "counting", transcript: trimmed, deadlineMs: nowMs + VOICE_SEND_COUNTDOWN_MS };
}

/**
 * Stop the countdown and keep the text.
 *
 * This is what a tap on the transcript means, and it is deliberately not what
 * discarding means. A reader fixing one word must never risk the sentence.
 */
export function voiceComposerHold(state: VoiceComposerState): VoiceComposerState {
  if (state.kind !== "counting") return state;
  return { kind: "held", transcript: state.transcript };
}

/** Replace held text after an edit. Editing a sentence never restarts the timer. */
export function voiceComposerEdited(state: VoiceComposerState, transcript: string): VoiceComposerState {
  if (state.kind !== "counting" && state.kind !== "held") return state;
  return { kind: "held", transcript };
}

/** Milliseconds left before the text sends itself. Zero unless counting. */
export function voiceComposerRemainingMs(state: VoiceComposerState, nowMs: number): number {
  if (state.kind !== "counting") return 0;
  return Math.max(0, state.deadlineMs - nowMs);
}

/** Whether the countdown has run out and the text should go now. */
export function voiceComposerDue(state: VoiceComposerState, nowMs: number): boolean {
  return state.kind === "counting" && nowMs >= state.deadlineMs;
}

/**
 * Whether the modal may close on Escape or a backdrop press.
 *
 * A live microphone and a running countdown both have something to lose, so
 * both refuse the casual dismissals and route through an explicit control.
 */
export function voiceComposerBusy(state: VoiceComposerState): boolean {
  return state.kind === "listening" || state.kind === "working" || state.kind === "counting";
}

/**
 * One line telling the reader what is happening and what is theirs to do.
 *
 * It reads both models because both matter and neither is enough alone. The
 * turn state says what the surface will do next; the capture readout says
 * whether a voice is actually arriving. "Listening" while nothing is heard and
 * "Listening" while a voice is arriving are different facts, and a reader
 * talking into a still screen needs to be told which one is true.
 */
export function voiceComposerStatusLine(state: VoiceComposerState, capture: VoiceCaptureDisplay): string {
  switch (state.kind) {
    case "listening":
      if (capture.hearing) return "Hearing you.";
      if (capture.seconds > 0) return state.endsItself ? "Gone quiet." : "Gone quiet. Finish when you are done.";
      // Before a first word there is nothing to report but the contract, and
      // whether the turn ends itself is the part a reader has to know.
      return state.endsItself
        ? "Listening. Stop talking and it sends itself."
        : "Listening. Nothing will end this turn but you.";
    case "working":
      return "Working out what you said.";
    case "counting":
      return "Sending. Touch anything to stop it.";
    case "held":
      return "Held. Edit, attach, or send when you are ready.";
    case "failed":
      return state.message;
  }
}
