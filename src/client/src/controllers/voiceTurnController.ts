/**
 * The policy that makes a composer voice-first.
 *
 * The composer already knows how to dictate: it opens a microphone, streams a
 * transcript into its own draft, and stops. What it does not know is what a
 * *turn* is. A turn adds two things on top of dictation. It starts itself when
 * the surface opens, and when it ends the text sends itself unless a hand
 * interrupts.
 *
 * Both belong here rather than in `PromptDictationController`, whose job ends
 * at `commitTranscript`, and rather than in a dialog, which would hand the
 * next voice surface the same code to write again. The composer holds one of
 * these and reads it; a host that never turns voice on never pays for it.
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";
import {
  VOICE_COMPOSER_LISTENING,
  voiceComposerDue,
  voiceComposerEdited,
  voiceComposerFromDictation,
  voiceComposerHeard,
  voiceComposerHold,
  voiceComposerRemainingMs,
  voiceComposerTranscript,
  type VoiceComposerState,
} from "../appShell/voiceComposerState";
import {
  VOICE_CAPTURE_NONE,
  voiceCaptureDisplay,
  voiceCaptureDisplayChanged,
  voiceCaptureNoted,
  type VoiceCaptureActivity,
  type VoiceCaptureDisplay,
  type VoiceCaptureProgress,
} from "../appShell/voiceCaptureProgress";
import type { PromptDictationState } from "./promptDictationController";

/** How often the countdown ring redraws. Continuous to the eye, cheap to run. */
const COUNTDOWN_TICK_MS = 80;

/**
 * How often a silence is noticed.
 *
 * Voiced audio arriving is an event. A voice stopping is not, so the gap has
 * to be looked for on a clock rather than waited for.
 */
const LISTEN_TICK_MS = 150;

export interface VoiceTurnOptions {
  /**
   * Send what the reader is looking at.
   *
   * Deliberately takes no text. The draft is the one copy of the message, and
   * it is the copy the reader can edit, so the send path must read from there
   * and never from a transcript this controller kept to itself.
   */
  readonly onSend: () => void;
  /** Called whenever the turn state changes, for hosts that gate on it. */
  readonly onStateChange?: (state: VoiceComposerState) => void;
}

/**
 * A voice turn, from an open microphone to a sent message.
 *
 * The state model and the countdown arithmetic are pure and live in
 * `voiceComposerState`. This owns only the clock and the host redraws, which
 * is the part a pure function cannot hold.
 */
export class VoiceTurnController implements ReactiveController {
  private stateValue: VoiceComposerState = VOICE_COMPOSER_LISTENING;
  private captureValue: VoiceCaptureDisplay = { hearing: false, seconds: 0 };
  private progress: VoiceCaptureProgress = VOICE_CAPTURE_NONE;
  private ticker: number | undefined;
  private tickerRate: number | undefined;

  public constructor(
    private readonly host: ReactiveControllerHost,
    private readonly options: VoiceTurnOptions,
  ) {
    host.addController(this);
  }

  public get state(): VoiceComposerState {
    return this.stateValue;
  }

  /** What the microphone is getting, as opposed to what the reader must do. */
  public get capture(): VoiceCaptureDisplay {
    return this.captureValue;
  }

  /** The text under the countdown, when there is any. */
  public get transcript(): string | undefined {
    return voiceComposerTranscript(this.stateValue);
  }

  /** Milliseconds until the message sends itself. Zero unless counting. */
  public remainingMs(nowMs = Date.now()): number {
    return voiceComposerRemainingMs(this.stateValue, nowMs);
  }

  /** Fold one dictation state into the turn. */
  public noteDictation(dictation: PromptDictationState): void {
    this.setState(voiceComposerFromDictation(dictation, this.stateValue));
  }

  /** A transcript landed in the draft. Start the countdown. */
  public heard(transcript: string): void {
    this.setState(voiceComposerHeard(transcript, Date.now()));
  }

  /** Note voiced audio, so the reader can see the microphone is working. */
  public noteSpeech(activity: VoiceCaptureActivity, sampleRateHz: number): void {
    this.progress = voiceCaptureNoted(this.progress, activity, sampleRateHz, Date.now());
    this.refreshCapture();
  }

  /**
   * A hand arrived. Stop the countdown and keep every word.
   *
   * This is what a touch anywhere on the composer means while text is
   * counting down, and it is deliberately not what discarding means.
   */
  public hold(): void {
    const next = voiceComposerHold(this.stateValue);
    if (next === this.stateValue) return;
    this.setState(next);
  }

  /** The reader edited the text. Editing never restarts the timer. */
  public edited(text: string): void {
    const next = voiceComposerEdited(this.stateValue, text);
    if (next === this.stateValue) return;
    this.setState(next);
  }

  /** Back to an open microphone with nothing heard yet. */
  public reset(): void {
    this.progress = VOICE_CAPTURE_NONE;
    this.captureValue = { hearing: false, seconds: 0 };
    this.setState(VOICE_COMPOSER_LISTENING);
  }

  public hostDisconnected(): void {
    this.stopTicking();
  }

  private setState(next: VoiceComposerState): void {
    if (next === this.stateValue) {
      this.syncTicker();
      return;
    }
    this.stateValue = next;
    this.syncTicker();
    this.options.onStateChange?.(next);
    this.host.requestUpdate();
  }

  private refreshCapture(): void {
    const next = voiceCaptureDisplay(this.progress, Date.now());
    if (!voiceCaptureDisplayChanged(this.captureValue, next)) return;
    this.captureValue = next;
    this.host.requestUpdate();
  }

  /**
   * One timer, at whichever rate the current state needs.
   *
   * Counting needs a ring that moves. Listening needs to notice a silence.
   * Everything else needs no clock at all.
   */
  private syncTicker(): void {
    const kind = this.stateValue.kind;
    if (kind === "counting") { this.startTicking(COUNTDOWN_TICK_MS); return; }
    if (kind === "listening") { this.startTicking(LISTEN_TICK_MS); return; }
    this.stopTicking();
  }

  private startTicking(everyMs: number): void {
    if (this.tickerRate === everyMs && this.ticker !== undefined) return;
    this.stopTicking();
    this.tickerRate = everyMs;
    this.ticker = window.setInterval(() => { this.tick(); }, everyMs);
  }

  private tick(): void {
    // The deadline stays the single fact, so a throttled or slow tick can only
    // ever draw late. It can never send early.
    if (voiceComposerDue(this.stateValue, Date.now())) {
      this.stopTicking();
      this.options.onSend();
      return;
    }
    if (this.stateValue.kind === "listening") {
      this.refreshCapture();
      return;
    }
    if (this.stateValue.kind !== "counting") {
      this.stopTicking();
      return;
    }
    this.host.requestUpdate();
  }

  private stopTicking(): void {
    if (this.ticker === undefined) return;
    window.clearInterval(this.ticker);
    this.ticker = undefined;
    this.tickerRate = undefined;
  }
}
