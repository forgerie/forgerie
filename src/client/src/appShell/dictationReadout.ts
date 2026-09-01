/**
 * What the draft box shows while dictation owns it.
 *
 * Dictation locks the draft the moment it starts, so the box is a surface the
 * feature has already taken and is not using. This module turns the speech
 * controller's state and the capture's own measurements into the one value
 * that box renders, so the decision lives here rather than in a template.
 *
 * The levels are real. The capture worklet measures RMS over every 50 ms batch
 * and posts it with the audio; nothing here invents a number, and a bar height
 * means what it says.
 */

import type { PromptDictationState } from "../controllers/promptDictationController";

/** One 50 ms batch, as the capture worklet measured it. */
export interface DictationLevel {
  readonly rms: number;
  readonly voiced: boolean;
}

export type DictationReadout =
  /** Dictation is not running, or has nothing to say about itself. */
  | { readonly kind: "none" }
  /** The microphone is open. The waveform and the voiced clock are the report. */
  | { readonly kind: "listening"; readonly bars: readonly number[]; readonly clock: string }
  /** The audio is with the gateway. The wait is counted; the turn can be abandoned. */
  | { readonly kind: "working"; readonly words: string; readonly bars: readonly number[]; readonly clock: string }
  /** Nothing to draw, so the box says what happened in words. */
  | { readonly kind: "stated"; readonly words: string };

/**
 * RMS that draws a full-height bar.
 *
 * Speech measured through the capture graph sits well under 1.0, so mapping
 * 0..1 directly would draw every voice as a flat line. This is the loud end of
 * ordinary dictation, and anything above it clamps.
 */
export const DICTATION_FULL_SCALE_RMS = 0.14;

/** The shortest bar a voiced batch may draw, as a fraction of the full height. */
const MIN_VOICED_BAR = 0.12;

/**
 * Fold a turn into the bars a surface can actually draw.
 *
 * Neighbours merge by taking the louder of the pair, so a loud syllable never
 * disappears into an average and the shape of the turn survives the fold. The
 * alternative -- drawing every batch and letting the box clip -- hides the
 * newest audio behind the edge, which is the half a reader is watching.
 */
export function fitBars(bars: readonly number[], slots: number): readonly number[] {
  const limit = Math.max(1, Math.floor(slots));
  let folded = bars;
  while (folded.length > limit) {
    const next: number[] = [];
    for (let index = 0; index < folded.length; index += 2) {
      next.push(Math.max(folded[index] ?? 0, folded[index + 1] ?? 0));
    }
    folded = next;
  }
  return folded;
}

/**
 * The whole turn, at the resolution the pipeline reports it.
 *
 * A rolling window would show a message with no beginning, so the reservoir
 * keeps the turn end to end: once it is full, neighbouring batches merge by
 * taking the louder of the pair and every later batch counts for twice as
 * much. The shape stays honest as the turn grows; only its resolution drops.
 * How many of these bars a surface can draw is the surface's business — see
 * {@link fitBars}.
 */
export class DictationLevelReservoir {
  private readonly buckets: number[] = [];
  private batchesPerBucket = 1;
  private batchesInLastBucket = 0;

  public constructor(private readonly capacity: number) {}

  public push(level: DictationLevel): void {
    const value = level.voiced ? Math.max(level.rms, 0) : 0;
    if (this.batchesInLastBucket >= this.batchesPerBucket || this.buckets.length === 0) {
      this.buckets.push(value);
      this.batchesInLastBucket = 1;
    } else {
      const last = this.buckets.length - 1;
      this.buckets[last] = Math.max(this.buckets[last] ?? 0, value);
      this.batchesInLastBucket += 1;
    }
    if (this.buckets.length > this.capacity) this.fold();
  }

  /** Bar heights, 0 to 1, oldest first. */
  public bars(): readonly number[] {
    return this.buckets.map((rms) => barHeight(rms));
  }

  public clear(): void {
    this.buckets.splice(0);
    this.batchesPerBucket = 1;
    this.batchesInLastBucket = 0;
  }

  private fold(): void {
    const folded: number[] = [];
    for (let index = 0; index < this.buckets.length; index += 2) {
      folded.push(Math.max(this.buckets[index] ?? 0, this.buckets[index + 1] ?? 0));
    }
    this.buckets.splice(0, this.buckets.length, ...folded);
    this.batchesPerBucket *= 2;
    this.batchesInLastBucket = this.batchesPerBucket;
  }
}

/**
 * One measurement to one bar height.
 *
 * Square-rooted because loudness is not linear in RMS and a linear map leaves
 * ordinary speech hugging the baseline. Silence draws nothing; a voiced batch
 * always draws something, so a quiet speaker still sees themselves.
 */
export function barHeight(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const scaled = Math.sqrt(rms / DICTATION_FULL_SCALE_RMS);
  return Math.min(1, Math.max(MIN_VOICED_BAR, scaled));
}

/** `0:07`, for speech captured. */
export function dictationVoicedClock(voicedMs: number): string {
  const total = Math.max(0, Math.floor(voicedMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${seconds < 10 ? "0" : ""}${String(seconds)}`;
}

/** `2.4s`, for a wait the reader is watching. Tenths, because they move. */
export function dictationWaitClock(waitMs: number): string {
  return `${(Math.max(0, waitMs) / 1000).toFixed(1)}s`;
}

export interface DictationReadoutInput {
  readonly bars: readonly number[];
  readonly voicedMs: number;
  readonly waitMs: number;
}

/**
 * Fold the controller's state into what the box shows.
 *
 * Listening carries no label on purpose: a live waveform beside a running
 * clock already says it, and the microphone in the row below is the control.
 * Words are spent only where something needs explaining.
 */
export function dictationReadout(state: PromptDictationState, input: DictationReadoutInput): DictationReadout {
  switch (state.tag) {
    case "idle":
    case "unavailable":
      return { kind: "none" };
    case "acquiring":
    case "pressed":
    case "auto":
    case "held":
    case "manual-only":
    case "checking":
      return { kind: "listening", bars: input.bars, clock: dictationVoicedClock(input.voicedMs) };
    case "transcribing":
      return { kind: "working", words: "Transcribing", bars: input.bars, clock: dictationWaitClock(input.waitMs) };
    case "empty":
      return { kind: "stated", words: "Nothing heard." };
    case "retained-retry":
      return { kind: "stated", words: "Transcription failed. Press the microphone to retry." };
    case "error":
      return errorReadout(state);
  }
}

function errorReadout(state: Extract<PromptDictationState, { readonly tag: "error" }>): DictationReadout {
  switch (state.reason) {
    // The turn was abandoned on purpose, so the box goes quiet rather than
    // reporting the reader's own decision back at them.
    case "cancelled":
      return { kind: "none" };
    case "too-short":
      return { kind: "stated", words: "Too short to transcribe." };
    case "initial-speech-timeout":
      return { kind: "stated", words: "Nothing heard." };
    case "permission-denied":
      return { kind: "stated", words: "No microphone permission." };
    case "capture-failed":
      return { kind: "stated", words: "The microphone stopped." };
    case "transcription-failed":
      return { kind: "stated", words: "Transcription failed." };
  }
}
