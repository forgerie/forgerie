/**
 * What the microphone is actually getting, as opposed to what the reader is
 * being asked to do.
 *
 * These are two different questions and they are kept apart on purpose.
 * {@link VoiceComposerState} answers "what do I do now"; this answers "is it
 * hearing me". A reader talking into a still screen needs the second one
 * answered continuously, and no amount of status wording substitutes for it.
 *
 * The only inputs are the voiced-audio reports the capture session already
 * emits. There is no amplitude anywhere in this pipeline, so nothing here
 * draws a waveform or a level: a meter invented from sample counts would be a
 * confident-looking lie about how loud someone is.
 */

/** Voiced audio must have arrived this recently to still count as hearing. */
export const VOICE_HEARING_WINDOW_MS = 400;

export interface VoiceCaptureProgress {
  /** Voiced audio captured so far. Silence between words is not counted. */
  readonly voicedMs: number;
  /** When voiced audio last arrived, or undefined before the first word. */
  readonly lastVoiceAtMs: number | undefined;
}

/** What a reader sees. Derived so the view can be redrawn only when it changes. */
export interface VoiceCaptureDisplay {
  /** Whether a voice is arriving right now. */
  readonly hearing: boolean;
  /** Whole seconds of speech captured. Whole, because tenths are noise here. */
  readonly seconds: number;
}

export const VOICE_CAPTURE_NONE: VoiceCaptureProgress = { voicedMs: 0, lastVoiceAtMs: undefined };

export interface VoiceCaptureActivity {
  readonly sampleCount: number;
}

/**
 * Fold one voiced-audio report into the running total.
 *
 * `sampleCount` is voiced samples, so the total is time spent speaking rather
 * than time spent with the microphone open. Those differ by however long the
 * reader spent thinking, and the first number is the one that says the
 * microphone is working.
 */
export function voiceCaptureNoted(
  progress: VoiceCaptureProgress,
  activity: VoiceCaptureActivity,
  sampleRateHz: number,
  nowMs: number,
): VoiceCaptureProgress {
  if (sampleRateHz <= 0 || activity.sampleCount <= 0) return progress;
  return {
    voicedMs: progress.voicedMs + (activity.sampleCount / sampleRateHz) * 1000,
    lastVoiceAtMs: nowMs,
  };
}

export function voiceCaptureDisplay(progress: VoiceCaptureProgress, nowMs: number): VoiceCaptureDisplay {
  const last = progress.lastVoiceAtMs;
  return {
    hearing: last !== undefined && nowMs - last < VOICE_HEARING_WINDOW_MS,
    seconds: Math.floor(progress.voicedMs / 1000),
  };
}

/**
 * Whether a redraw would show anything new.
 *
 * Voiced-audio reports arrive per audio chunk, tens of times a second. Setting
 * reactive state on each one would re-render the dialog at audio rate to show
 * a number that changes once a second.
 */
export function voiceCaptureDisplayChanged(left: VoiceCaptureDisplay, right: VoiceCaptureDisplay): boolean {
  return left.hearing !== right.hearing || left.seconds !== right.seconds;
}

/** `0:07`, for a readout that sits beside a status line. */
export function voiceCaptureClock(display: VoiceCaptureDisplay): string {
  const minutes = Math.floor(display.seconds / 60);
  const seconds = display.seconds % 60;
  return `${String(minutes)}:${seconds < 10 ? "0" : ""}${String(seconds)}`;
}
